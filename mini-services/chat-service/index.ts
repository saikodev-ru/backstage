/**
 * Backstage (Бэкстейдж) — chat microservice.
 *
 * Standalone socket.io server on fixed port 3003 (Caddy gateway forwards
 * requests with ?XTransformPort=3003 to this port).
 *
 * Features:
 *  - per-channel rooms: "ch:<slug>"
 *  - auth via HMAC token (issued by the main Next.js app, only verified here)
 *  - subscriber-only message sending + rate limiting (1500ms / uid)
 *  - in-memory history (last 100 messages per channel)
 *  - presence / viewer counts, reported to the main app every 10s
 *  - fire-and-forget persistence callback to the main app (/api/chat/ingest)
 *  - internal plain-HTTP endpoints: GET /health, POST /announce
 *
 * Everything lives in this single file on purpose.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { Server } from 'socket.io'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = 3003 // hardcoded: gateway forwards via XTransformPort=3003, do not change
const CHAT_SECRET = process.env.CHAT_SECRET || 'backstage-dev-chat-secret-2024'
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'backstage-internal-2024'
const MAIN_APP_BASE = 'http://127.0.0.1:3000'
const HISTORY_CAP = 100 // last N messages kept per channel
const RATE_LIMIT_MS = 1500 // min delay between messages per uid
const VIEWERS_INTERVAL_MS = 10_000
const MAX_HTTP_BODY = 100 * 1024

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Decrypted & verified auth token payload (issued by the main app). */
interface ChatUser {
  uid: string
  name: string
  color: string
  avatar: string | null
  slug: string
  sub: boolean
  adm: boolean
  exp: number
}

interface ChatMsg {
  id: string
  channelSlug: string
  uid: string | null
  name: string
  color: string
  avatar: string | null
  text: string
  ts: number
  system: boolean
}

type RequestListener = (req: IncomingMessage, res: ServerResponse) => void

// ---------------------------------------------------------------------------
// HTTP server + socket.io (path MUST stay "/" for the gateway)
// ---------------------------------------------------------------------------

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// ---------------------------------------------------------------------------
// Plain HTTP routing, coexisting with socket.io
//
// With path "/" engine.io's request check matches every URL that starts with
// "/", so /health and /announce would otherwise be swallowed by engine.io
// ("Transport unknown"). We therefore re-wrap the listener chain (the exact
// same wrapping technique engine.io / socket.io use internally): our
// dispatcher handles its own routes first and forwards everything else —
// engine.io polling / websocket traffic, URLs containing EIO= — untouched.
// ---------------------------------------------------------------------------

const socketIoChain = httpServer.listeners('request').slice(0) as RequestListener[]
httpServer.removeAllListeners('request')
httpServer.on('request', (req, res) => {
  const pathname = (req.url ?? '/').split('?')[0]
  if (pathname === '/health' || pathname === '/announce') {
    handleHttpRequest(req, res, pathname).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: msg }))
      } else {
        res.end()
      }
    })
    return
  }
  // everything else belongs to socket.io (engine.io handshake/polling etc.)
  for (const listener of socketIoChain) {
    listener.call(httpServer, req, res)
  }
})

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_HTTP_BODY) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  // --- GET /health ---
  if (pathname === '/health') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    sendJson(res, 200, { ok: true, service: 'backstage-chat', clients: io.engine.clientsCount })
    return
  }

  // --- POST /announce (system message from the main app) ---
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  let raw: string
  try {
    raw = await readBody(req)
  } catch {
    sendJson(res, 413, { ok: false, error: 'payload too large' })
    return
  }
  let parsed: { secret?: unknown; channelSlug?: unknown; text?: unknown; ts?: unknown }
  try {
    parsed = JSON.parse(raw.length > 0 ? raw : '{}')
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid json' })
    return
  }
  if (parsed.secret !== INTERNAL_SECRET) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' })
    return
  }
  const channelSlug = parsed.channelSlug
  const text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
  if (typeof channelSlug !== 'string' || channelSlug.length === 0 || text.length === 0) {
    sendJson(res, 400, { ok: false, error: 'channelSlug and text are required' })
    return
  }
  const message: ChatMsg = {
    id: randomUUID(),
    channelSlug,
    uid: null,
    name: 'Система',
    color: '#a970ff',
    avatar: null,
    text,
    ts: typeof parsed.ts === 'number' && parsed.ts > 0 ? parsed.ts : Date.now(),
    system: true,
  }
  appendHistory(channelSlug, message)
  io.in(roomKey(channelSlug)).emit('chat:message', { message })
  sendJson(res, 200, { ok: true })
}

// ---------------------------------------------------------------------------
// Token verification (tokens are issued & signed by the main app)
// token = base64url(payloadJson) + "." + base64url(hmacSha256(payloadJson, secret))
// ---------------------------------------------------------------------------

function b64urlDecode(input: string): Buffer {
  let normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  while (normalized.length % 4 !== 0) normalized += '='
  return Buffer.from(normalized, 'base64')
}

function verifyToken(token: unknown): ChatUser | null {
  if (typeof token !== 'string' || token.length === 0) return null
  const dot = token.indexOf('.')
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null
  const payloadPart = token.slice(0, dot)
  const signaturePart = token.slice(dot + 1)
  if (signaturePart.length === 0) return null
  try {
    const payloadJson = b64urlDecode(payloadPart).toString('utf8')
    const expected = createHmac('sha256', CHAT_SECRET).update(payloadJson).digest()
    const received = b64urlDecode(signaturePart)
    if (received.length !== expected.length) return null
    if (!timingSafeEqual(received, expected)) return null
    const payload = JSON.parse(payloadJson)
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
    if (typeof payload.uid !== 'string' || payload.uid.length === 0) return null
    if (typeof payload.name !== 'string') return null
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    return {
      uid: payload.uid,
      name: payload.name,
      color: typeof payload.color === 'string' && payload.color.length > 0 ? payload.color : '#a970ff',
      avatar: typeof payload.avatar === 'string' && payload.avatar.length > 0 ? payload.avatar : null,
      slug: typeof payload.slug === 'string' ? payload.slug : '',
      sub: payload.sub === true,
      adm: payload.adm === true,
      exp: payload.exp,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const history = new Map<string, ChatMsg[]>() // channelSlug -> last 100 messages
const lastSentAt = new Map<string, number>() // uid -> ts of last accepted message
const lastReportedViewers = new Map<string, number>() // channelSlug -> last reported count

function roomKey(slug: string): string {
  return 'ch:' + slug
}

function roomCount(slug: string): number {
  const room = io.sockets.adapter.rooms.get(roomKey(slug))
  return room ? room.size : 0
}

function appendHistory(slug: string, message: ChatMsg): void {
  const list = history.get(slug) ?? []
  list.push(message)
  if (list.length > HISTORY_CAP) list.splice(0, list.length - HISTORY_CAP)
  history.set(slug, list)
}

// ---------------------------------------------------------------------------
// Fire-and-forget callbacks into the main app (never crash the service)
// ---------------------------------------------------------------------------

function postJson(url: string, body: unknown, label: string): void {
  try {
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      body: JSON.stringify(body),
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`[${label}] failed: ${msg}`)
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[${label}] failed: ${msg}`)
  }
}

function persistMessage(channelSlug: string, message: ChatMsg): void {
  postJson(`${MAIN_APP_BASE}/api/chat/ingest`, { channelSlug, message }, 'persist')
}

// ---------------------------------------------------------------------------
// Socket.io connection handling
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  // Invalid / expired token -> proceed as anonymous (user = null).
  socket.data.user = verifyToken((socket.handshake.auth as { token?: unknown } | undefined)?.token)
  socket.data.channel = null

  socket.on('channel:join', (raw: unknown) => {
    const channelSlug = (raw as { channelSlug?: unknown } | null)?.channelSlug
    if (typeof channelSlug !== 'string' || channelSlug.length === 0) return
    const user = socket.data.user as ChatUser | null
    if (!user) {
      socket.emit('system:error', { code: 'auth_required', message: 'Войдите, чтобы наблюдать за чатом' })
      return
    }
    // keep one channel per socket: silently leave the previous one
    const previous = socket.data.channel as string | null
    if (previous && previous !== channelSlug) {
      socket.leave(roomKey(previous))
      socket.data.channel = null
      io.in(roomKey(previous)).emit('presence:update', { channelSlug: previous, count: roomCount(previous) })
    }
    socket.join(roomKey(channelSlug))
    socket.data.channel = channelSlug
    socket.emit('chat:history', { channelSlug, messages: history.get(channelSlug) ?? [] })
    io.in(roomKey(channelSlug)).emit('presence:update', { channelSlug, count: roomCount(channelSlug) })
  })

  socket.on('channel:leave', (raw: unknown) => {
    const channelSlug = (raw as { channelSlug?: unknown } | null)?.channelSlug
    if (typeof channelSlug !== 'string' || channelSlug.length === 0) return
    if (socket.data.channel === channelSlug) socket.data.channel = null
    socket.leave(roomKey(channelSlug))
    io.in(roomKey(channelSlug)).emit('presence:update', { channelSlug, count: roomCount(channelSlug) })
  })

  socket.on('chat:send', (raw: unknown) => {
    const payload = raw as { channelSlug?: unknown; text?: unknown } | null
    const user = socket.data.user as ChatUser | null
    if (!user) {
      socket.emit('system:error', { code: 'auth_required', message: 'Войдите через Telegram, чтобы писать в чат' })
      return
    }
    if (user.sub !== true && user.adm !== true) {
      socket.emit('system:error', { code: 'subscribers_only', message: 'Чат доступен только платным подписчикам' })
      return
    }
    const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
    if (text.length < 1 || text.length > 500) {
      socket.emit('system:error', { code: 'bad_text', message: 'Сообщение должно содержать от 1 до 500 символов' })
      return
    }
    const channelSlug = payload?.channelSlug
    if (typeof channelSlug !== 'string' || channelSlug.length === 0) return
    if (socket.data.channel !== channelSlug) return // must be a room member
    const now = Date.now()
    const last = lastSentAt.get(user.uid)
    if (last !== undefined && now - last < RATE_LIMIT_MS) {
      socket.emit('system:error', { code: 'rate_limited', message: 'Слишком часто. Подождите немного' })
      return
    }
    const message: ChatMsg = {
      id: randomUUID(),
      channelSlug,
      uid: user.uid,
      name: user.name,
      color: user.color,
      avatar: user.avatar,
      text,
      ts: now,
      system: false,
    }
    lastSentAt.set(user.uid, now)
    appendHistory(channelSlug, message)
    io.in(roomKey(channelSlug)).emit('chat:message', { message })
    persistMessage(channelSlug, message) // fire-and-forget
  })

  socket.on('disconnect', () => {
    const channel = socket.data.channel as string | null
    if (typeof channel === 'string' && channel.length > 0) {
      socket.data.channel = null
      // defensive: socket.io already removed the room membership on disconnect
      const room = io.sockets.adapter.rooms.get(roomKey(channel))
      let count = room ? room.size : 0
      if (room && room.has(socket.id)) count = Math.max(0, count - 1)
      io.in(roomKey(channel)).emit('presence:update', { channelSlug: channel, count })
    }
  })
})

// ---------------------------------------------------------------------------
// Viewer counts reporting (every 10s, fire-and-forget)
// ---------------------------------------------------------------------------

setInterval(() => {
  const counts: Record<string, number> = {}
  for (const [room, members] of io.sockets.adapter.rooms) {
    const name = String(room)
    if (!name.startsWith('ch:')) continue // skip per-socket rooms
    counts[name.slice(3)] = members.size
  }
  // include 0 for previously-known slugs so the main app can reset them
  for (const slug of lastReportedViewers.keys()) {
    if (!(slug in counts)) counts[slug] = 0
  }
  const anyPositive = Object.values(counts).some((n) => n > 0)
  const needsReset = [...lastReportedViewers.entries()].some(
    ([slug, prev]) => prev > 0 && (counts[slug] ?? 0) === 0
  )
  if (!anyPositive && !needsReset) return
  for (const [slug, n] of Object.entries(counts)) lastReportedViewers.set(slug, n)
  postJson(`${MAIN_APP_BASE}/api/internal/viewers`, { counts }, 'viewers')
}, VIEWERS_INTERVAL_MS)

// ---------------------------------------------------------------------------
// Engine errors + startup
// ---------------------------------------------------------------------------

io.engine.on('connection_error', (err: { code?: number; message?: string }) => {
  console.log('connection_error:', err && err.code)
})

httpServer.listen(PORT, () => {
  console.log('backstage-chat listening on :3003')
})
