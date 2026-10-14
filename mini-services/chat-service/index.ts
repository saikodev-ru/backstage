/**
 * Backstage (Бэкстейдж) — chat microservice v2.
 *
 * Standalone socket.io server on fixed port 3003 (Caddy gateway forwards
 * requests with ?XTransformPort=3003 to this port).
 *
 * v1 features (kept intact):
 *  - per-channel rooms: "ch:<slug>"
 *  - auth via HMAC token (issued by the main Next.js app, only verified here)
 *  - subscriber-only sending + rate limiting, in-memory history (100/channel)
 *  - presence / viewer counts reported to the main app every 10s
 *  - fire-and-forget persistence to the main app (/api/chat/ingest)
 *  - plain-HTTP endpoints: GET /health, POST /announce
 *
 * v2 additions:
 *  - emotes from 7TV / BTTV / FFZ (sqlite cache, 6h refresh) + GET /api/emotes
 *  - chat commands: public (!uptime, !title, !команды, !эмоции, custom !cmds)
 *    and moderator /-commands (ban/timeout/clear/slow/subsonly/so/delete/
 *    mod/cmd/demo); command replies are system messages from "dypaGPT"
 *  - moderation state in its own sqlite DB (data/chat.db, bun:sqlite):
 *    bans, mods, custom commands, per-channel slow/subsonly, settings
 *  - demo chat (DEMO_CHAT=1 or /demo on): fake VTuber viewers keep rooms alive
 *  - REST for OBS / admin: /api/messages, /api/send (Bearer token),
 *    /api/mods, /api/bans, /api/chstate; CORS * everywhere
 *  - GET /overlay — OBS browser-source overlay (watch-only socket, no token)
 *
 * v2.1 additions (Twitch-подобные бейджи и список «кто в чате»):
 *  - badges: 'owner' | 'mod' | 'vip' | 'sub' в каждом сообщении (реальном и
 *    демо); легаси-поле role сохранено для старого OBS-оверлея
 *  - событие chatters:update в комнату канала (community-drawer как в
 *    Twitch) + REST GET /api/chatters?channel=<slug>
 *  - демо-модераторы иногда пишут в чат, демо-присутствие слегка шевелится
 *
 * v2.2 additions (закреплённые сообщения + цвет ника):
 *  - команды модов /pin <id> [30|10s|5m|1h] и /unpin; событие chat:pin в
 *    комнату канала { channelSlug, message: ChatMsg|null, until: number|null }
 *  - GET /api/pin?channel=<slug>; вошедшему (channel:join) отдаётся текущий
 *    пин; TTL-автоанпин (~5с, ensureBackground); POST /announce с clearPin
 *  - override цвета ника: color (палитра Twitch) в chat:send и POST /api/send
 *
 * Everything lives in this single file on purpose.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Server, type Socket } from 'socket.io'
import { Database } from 'bun:sqlite'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = 3003 // hardcoded: gateway forwards via XTransformPort=3003, do not change
const SERVICE_VERSION = '2.2.0' // pins (/pin /unpin, chat:pin, /api/pin) + color override
const CHAT_SECRET = process.env.CHAT_SECRET || 'backstage-dev-chat-secret-2024'
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'backstage-internal-2024'
const MAIN_APP_BASE = 'http://127.0.0.1:3000'
const HISTORY_CAP = 100 // last N messages kept per channel
const RATE_LIMIT_MS = 1500 // min delay between messages per uid (>= slow mode)
const VIEWERS_INTERVAL_MS = 10_000
const MAX_HTTP_BODY = 100 * 1024

// v2 config
const DEMO_ENV = process.env.DEMO_CHAT === '1' // demo chat at startup; /demo persists
const EMOTES_REFRESH_MS = 6 * 60 * 60 * 1000
const EMOTE_FETCH_TIMEOUT_MS = 8000
const CHANNELS_CACHE_MS = 30_000 // /api/channels cache for !uptime / !title
const BANS_CLEANUP_MS = 60_000
const PIN_TTL_CHECK_MS = 5_000 // v2.2: период проверки истёкших /pin-ов (TTL-автоанпин)

const SEVEN_TV_URL = 'https://7tv.io/v3/emote-sets/global'
const BTTV_URL = 'https://api.betterttv.net/3/cached/emotes/global'
const FFZ_URL = 'https://api.frankerfacez.com/v1/set/global'

/** v2.2: палитра цветов ника как в Twitch — допустимые значения color в chat:send / /api/send. */
const TWITCH_PALETTE = ['#ff7bac','#7bd3ff','#a970ff','#ffb86b','#c3e88d','#8be9fd','#f97ac0','#d6bcff','#5ad1a4','#ff8080','#a6e22e','#f78c6c','#e6db74','#fd971f','#7f7fff','#00b5ad']

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Role = 'OWNER' | 'MOD' | 'VIEWER'

/** Decrypted & verified auth token payload (issued by the main app). */
interface ChatUser {
  uid: string
  name: string
  color: string
  avatar: string | null
  slug: string
  sub: boolean
  adm: boolean
  role: Role
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
  /** sender badge for the UI (OWNER/MOD only; VIEWER -> field omitted) */
  role?: 'OWNER' | 'MOD'
  /** Twitch-подобные бейджи отправителя: 'owner' | 'mod' | 'vip' | 'sub' (новый UI; OBS-оверлей использует role) */
  badges?: string[]
  /** set by /delete — deleted messages are hidden from clients */
  deleted?: true
}

type RequestListener = (req: IncomingMessage, res: ServerResponse) => void

interface BanRow {
  uid: string
  name: string
  reason: string
  until: number // 0 -> permanent
}

interface ChState {
  slowSec: number
  subsonly: number // 1 -> only subs (and MOD/OWNER) may write; default 1 (v1 behaviour)
}

/** Запись списка «кто в чате» (событие chatters:update / GET /api/chatters). */
interface Chatter {
  uid: string
  name: string
  color: string
  avatar: string | null
  badges: string[]
}

interface EmoteRow {
  provider: string
  name: string
  url: string
}

interface ChannelInfo {
  slug: string
  isLive: boolean
  liveTitle: string | null
  liveStartedAt: string | null
}

// ---------------------------------------------------------------------------
// SQLite state store (bun:sqlite) — separate from the main app's Prisma DB
// ---------------------------------------------------------------------------

const DATA_DIR = join(import.meta.dir, 'data')
mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(join(DATA_DIR, 'chat.db'))
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;')
db.exec(
  'CREATE TABLE IF NOT EXISTS emotes (' +
    'provider TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,' +
    ' PRIMARY KEY (provider, name))',
)
db.exec(
  'CREATE TABLE IF NOT EXISTS bans (' +
    'uid TEXT PRIMARY KEY, name TEXT NOT NULL, reason TEXT NOT NULL DEFAULT \'\',' +
    ' until INTEGER NOT NULL DEFAULT 0)',
)
db.exec(
  'CREATE TABLE IF NOT EXISTS mods (' +
    'uid TEXT PRIMARY KEY, name TEXT NOT NULL, addedBy TEXT NOT NULL DEFAULT \'\')',
)
db.exec(
  'CREATE TABLE IF NOT EXISTS commands (' +
    'name TEXT PRIMARY KEY, response TEXT NOT NULL, addedBy TEXT NOT NULL DEFAULT \'\')',
)
db.exec(
  'CREATE TABLE IF NOT EXISTS chstate (' +
    'channelSlug TEXT PRIMARY KEY, slowSec INTEGER NOT NULL DEFAULT 0,' +
    ' subsonly INTEGER NOT NULL DEFAULT 1)',
)
db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

const qEmoteClear = db.prepare('DELETE FROM emotes WHERE provider = ?')
const qEmoteInsert = db.prepare('INSERT OR REPLACE INTO emotes (provider, name, url) VALUES (?, ?, ?)')
const qEmoteAll = db.prepare<EmoteRow>('SELECT provider, name, url FROM emotes')
const qEmoteCount = db.prepare<{ c: number }>('SELECT COUNT(*) AS c FROM emotes')
const qEmoteCountProvider = db.prepare<{ c: number }>('SELECT COUNT(*) AS c FROM emotes WHERE provider = ?')

const qBanGet = db.prepare<BanRow>('SELECT uid, name, reason, until FROM bans WHERE uid = ?')
const qBanPut = db.prepare('INSERT OR REPLACE INTO bans (uid, name, reason, until) VALUES (?, ?, ?, ?)')
const qBanDel = db.prepare('DELETE FROM bans WHERE uid = ?')
const qBanName = db.prepare<BanRow>('SELECT uid, name, reason, until FROM bans WHERE lower(name) = ?')
const qBanAll = db.prepare<BanRow>('SELECT uid, name, reason, until FROM bans WHERE until = 0 OR until > ? ORDER BY until')
const qBanCount = db.prepare<{ c: number }>('SELECT COUNT(*) AS c FROM bans WHERE until = 0 OR until > ?')
const qBanCleanup = db.prepare('DELETE FROM bans WHERE until > 0 AND until <= ?')

const qModGet = db.prepare<{ uid: string; name: string }>('SELECT uid, name FROM mods WHERE uid = ?')
const qModName = db.prepare<{ uid: string; name: string }>('SELECT uid, name FROM mods WHERE lower(name) = ?')
const qModPut = db.prepare('INSERT OR REPLACE INTO mods (uid, name, addedBy) VALUES (?, ?, ?)')
const qModDel = db.prepare('DELETE FROM mods WHERE uid = ?')
const qModAll = db.prepare<{ uid: string; name: string }>('SELECT uid, name FROM mods ORDER BY name')

const qCmdGet = db.prepare<{ name: string; response: string }>('SELECT name, response FROM commands WHERE name = ?')
const qCmdPut = db.prepare('INSERT OR REPLACE INTO commands (name, response, addedBy) VALUES (?, ?, ?)')
const qCmdDel = db.prepare('DELETE FROM commands WHERE name = ?')
const qCmdAll = db.prepare<{ name: string; response: string }>('SELECT name, response FROM commands ORDER BY name')

const qStateGet = db.prepare<{ slowSec: number; subsonly: number }>(
  'SELECT slowSec, subsonly FROM chstate WHERE channelSlug = ?',
)
const qStatePut = db.prepare(
  'INSERT OR REPLACE INTO chstate (channelSlug, slowSec, subsonly) VALUES (?, ?, ?)',
)

const qSettingGet = db.prepare<{ value: string }>('SELECT value FROM settings WHERE key = ?')
const qSettingPut = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')

function getSetting(key: string): string | null {
  const row = qSettingGet.get(key)
  return row ? row.value : null
}

function setSetting(key: string, value: string): void {
  qSettingPut.run(key, value)
}

/** Demo chat switch: env var wins at startup, /demo persists into settings. */
// NOTE: старые записи хранили 'on'/'off' — принимаем и их (иначе после
// перезапуска демо молча выключалось); новые пишем каноническими '1'/'0'.
let demoEnabled =
  DEMO_ENV || getSetting('demo') === '1' || getSetting('demo') === 'on'

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
// "/", so /health, /api/* etc. would otherwise be swallowed by engine.io
// ("Transport unknown"). We therefore re-wrap the listener chain (the exact
// same wrapping technique engine.io / socket.io use internally): our
// dispatcher handles its own routes first and forwards everything else —
// engine.io polling / websocket traffic, URLs containing EIO= — untouched.
// ---------------------------------------------------------------------------

const REST_PATHS = new Set(['/health', '/announce', '/overlay'])

const socketIoChain = httpServer.listeners('request').slice(0) as RequestListener[]
httpServer.removeAllListeners('request')
httpServer.on('request', (req, res) => {
  const pathname = (req.url ?? '/').split('?')[0]
  const isRest = REST_PATHS.has(pathname) || pathname.startsWith('/api/')
  if (isRest) {
    if (req.method === 'OPTIONS') {
      // CORS preflight for browser clients (overlay, admin panel)
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-max-age': '86400',
      })
      res.end()
      return
    }
    handleHttpRequest(req, res, pathname).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: msg })
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
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
  })
  res.end(JSON.stringify(body))
}

function requestParams(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? '/', 'http://internal.local').searchParams
}

// ---------------------------------------------------------------------------
// REST routing
// ---------------------------------------------------------------------------

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  ensureBackground() // любой REST-запрос перевооружает фоновые таймеры (bun --hot)

  // --- GET /health ---
  if (pathname === '/health') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const now = Date.now()
    // диагностика: одноразовый таймер, созданный в runtime-обработчике запроса
    setTimeout(() => {
      healthProbeAt = Date.now()
    }, 3000)
    sendJson(res, 200, {
      ok: true,
      service: 'backstage-chat',
      version: SERVICE_VERSION,
      clients: io.engine.clientsCount,
      emotes: (qEmoteCount.get() ?? { c: 0 }).c,
      bans: (qBanCount.get(now) ?? { c: 0 }).c,
      demo: demoEnabled === true,
      timers: backgroundArmed, // фоновые таймеры вооружены
      lastTick: bgTickAt, // эпоха-мс последнего тика (0 — таймеры не тикают)
      tickAgo: bgTickAt === 0 ? null : now - bgTickAt, // мс с последнего тика
      timeoutProbe: bgTimeoutAt, // сработал ли одноразовый setTimeout (0 — нет)
      probeAt: healthProbeAt, // setTimeout из этого REST-обработчика (0 — не сработал)
    })
    return
  }

  // --- GET /api/emotes ---
  if (pathname === '/api/emotes') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const emotes = listEmotes()
    sendJson(res, 200, { ok: true, emotes, count: emotes.length })
    return
  }

  // --- GET /api/mods (channel param reserved; mods are global) ---
  if (pathname === '/api/mods') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    sendJson(res, 200, { ok: true, mods: qModAll.all() })
    return
  }

  // --- GET /api/bans ---
  if (pathname === '/api/bans') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    sendJson(res, 200, { ok: true, bans: qBanAll.all(Date.now()) })
    return
  }

  // --- GET /api/chatters?channel=slug (кто сейчас в чате; как событие chatters:update) ---
  if (pathname === '/api/chatters') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const channel = requestParams(req).get('channel') ?? ''
    if (channel.length === 0) {
      sendJson(res, 400, { ok: false, error: 'bad_request', message: 'channel is required' })
      return
    }
    sendJson(res, 200, { ok: true, ...buildChatters(channel) })
    return
  }

  // --- GET /api/chstate?channel=slug ---
  if (pathname === '/api/chstate') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const channel = requestParams(req).get('channel') ?? ''
    const st = getChstate(channel)
    sendJson(res, 200, {
      ok: true,
      slow: st.slowSec,
      subsonly: st.subsonly === 1,
      demo: demoEnabled === true,
    })
    return
  }

  // --- GET /api/messages?channel=slug&limit=100&after=ms ---
  if (pathname === '/api/messages') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const params = requestParams(req)
    const channel = params.get('channel')
    if (typeof channel !== 'string' || channel.length === 0) {
      sendJson(res, 400, { ok: false, error: 'bad_request', message: 'channel is required' })
      return
    }
    const afterRaw = Number(params.get('after') ?? '0')
    const after = Number.isFinite(afterRaw) && afterRaw > 0 ? afterRaw : 0
    const limitRaw = Number(params.get('limit') ?? '100')
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 100
    const messages = (history.get(channel) ?? [])
      .filter((m) => !m.deleted && (after === 0 || m.ts > after))
      .slice(-limit)
    sendJson(res, 200, { ok: true, messages })
    return
  }

  // --- GET /api/pin?channel=slug (закреплённое сообщение канала; v2.2) ---
  if (pathname === '/api/pin') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const channel = requestParams(req).get('channel') ?? ''
    if (channel.length === 0) {
      sendJson(res, 400, { ok: false, error: 'bad_request', message: 'channel is required' })
      return
    }
    const pin = pins.get(channel)
    sendJson(res, 200, { ok: true, message: pin ? pin.message : null, until: pin ? pin.until : null })
    return
  }

  // --- POST /api/send (OBS / bots): Bearer chat-token + {channelSlug, text} ---
  if (pathname === '/api/send') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const authHeader = req.headers.authorization
    const bearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    const user = verifyToken(bearer)
    if (!user) {
      sendJson(res, 401, { ok: false, error: 'unauthorized', message: 'Требуется валидный Bearer-токен чата' })
      return
    }
    let raw: string
    try {
      raw = await readBody(req)
    } catch {
      sendJson(res, 413, { ok: false, error: 'payload too large' })
      return
    }
    let parsed: { channelSlug?: unknown; text?: unknown; color?: unknown }
    try {
      parsed = JSON.parse(raw.length > 0 ? raw : '{}')
    } catch {
      sendJson(res, 400, { ok: false, error: 'invalid json' })
      return
    }
    const channelSlug = parsed.channelSlug
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
    if (typeof channelSlug !== 'string' || channelSlug.length === 0) {
      sendJson(res, 400, { ok: false, error: 'bad_request', message: 'channelSlug и text обязательны' })
      return
    }
    const color = paletteColor(parsed.color) // v2.2: override цвета ника (палитра Twitch)
    const result = await processChatText(channelSlug, user, text, null, color)
    if (!result.ok) {
      sendJson(res, result.status ?? 400, {
        ok: false,
        error: result.code,
        code: result.code,
        message: result.message,
      })
      return
    }
    if (result.msg) {
      sendJson(res, 200, { ok: true, message: result.msg })
      return
    }
    sendJson(res, 200, {
      ok: true,
      command: true,
      ...(result.senderOnly ? { response: result.senderOnly.text } : {}),
    })
    return
  }

  // --- GET /overlay (OBS browser source; read-only, no token) ---
  if (pathname === '/overlay') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const params = requestParams(req)
    const channel = (params.get('channel') ?? 'dypagpt').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'dypagpt'
    const scaleRaw = Number(params.get('scale') ?? '1')
    const scale = Math.min(4, Math.max(0.5, Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1))
    const html = OVERLAY_HTML.replace('__CHANNEL_JSON__', JSON.stringify(channel)).replace(
      '__SCALE_JSON__',
      String(scale),
    )
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'access-control-allow-origin': '*',
    })
    res.end(html)
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
  let parsed: { secret?: unknown; channelSlug?: unknown; text?: unknown; ts?: unknown; clearPin?: unknown }
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
  const clearPin = parsed.clearPin === true // v2.2: снять закреплённое сообщение (основное приложение зовёт при завершении эфира)
  if (typeof channelSlug !== 'string' || channelSlug.length === 0) {
    sendJson(res, 400, { ok: false, error: 'channelSlug and text are required' })
    return
  }
  if (clearPin) clearChannelPin(channelSlug)
  if (text.length === 0) {
    // announce без текста допустим только как «снять пин» (clearPin), иначе — прежняя ошибка
    if (clearPin) {
      sendJson(res, 200, { ok: true, clearedPin: true })
      return
    }
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
    const role: Role =
      payload.role === 'OWNER' || payload.role === 'MOD' || payload.role === 'VIEWER' ? payload.role : 'VIEWER'
    return {
      uid: payload.uid,
      name: payload.name,
      color: typeof payload.color === 'string' && payload.color.length > 0 ? payload.color : '#a970ff',
      avatar: typeof payload.avatar === 'string' && payload.avatar.length > 0 ? payload.avatar : null,
      slug: typeof payload.slug === 'string' ? payload.slug : '',
      sub: payload.sub === true,
      adm: payload.adm === true,
      role,
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

/** v2.2: закреплённые сообщения (in-memory): channelSlug -> { message, until } (until=null → до конца эфира). */
const pins = new Map<string, { message: ChatMsg; until: number | null }>()

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

/** History visible to clients (deleted messages are hidden). */
function visibleHistory(slug: string): ChatMsg[] {
  return (history.get(slug) ?? []).filter((m) => !m.deleted)
}

/** v2.2: снять закреплённое сообщение канала и разослать chat:pin (message=null → анпин). */
function clearChannelPin(slug: string): boolean {
  if (!pins.delete(slug)) return false
  io.in(roomKey(slug)).emit('chat:pin', { channelSlug: slug, message: null, until: null })
  return true
}

// ---------------------------------------------------------------------------
// Moderation state helpers (sqlite)
// ---------------------------------------------------------------------------

function getChstate(slug: string): ChState {
  const row = qStateGet.get(slug)
  if (!row) return { slowSec: 0, subsonly: 1 }
  return { slowSec: Math.max(0, row.slowSec | 0), subsonly: row.subsonly ? 1 : 0 }
}

function setChstate(slug: string, patch: Partial<ChState>): ChState {
  const cur = getChstate(slug)
  const next: ChState = {
    slowSec: patch.slowSec !== undefined ? Math.max(0, Math.floor(patch.slowSec)) : cur.slowSec,
    subsonly: patch.subsonly !== undefined ? (patch.subsonly ? 1 : 0) : cur.subsonly,
  }
  qStatePut.run(slug, next.slowSec, next.subsonly)
  return next
}

function getActiveBan(uid: string): BanRow | null {
  const row = qBanGet.get(uid)
  if (!row) return null
  if (row.until === 0 || row.until > Date.now()) return row
  qBanDel.run(uid) // auto-clean the expired timeout
  return null
}

function banMessage(ban: BanRow): string {
  const reason = ban.reason ? ` Причина: ${ban.reason}.` : ''
  if (ban.until === 0) return `Вы забанены навсегда.${reason}`
  const t = new Date(ban.until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return `Вы в тайм-ауте до ${t}.${reason}`
}

/** Effective role: token role/adm, or the local mods table. */
function effectiveRole(user: ChatUser): Role {
  if (user.adm || user.role === 'OWNER') return 'OWNER'
  if (user.role === 'MOD') return 'MOD'
  if (qModGet.get(user.uid)) return 'MOD'
  return 'VIEWER'
}

// ---------------------------------------------------------------------------
// Twitch-подобные бейджи ('owner' | 'mod' | 'vip' | 'sub')
// ---------------------------------------------------------------------------

/** FNV-1a: детерминированный хеш имени (стабильные бейджи/присутствие демо-зрителей). */
function hashName(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Бейджи реального пользователя: сначала бейдж роли, затем 'sub' (как в Twitch). */
function userBadges(user: ChatUser, role: Role): string[] {
  const badges: string[] = []
  if (role === 'OWNER') badges.push('owner')
  else if (role === 'MOD') badges.push('mod')
  if (user.sub) badges.push('sub')
  return badges
}

/** v2.2: цвет ника из палитры Twitch, если валиден; иначе undefined → остаётся цвет юзера. */
function paletteColor(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const c = raw.toLowerCase()
  return TWITCH_PALETTE.includes(c) ? c : undefined
}

/** Фиксированные демо-модераторы (главный мод — сам dypaGPT, это его помощники). */
const DEMO_MODS = new Set(['MilkTea', 'PixelWitch'])

/** Детерминированные бейджи демо-зрителя: ~15% 'vip', ~50% 'sub', демо-модам — 'mod'. */
function demoBadges(name: string): string[] {
  if (DEMO_MODS.has(name)) return ['mod']
  const bucket = hashName(name) % 100
  if (bucket < 8) return ['vip']
  if (bucket < 66) return ['sub']
  return []
}

/** Find a chatter by display name: latest channel history first, then bans/mods tables. */
function findChatterByName(channel: string, name: string): { uid: string; name: string } | null {
  const target = name.trim().toLowerCase()
  if (!target) return null
  const list = history.get(channel) ?? []
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    if (m.uid && m.name.toLowerCase() === target) return { uid: m.uid, name: m.name }
  }
  const banned = qBanName.get(target)
  if (banned) return { uid: banned.uid, name: banned.name }
  const mod = qModName.get(target)
  if (mod) return { uid: mod.uid, name: mod.name }
  return null
}

function parseDuration(input: string): number | null {
  const m = /^(\d+)(s|m|h)?$/i.exec(input.trim())
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const suffix = (m[2] ?? '').toLowerCase()
  const mult = suffix === 'm' ? 60 : suffix === 'h' ? 3600 : 1
  return Math.min(2_592_000, n * mult) // seconds, capped at 30 days
}

function formatDuration(sec: number): string {
  if (sec >= 3600 && sec % 3600 === 0) return `${sec / 3600}ч`
  if (sec >= 3600) return `${Math.floor(sec / 3600)}ч ${Math.floor((sec % 3600) / 60)}м`
  if (sec >= 60) return `${Math.floor(sec / 60)}м`
  return `${sec}с`
}

// ---------------------------------------------------------------------------
// Emotes (7TV / BTTV / FFZ) — fetched, cached in sqlite, refreshed every 6h
// ---------------------------------------------------------------------------

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'backstage-chat/2.0 (+https://backstage.local)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

function pick7tvFile(files: Array<{ name?: unknown }>): string | null {
  const names = files.map((f) => (typeof f.name === 'string' ? f.name : '')).filter((n) => n.length > 0)
  if (names.length === 0) return null
  const webp = names.filter((n) => n.endsWith('.webp'))
  const pool = webp.length > 0 ? webp : names
  for (const pref of ['2x.webp', '3x.webp', '4x.webp', '1x.webp']) {
    if (pool.includes(pref)) return pref
  }
  return pool[0]
}

async function fetchEmotes(provider: string): Promise<EmoteRow[]> {
  const rows: EmoteRow[] = []
  if (provider === '7tv') {
    const data = (await fetchJson(SEVEN_TV_URL, EMOTE_FETCH_TIMEOUT_MS)) as {
      emotes?: Array<{ name?: unknown; data?: { host?: { url?: unknown; files?: Array<{ name?: unknown }> } } }>
    }
    for (const e of data.emotes ?? []) {
      const name = typeof e.name === 'string' ? e.name : null
      const hostUrl = typeof e.data?.host?.url === 'string' ? e.data.host.url : null
      if (!name || !hostUrl) continue
      const file = pick7tvFile(Array.isArray(e.data?.host?.files) ? (e.data!.host!.files as Array<{ name?: unknown }>) : [])
      if (!file) continue
      rows.push({ provider: '7tv', name, url: `https:${hostUrl.replace(/\/+$/, '')}/${file}` })
    }
  } else if (provider === 'bttv') {
    const data = (await fetchJson(BTTV_URL, EMOTE_FETCH_TIMEOUT_MS)) as Array<{ id?: unknown; code?: unknown }>
    for (const e of Array.isArray(data) ? data : []) {
      if (typeof e.code === 'string' && e.code.length > 0 && typeof e.id === 'string' && e.id.length > 0) {
        rows.push({ provider: 'bttv', name: e.code, url: `https://cdn.betterttv.net/emote/${e.id}/2x` })
      }
    }
  } else if (provider === 'ffz') {
    const data = (await fetchJson(FFZ_URL, EMOTE_FETCH_TIMEOUT_MS)) as {
      sets?: Record<string, { emoticons?: Array<{ name?: unknown; urls?: Record<string, unknown> }> }>
    }
    for (const key of Object.keys(data.sets ?? {})) {
      for (const e of data.sets[key].emoticons ?? []) {
        const name = typeof e.name === 'string' ? e.name : null
        const urls = e.urls ?? {}
        const raw =
          typeof urls['2'] === 'string'
            ? urls['2']
            : typeof urls['4'] === 'string'
              ? urls['4']
              : typeof urls['1'] === 'string'
                ? urls['1']
                : null
        if (!name || !raw) continue
        const url = raw.startsWith('//') ? `https:${raw}` : raw
        rows.push({ provider: 'ffz', name, url })
      }
    }
  }
  return rows
}

function refreshEmotes(): void {
  for (const provider of ['7tv', 'bttv', 'ffz'] as const) {
    fetchEmotes(provider)
      .then((rows) => {
        db.transaction(() => {
          qEmoteClear.run(provider)
          for (const r of rows) qEmoteInsert.run(r.provider, r.name, r.url)
        })()
        console.log(`[emotes] ${provider}: ${rows.length} cached`)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`[emotes] ${provider} refresh failed: ${msg}`)
      })
  }
}

const EMOTE_PRIORITY: Record<string, number> = { '7tv': 0, bttv: 1, ffz: 2 }

/** All emotes, deduped by name (7tv > bttv > ffz priority). */
function listEmotes(): EmoteRow[] {
  const byName = new Map<string, EmoteRow>()
  for (const row of qEmoteAll.all()) {
    const existing = byName.get(row.name)
    const p = EMOTE_PRIORITY[row.provider] ?? 9
    if (!existing || p < (EMOTE_PRIORITY[existing.provider] ?? 9)) byName.set(row.name, row)
  }
  return [...byName.values()].sort(
    (a, b) =>
      (EMOTE_PRIORITY[a.provider] ?? 9) - (EMOTE_PRIORITY[b.provider] ?? 9) || a.name.localeCompare(b.name),
  )
}

function emotesText(): string {
  const total = (qEmoteCount.get() ?? { c: 0 }).c
  if (total === 0) return 'Эмодзи ещё не загрузились — попробуйте через минуту'
  const c7 = (qEmoteCountProvider.get('7tv') ?? { c: 0 }).c
  const cb = (qEmoteCountProvider.get('bttv') ?? { c: 0 }).c
  const cf = (qEmoteCountProvider.get('ffz') ?? { c: 0 }).c
  return `Подключено ${total} эмодзи: 7TV — ${c7}, BTTV — ${cb}, FFZ — ${cf}`
}

// ---------------------------------------------------------------------------
// Main-app channel info (!uptime / !title), cached 30s
// ---------------------------------------------------------------------------

let channelsCache: { at: number; bySlug: Map<string, ChannelInfo> } | null = null

/** ChannelInfo | null (not found / offline) | 'error' (main app unreachable). */
async function fetchChannelInfo(slug: string): Promise<ChannelInfo | null | 'error'> {
  if (!channelsCache || Date.now() - channelsCache.at > CHANNELS_CACHE_MS) {
    try {
      const data = (await fetchJson(`${MAIN_APP_BASE}/api/channels`, 5000)) as { channels?: unknown[] }
      const bySlug = new Map<string, ChannelInfo>()
      if (Array.isArray(data?.channels)) {
        for (const c of data.channels) {
          const ch = c as {
            slug?: unknown
            isLive?: unknown
            liveTitle?: unknown
            liveStartedAt?: unknown
          }
          if (typeof ch.slug !== 'string' || ch.slug.length === 0) continue
          bySlug.set(ch.slug, {
            slug: ch.slug,
            isLive: ch.isLive === true,
            liveTitle: typeof ch.liveTitle === 'string' ? ch.liveTitle : null,
            liveStartedAt: typeof ch.liveStartedAt === 'string' ? ch.liveStartedAt : null,
          })
        }
      }
      channelsCache = { at: Date.now(), bySlug }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`[channels] refresh failed: ${msg}`)
      return 'error'
    }
  }
  return channelsCache.bySlug.get(slug) ?? null
}

function formatUptime(startedAt: string): string {
  const start = Date.parse(startedAt)
  if (!Number.isFinite(start)) return 'стрим сейчас не в эфире'
  const diff = Math.max(0, Date.now() - start)
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  return h > 0 ? `В ЭФИРЕ УЖЕ ${h}ч ${m}м` : `В ЭФИРЕ УЖЕ ${m}м`
}

async function uptimeText(channel: string): Promise<string> {
  const info = await fetchChannelInfo(channel)
  if (info === 'error') return 'Статус эфира временно недоступен — попробуйте позже'
  if (!info || !info.isLive || !info.liveStartedAt) return 'стрим сейчас не в эфире'
  return formatUptime(info.liveStartedAt)
}

async function titleText(channel: string): Promise<string> {
  const info = await fetchChannelInfo(channel)
  if (info === 'error') return 'Статус эфира временно недоступен — попробуйте позже'
  if (!info || !info.isLive) return 'стрим сейчас не в эфире'
  return info.liveTitle ? `Эфир: ${info.liveTitle}` : 'Название эфира не задано'
}

function commandsListText(): string {
  const custom = qCmdAll.all().map((r) => '!' + r.name)
  const base = ['!uptime', '!title', '!команды', '!эмоции']
  const all = custom.length > 0 ? base.concat(custom) : base
  return (
    `Команды чата: ${all.join(' · ')}. ` +
    'Модераторам: /ban, /unban, /timeout, /untimeout, /clear, /slow, /slowoff, /subsonly, /so, /delete, /pin, /unpin, /mod, /unmod, /cmd, /demo'
  )
}

// ---------------------------------------------------------------------------
// System messages (command replies; NOT persisted to the main app)
// ---------------------------------------------------------------------------

const BOT_NAME = 'dypaGPT'
const BOT_COLOR = '#a970ff'

function buildSystemMsg(channelSlug: string, text: string): ChatMsg {
  return {
    id: randomUUID(),
    channelSlug,
    uid: null,
    name: BOT_NAME,
    color: BOT_COLOR,
    avatar: null,
    text,
    ts: Date.now(),
    system: true,
  }
}

/** System message -> room + in-memory history (never persisted). */
function emitSystem(channelSlug: string, text: string): ChatMsg {
  const message = buildSystemMsg(channelSlug, text)
  appendHistory(channelSlug, message)
  io.in(roomKey(channelSlug)).emit('chat:message', { message })
  return message
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
  // demo chat and system/command messages live in memory only
  if (message.system) return
  if (message.uid && message.uid.startsWith('demo:')) return
  postJson(`${MAIN_APP_BASE}/api/chat/ingest`, { channelSlug, message }, 'persist')
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const PUBLIC_BUILTINS = new Set(['uptime', 'title', 'команды', 'commands', 'эмоции', 'emotes'])

interface CmdCtx {
  channel: string
  user: ChatUser
  role: Role
  args: string[]
  socket: Socket | null // present for socket.io senders, null for /api/send
}

type CmdResult =
  | { kind: 'error'; code: string; message: string; status?: number }
  | { kind: 'sender'; text: string }

function cmdError(code: string, message: string, status = 400): CmdResult {
  return { kind: 'error', code, message, status }
}

/** Substitute {name} placeholders with the caller's display name. */
function substituteName(response: string, name: string): string {
  return response.split('{name}').join(name)
}

function sanitizeCommandName(raw: string): string {
  return raw.replace(/^[!\/]+/, '').trim().toLowerCase()
}

// --- moderator /-commands ---------------------------------------------------

const OWNER_ONLY_COMMANDS = new Set(['mod', 'unmod', 'demo'])

async function cmdBan(ctx: CmdCtx): Promise<CmdResult | void> {
  const target = ctx.args[0]
  if (!target) return cmdError('bad_args', 'Использование: /ban <ник> [причина]')
  const reason = ctx.args.slice(1).join(' ').trim()
  const found = findChatterByName(ctx.channel, target)
  if (!found) return cmdError('user_not_found', `${target} не найден в чате`, 404)
  qBanPut.run(found.uid, found.name, reason, 0)
  emitSystem(ctx.channel, `${found.name} забанен модератором. Причина: ${reason || 'не указана'}`)
}

async function cmdUnban(ctx: CmdCtx): Promise<CmdResult | void> {
  const target = ctx.args[0]
  if (!target) return cmdError('bad_args', 'Использование: /unban <ник>')
  const found = findChatterByName(ctx.channel, target)
  if (!found) return cmdError('user_not_found', `${target} не найден в чате`, 404)
  qBanDel.run(found.uid)
  emitSystem(ctx.channel, `${found.name} снова может писать в чат`)
}

async function cmdTimeout(ctx: CmdCtx): Promise<CmdResult | void> {
  const target = ctx.args[0]
  const durRaw = ctx.args[1]
  if (!target || !durRaw) {
    return cmdError('bad_args', 'Использование: /timeout <ник> <время: 30, 10s, 5m, 1h> [причина]')
  }
  const dur = parseDuration(durRaw)
  if (!dur) return cmdError('bad_args', 'Не понял длительность. Примеры: 30, 10s, 5m, 1h')
  const reason = ctx.args.slice(2).join(' ').trim()
  const found = findChatterByName(ctx.channel, target)
  if (!found) return cmdError('user_not_found', `${target} не найден в чате`, 404)
  qBanPut.run(found.uid, found.name, reason, Date.now() + dur * 1000)
  emitSystem(
    ctx.channel,
    `${found.name} отправлен в тайм-аут на ${formatDuration(dur)}. Причина: ${reason || 'не указана'}`,
  )
}

async function cmdClear(ctx: CmdCtx): Promise<CmdResult | void> {
  history.delete(ctx.channel)
  io.in(roomKey(ctx.channel)).emit('chat:clear', { channelSlug: ctx.channel })
  emitSystem(ctx.channel, 'Чат очищен модератором')
}

async function cmdSlow(ctx: CmdCtx): Promise<CmdResult | void> {
  const sec = parseInt(ctx.args[0] ?? '', 10)
  if (!Number.isFinite(sec) || sec < 1) return cmdError('bad_args', 'Использование: /slow <секунд>')
  const slowSec = Math.min(86_400, sec)
  setChstate(ctx.channel, { slowSec })
  emitSystem(ctx.channel, `Режим медленного чата: не чаще одного сообщения в ${slowSec}с`)
}

async function cmdSlowoff(ctx: CmdCtx): Promise<CmdResult | void> {
  setChstate(ctx.channel, { slowSec: 0 })
  emitSystem(ctx.channel, 'Медленный чат выключен')
}

async function cmdSubsonly(ctx: CmdCtx): Promise<CmdResult | void> {
  const arg = (ctx.args[0] ?? '').toLowerCase()
  if (arg !== 'on' && arg !== 'off') return cmdError('bad_args', 'Использование: /subsonly on|off')
  setChstate(ctx.channel, { subsonly: arg === 'on' ? 1 : 0 })
  emitSystem(ctx.channel, arg === 'on' ? 'Чат переведён в режим «только подписчики»' : 'Чат открыт для всех')
}

async function cmdShoutout(ctx: CmdCtx): Promise<CmdResult | void> {
  const target = ctx.args[0]
  if (!target) return cmdError('bad_args', 'Использование: /so <ник>')
  emitSystem(ctx.channel, `🎉 ПОДДЕРЖИМ ${target}! Загляните на канал — там вайб`)
}

async function cmdDelete(ctx: CmdCtx): Promise<CmdResult | void> {
  const id = ctx.args[0]
  if (!id) return cmdError('bad_args', 'Использование: /delete <id сообщения>')
  const list = history.get(ctx.channel) ?? []
  const msg = list.find((m) => m.id === id)
  if (!msg || msg.deleted) return cmdError('not_found', 'Сообщение не найдено', 404)
  msg.deleted = true
  io.in(roomKey(ctx.channel)).emit('chat:delete', { channelSlug: ctx.channel, ids: [id] })
}

async function cmdPin(ctx: CmdCtx): Promise<CmdResult | void> {
  const id = ctx.args[0]
  const durRaw = ctx.args[1]
  if (!id) return cmdError('bad_args', 'Использование: /pin <id сообщения> [длительность: 30, 10s, 5m, 1h]')
  const list = history.get(ctx.channel) ?? []
  const msg = list.find((m) => m.id === id)
  if (!msg || msg.deleted) return cmdError('not_found', 'Сообщение не найдено', 404)
  let until: number | null = null // null = до конца эфира
  if (durRaw) {
    const dur = parseDuration(durRaw)
    if (!dur) return cmdError('bad_args', 'Не понял длительность. Примеры: 30, 10s, 5m, 1h')
    until = Date.now() + dur * 1000
  }
  const pinned: ChatMsg = { ...msg } // копия: /delete или /clear исходного не ломает баннер
  pins.set(ctx.channel, { message: pinned, until })
  io.in(roomKey(ctx.channel)).emit('chat:pin', { channelSlug: ctx.channel, message: pinned, until })
  emitSystem(ctx.channel, `Закреплено сообщение от ${pinned.name}`)
}

async function cmdUnpin(ctx: CmdCtx): Promise<CmdResult | void> {
  if (!pins.has(ctx.channel)) return cmdError('no_pin', 'Сообщение не закреплено')
  clearChannelPin(ctx.channel)
}

async function cmdMod(ctx: CmdCtx): Promise<CmdResult | void> {
  const target = ctx.args[0]
  if (!target) return cmdError('bad_args', 'Использование: /mod <ник>')
  const found = findChatterByName(ctx.channel, target)
  if (!found) return cmdError('user_not_found', `${target} не найден в чате`, 404)
  qModPut.run(found.uid, found.name, ctx.user.name)
  emitSystem(ctx.channel, `${found.name} теперь модератор 🔑`)
}

async function cmdUnmod(ctx: CmdCtx): Promise<CmdResult | void> {
  const target = ctx.args[0]
  if (!target) return cmdError('bad_args', 'Использование: /unmod <ник>')
  const found = findChatterByName(ctx.channel, target)
  if (!found) return cmdError('user_not_found', `${target} не найден в чате`, 404)
  qModDel.run(found.uid)
  emitSystem(ctx.channel, `${found.name} больше не модератор`)
}

async function cmdCustom(ctx: CmdCtx): Promise<CmdResult | void> {
  const sub = (ctx.args[0] ?? '').toLowerCase()
  if (sub === 'add') {
    const name = sanitizeCommandName(ctx.args[1] ?? '')
    const response = ctx.args.slice(2).join(' ').trim()
    if (!name || name.length > 32 || /\s/.test(name)) {
      return cmdError('bad_args', 'Использование: /cmd add <имя> <текст ответа>')
    }
    if (response.length < 1 || response.length > 400) {
      return cmdError('bad_args', 'Текст ответа: от 1 до 400 символов')
    }
    if (PUBLIC_BUILTINS.has(name)) return cmdError('bad_args', 'Это имя занято встроенной командой')
    qCmdPut.run(name, response, ctx.user.name)
    emitSystem(ctx.channel, `Команда !${name} добавлена`)
    return
  }
  if (sub === 'remove') {
    const name = sanitizeCommandName(ctx.args[1] ?? '')
    if (!name) return cmdError('bad_args', 'Использование: /cmd remove <имя>')
    const existing = qCmdGet.get(name)
    if (!existing) return cmdError('not_found', `Команда !${name} не найдена`, 404)
    qCmdDel.run(name)
    emitSystem(ctx.channel, `Команда !${name} удалена`)
    return
  }
  if (sub === 'list') {
    const rows = qCmdAll.all()
    const text = rows.length > 0 ? `Кастомные команды: ${rows.map((r) => '!' + r.name).join(', ')}` : 'Кастомных команд пока нет'
    return { kind: 'sender', text }
  }
  return cmdError('bad_args', 'Использование: /cmd add <имя> <текст> | /cmd remove <имя> | /cmd list')
}

async function cmdDemo(ctx: CmdCtx): Promise<CmdResult | void> {
  const arg = (ctx.args[0] ?? '').toLowerCase()
  if (arg !== 'on' && arg !== 'off') return cmdError('bad_args', 'Использование: /demo on|off')
  demoEnabled = arg === 'on'
  setSetting('demo', arg === 'on' ? '1' : '0')
  if (!demoEnabled) {
    nextDemoAt.clear()
    demoPresence.clear() // демо-зрители исчезают из «кто в чате» сразу
    demoViewers.clear() // симулированный онлайн сбрасывается
    demoHype.clear()
    resetDemoPresence() // чату сразу возвращаем реальный счётчик
    pushViewersNow() // и витрину тоже — без ожидания 10с-таймера
  }
  emitSystem(ctx.channel, `Демо-чат ${arg === 'on' ? 'включён' : 'выключен'}`)
  broadcastChatters(ctx.channel) // сразу обновляем список «кто в чате»
}

const MOD_COMMANDS: Record<string, (ctx: CmdCtx) => Promise<CmdResult | void>> = {
  ban: cmdBan,
  unban: cmdUnban,
  timeout: cmdTimeout,
  untimeout: cmdUnban,
  clear: cmdClear,
  slow: cmdSlow,
  slowoff: cmdSlowoff,
  subsonly: cmdSubsonly,
  so: cmdShoutout,
  delete: cmdDelete,
  pin: cmdPin,
  unpin: cmdUnpin,
  mod: cmdMod,
  unmod: cmdUnmod,
  cmd: cmdCustom,
  demo: cmdDemo,
}

// --- public !-commands ------------------------------------------------------

async function tryPublicCommand(channel: string, user: ChatUser, name: string): Promise<boolean> {
  if (name === 'uptime') {
    emitSystem(channel, await uptimeText(channel))
    return true
  }
  if (name === 'title') {
    emitSystem(channel, await titleText(channel))
    return true
  }
  if (name === 'команды' || name === 'commands') {
    emitSystem(channel, commandsListText())
    return true
  }
  if (name === 'эмоции' || name === 'emotes') {
    emitSystem(channel, emotesText())
    return true
  }
  const custom = qCmdGet.get(name)
  if (custom) {
    emitSystem(channel, substituteName(custom.response, user.name))
    return true
  }
  return false
}

/**
 * Command dispatcher. Returns handled=false when the text is NOT a recognized
 * command (unknown "!..." falls through as a normal chat message, exactly
 * like on Twitch). Mod commands from VIEWERs are swallowed with a
 * sender-only "forbidden" error.
 */
async function tryCommand(
  channel: string,
  user: ChatUser,
  text: string,
  socket: Socket | null,
): Promise<{ handled: boolean; result?: CmdResult }> {
  const parts = text.split(/\s+/)
  const head = parts[0]
  const args = parts.slice(1)

  if (head.startsWith('/')) {
    const role = effectiveRole(user)
    const name = head.slice(1).trim().toLowerCase()
    if (role === 'VIEWER') {
      return {
        handled: true,
        result: cmdError('forbidden', 'Команды модератора доступны только модерам и владельцу', 403),
      }
    }
    const handler = MOD_COMMANDS[name]
    if (!handler) {
      return { handled: true, result: cmdError('unknown_command', `Неизвестная команда ${head}. Введите !команды`) }
    }
    if (OWNER_ONLY_COMMANDS.has(name) && role !== 'OWNER') {
      return { handled: true, result: cmdError('forbidden', 'Эта команда доступна только владельцу канала', 403) }
    }
    const result = await handler({ channel, user, role, args, socket })
    return { handled: true, result }
  }

  if (head.startsWith('!')) {
    const name = head.slice(1).trim().toLowerCase()
    const handled = await tryPublicCommand(channel, user, name)
    return handled ? { handled: true } : { handled: false }
  }

  return { handled: false }
}

// ---------------------------------------------------------------------------
// Core message pipeline (shared by socket chat:send and POST /api/send)
// ---------------------------------------------------------------------------

interface PipelineResult {
  ok: boolean
  code?: string
  message?: string
  status?: number
  /** normal accepted message */
  msg?: ChatMsg
  /** accepted command; senderOnly carries a private reply (/cmd list) */
  command?: boolean
  senderOnly?: ChatMsg
}

async function processChatText(
  channel: string,
  user: ChatUser,
  text: string,
  socket: Socket | null,
  color?: string, // v2.2: валидированный цвет ника (палитра Twitch); отсутствует → цвет юзера
): Promise<PipelineResult> {
  // 1. ban / active timeout
  const ban = getActiveBan(user.uid)
  if (ban) {
    return { ok: false, code: 'banned', message: banMessage(ban), status: 403 }
  }

  // 2. text validation
  if (text.length < 1 || text.length > 500) {
    return { ok: false, code: 'bad_text', message: 'Сообщение должно содержать от 1 до 500 символов', status: 400 }
  }

  // 3. subscriber-only gate (MOD/OWNER bypass; default on — v1 behaviour)
  const st = getChstate(channel)
  const role = effectiveRole(user)
  if (st.subsonly === 1 && user.sub !== true && role === 'VIEWER') {
    return { ok: false, code: 'subscribers_only', message: 'Чат доступен только платным подписчикам', status: 403 }
  }

  // 4. commands — handled BEFORE the rate limit, never persisted
  if (text.startsWith('/') || text.startsWith('!')) {
    const cmd = await tryCommand(channel, user, text, socket)
    if (cmd.handled) {
      const result: PipelineResult = { ok: true, command: true }
      if (cmd.result && cmd.result.kind === 'error') {
        result.ok = false
        result.code = cmd.result.code
        result.message = cmd.result.message
        result.status = cmd.result.status
        result.command = false
      } else if (cmd.result && cmd.result.kind === 'sender') {
        result.senderOnly = buildSystemMsg(channel, cmd.result.text)
      }
      return result
    }
    // unknown "!command" — falls through as a normal message
  }

  // 5. rate limit (slow mode raises the per-uid window)
  const minInterval = Math.max(RATE_LIMIT_MS, st.slowSec * 1000)
  const now = Date.now()
  const last = lastSentAt.get(user.uid)
  if (last !== undefined && now - last < minInterval) {
    return { ok: false, code: 'rate_limited', message: 'Слишком часто. Подождите немного', status: 429 }
  }

  // 6. accept
  const message: ChatMsg = {
    id: randomUUID(),
    channelSlug: channel,
    uid: user.uid,
    name: user.name,
    color: color ?? user.color, // v2.2: override цвета ника из палитры Twitch
    avatar: user.avatar,
    text,
    ts: now,
    system: false,
  }
  if (role === 'OWNER' || role === 'MOD') message.role = role
  message.badges = userBadges(user, role) // Twitch-подобные бейджи для нового UI
  lastSentAt.set(user.uid, now)
  appendHistory(channel, message)
  io.in(roomKey(channel)).emit('chat:message', { message })
  persistMessage(channel, message) // fire-and-forget (skips demo:/system)
  return { ok: true, msg: message }
}

// ---------------------------------------------------------------------------
// Demo chat (fake VTuber viewers; in-memory only, never persisted)
// ---------------------------------------------------------------------------

const DEMO_USERS: Array<{ name: string; color: string }> = [
  { name: 'нэко_фан', color: '#ff7bac' },
  { name: 'MilkTea', color: '#7bd3ff' },
  { name: 'PixelWitch', color: '#a970ff' },
  { name: 'караоке_фан2007', color: '#ffb86b' },
  { name: 'Соня_смотрит', color: '#c3e88d' },
  { name: 'DeepDarkFan', color: '#8be9fd' },
  { name: 'Гоша_клава', color: '#f97ac0' },
  { name: 'NEETmode', color: '#d6bcff' },
  { name: 'vibe_check', color: '#5ad1a4' },
  { name: 'Аниме_Мама', color: '#ff8080' },
  { name: 'лягушка_ква', color: '#a6e22e' },
  { name: 'Профессор_Хаос', color: '#f78c6c' },
  { name: 'ramen_enjoyer', color: '#e6db74' },
  { name: 'Тихая_Гря', color: '#fd971f' },
]

// Реплики без эмодзи: вместо них — ТОКЕНЫ КАСТОМНЫХ СМОЙЛОВ (7TV/BTTV/FFZ),
// которые фронтенд и оверлей рендерят картинками; дубли по 2-3 подряд —
// как настоящий спам смайлами в Twitch.
const DEMO_TEXTS: string[] = [
  'ГОЙДА НА КВЕСТ',
  'LuL она опять сгорела',
  'какая песня?? шазам не берёт',
  'РАСПИСАНИЕ ГДЕ',
  'стрим дня спасён',
  'этот босс на 1 хп FeelsWeirdMan',
  'донатик улетел',
  'лавандовый вайб AYAYA',
  'chat двигайся',
  'суб-чат лучший',
  '!uptime',
  'BasedGod',
  'сегодня караоке??',
  'модер тут железный',
  'топ-1 стримерша',
  'clutch of the year EZ',
  'обожаю этот смайл peepoHappy',
  'первый!!',
  'ложусь спать… шучу смотрю дальше',
  'EZ Clap',
  'дайте две',
  'чай заварен, продолжаем',
  'Clap Clap Clap',
  'ой всё',
  'вайб непередаваемый',
  'подписка оформлена, я дома',
  'СОТКА УШЛА, СПАСИБО AYAYA AYAYA AYAYA',
  'ЭТО ЖЕ ЛЕГЕНДАРНЫЙ КЛИП Clap Clap',
  'пересматриваю 3 раз, всё равно смешно LuL LuL LuL',
  'салют в чат peepoHappy peepoHappy',
  'у неё сегодня просто лучшая форма FeelsStrongMan',
  'смотрю с телефона под одеялом peepoSad',
  'ГОЛОС КАКОЙ gachiGASM gachiGASM gachiGASM',
  'котика покажи!! PETPET PETPET',
  'яндекс.драйв продаёт ваш мерч?? WatChuSay',
  'звук топ, картинка топ, ведущая топ Clap',
  'супер-чатик прочитают?? monkaS monkaS',
  'где мерч, я готов платить',
  'чаёк с лимоном и стрим TeaTime',
  'лайк поставил, колокол зазвонил',
  'ДАВАЙ ЕЩЁ РАУНД FeelsStrongMan FeelsStrongMan',
  'мама, я в чате известного стримера BasedGod',
  'как всегда шикарно peepoHappy peepoHappy',
  'аплодирую стоя Clap Clap Clap',
  'ВОТ ЭТО УРОВЕНЬ BibleThump',
  'чат живее всех живых ffzHyper ffzHyper',
  'неужели победим?? BibleThump BibleThump BibleThump',
  'С ДНЁМ РОЖДЕНИЯ ЧАТ PartyParrot PartyParrot PartyParrot',
  'печеньки передаю CatBag CatBag',
  'уже 2 часа смотрю, как летит время',
  'эй, кто выключил свет… а, это сцена monkaS',
  'прошу аниме-опенинг в караоке gachiGASM',
  'забойный вайб, залип на весь вечер ffzJam',
  'сосед стучит — говорит громко смеюсь LuL',
  'у меня мурашки gachiGASM',
  'ЧТО ПРОИСХОДИТ, Я НЕ ПОНИМАЮ monkaS monkaS monkaS',
  'ловлю минуты кайфа TeaTime',
  'ПОРА ДЕЛАТЬ КЛИПЫ',
  'эта катка войдёт в историю Clap Clap',
  'подписался на все соцсети сразу',
  'зубрю теорию и смотрю стрим — идеальный вечер',
  'ЧАТ, ПОДДЕРЖИМ АПЛОДИСМЕНТАМИ Clap Clap Clap',
  'я тут новенький, приветики peepoHappy peepoHappy',
  'ОНА СДЕЛАЛА ЭТО EZ Clap EZ',
  'у меня финал завтра, но стрим важнее FeelsBadMan',
  'летсплей-интенсивность просто зашкаливает ffzHyper',
  'кийф, кайф и восхитительное слово «кулак»',
  'стакан воды не забывай, ведущая!',
  'давайте соберём сто лайков',
  'финальный босс дрожит monkaS',
  'этот момент — в топ чата',
  'лучший вечер недели',
  'МОЛОДЦА, ЧАТ ПРАВИЛЬНЫЙ Clap Clap',
  'обожаю когда план срабатывает BasedGod',
  'танцую на кухне PartyParrot PartyParrot',
  'звёзды сошлись, стрим ровно в этот вечер',
  'у меня чат-зависимость xdx',
  'спасибо за настроение на всю неделю peepoHappy',
  'КТО ПОСТАВИЛ ГЛОБАЛЬНЫЙ ТУРБО-РЕКОРД ffzBounce',
  'стрим безупречен, как всегда Wowee Wowee',
  'стрим — терапия',
  'ВОТ ТАКАЯ ФИНАЛЬНАЯ СЕРИЯ BibleThump BibleThump',
  // ── волна 2: чистый смайл-спам (по 2-3 одинаковых) ──
  'AYAYA AYAYA AYAYA',
  'LuL LuL LuL',
  'haHAA haHAA haHAA',
  'peepoHappy peepoHappy peepoHappy',
  'monkaS monkaS',
  'Clap Clap Clap',
  'EZ Clap EZ Clap',
  'FeelsGoodMan FeelsGoodMan',
  'FeelsStrongMan FeelsStrongMan FeelsStrongMan',
  'BibleThump BibleThump BibleThump',
  'forsenPls forsenPls forsenPls',
  'PartyParrot PartyParrot PartyParrot',
  'SourPls SourPls SourPls',
  'ffzJam ffzJam',
  'ffzHyper ffzHyper ffzHyper',
  'gachiGASM gachiGASM',
  'Stare Stare Stare',
  'xdx xdx xdx',
  'glorp glorp glorp',
  'PETPET PETPET',
  'D: D: D:',
  'peepoSad peepoSad',
  'KKona KKona',
  'NaM NaM NaM',
  'WAYTOODANK WAYTOODANK',
  'VapeNation VapeNation',
  'GabeN GabeN GabeN',
  'YooHoo YooHoo',
  'Wowee Wowee Wowee',
  'CatBag CatBag CatBag',
  'AlienDance AlienDance AlienDance',
  'Hhhehehe Hhhehehe',
  'aceStare aceStare aceStare',
  'bttvNice bttvNice',
  'PepePls PepePls PepePls',
  'ffzSpin ffzSpin',
  'ffzRainbow ffzRainbow ffzRainbow',
  'RareParrot RareParrot',
  'ForeverAlone ForeverAlone ForeverAlone',
  'DogChamp DogChamp',
  'ShoopDaWhoop ShoopDaWhoop ShoopDaWhoop',
  'cvHazmat cvHazmat cvHazmat',
  'ApuApustaja ApuApustaja',
  'ConcernDoge ConcernDoge ConcernDoge',
  'xdx LuL xdx',
  'AYAYA Clap AYAYA',
  'monkaS FeelsWeirdMan monkaS',
  'LuL AYAYA LuL',
  'peepoHappy peepoPls peepoHappy',
  'gachiBASS gachiGASM gachiBASS',
  'Clap BasedGod Clap',
  'Stare monkaS Stare',
  'haHAA LuL haHAA',
  // ── волна 3: живые реплики с смайлами-токенами ──
  'AYAYA AYAYA она снова это сделала',
  'LuL чат, я не могу LuL LuL',
  'monkaS монка, у меня руки трясутся monkaS',
  'Clap Clap Clap виват ведущей',
  'это было чисто EZ',
  'FeelsWeirdMan стрим без неё не тот FeelsWeirdMan',
  'peepoHappy я готов к двухчасовому марафону',
  'haHAA шутка уровня чата haHAA',
  'BibleThump прощай, рейтинг BibleThump',
  'AYAYA аригато за эфир AYAYA AYAYA',
  'ffzJam врубайте этот трек на репит ffzJam',
  'gachiGASM какой голос gachiGASM',
  'Stare она сейчас без эмоций это сказала Stare',
  'monkaS не заходи туда monkaS monkaS',
  'Clap спасибо модам за порядок Clap',
  'LuL перекат с двумя хп LuL LuL LuL',
  'peepoSad я всё пропустил peepoSad',
  'xdx шалость удалась xdx xdx',
  'PartyParrot весь чат танцует PartyParrot PartyParrot',
  'танцы начинаются SourPls SourPls',
  'forsenPls тот самый момент forsenPls forsenPls',
  'PetThePeepo PETPET гладим PETPET',
  'D: что. это. было. D: D:',
  'KKona где моя ковбойская шляпа KKona',
  'NaM язык жестов уровня чата NaM',
  'GabeN три GabeN GabeN GabeN и оффлайн',
  'VapeNation затянулся вайбом VapeNation',
  'Wowee ясно,понятно Wowee Wowee',
  'CatBag кота в студию CatBag CatBag',
  'Hhhehehe смешно до слёз Hhhehehe Hhhehehe',
  'bttvNice чисто bttvNice',
  'cvHazmat чат, соблюдайте дистанцию cvHazmat',
  'ForeverAlone один — не один ForeverAlone',
  'ShoopDaWhoop заряжаю ШУП ShoopDaWhoop',
  'peepoPls умоляю, сделай клип peepoPls peepoPls',
  'ffzSpin голова кругом ffzSpin ffzSpin',
  'RareParrot редкий гость RareParrot RareParrot',
  'аAAAAAAAA она свернула AYAYA AYAYA',
  'по классике заходим LuL',
  'через пень колоду, но прошли LuL',
  'статистика на нуле FeelsBadMan FeelsBadMan',
  'чайник уже кипит TeaTime TeaTime',
  'субтитры сломались WatChuSay WatChuSay',
  'громче микрофон, соседи не слышат VapeNation',
  'мама спросила, почему я смеюсь LuL LuL',
  'карту подсказывай, чат добрый Stare',
  'поставь на паузу, чай наливается TeaTime',
  'клавиатура топ, слышно прекрасно Clap Clap',
  'рой ватрушек на экране ffzBounce ffzBounce',
  'аплодисменты в чате Clap Clap Clap Clap',
  'у меня подписка на всё BasedGod BasedGod',
  'сон отменился, смотрим дальше ffzHyper',
  'суперсонная реакция EZ Clap',
  'лучший монтаж — живой PepePls',
  'хочу этот фрагмент в клип gachiGASM',
  'танцпол открыт PartyParrot PartyParrot PartyParrot',
  'прошу без спойлеров monkaS monkaS monkaS',
  'что за трек?? AYAYA скажи',
  'настроение чата: ffzHyper ffzHyper ffzHyper',
  'мурашки от этого момента gachiGASM gachiGASM',
  'чат, не забываем водичку peepoHappy',
  'у кого сколько хп? monkaS',
  'стрим-марафон продолжается FeelsStrongMan',
  'пицца заказана, продолжаем TeaTime',
  'уровень прокачан EZ',
  'записываю рецепт победы PepePls PepePls',
  'дайте две пиццы PartyParrot',
  'последний круг, чат верит Clap Clap',
  'мой смайл — мой характер AYAYA',
  'чай остывает, эфир греет TeaTime TeaTime',
  'коллективный разум активирован BasedGod BasedGod',
]

const DEMO_USERS_BY_NAME = new Map(DEMO_USERS.map((u) => [u.name, u] as const))

const nextDemoAt = new Map<string, number>() // channelSlug -> next demo message ts

// ── «Хайп»-волны: чат то спокойный, то взрывается ─────────────────────
// level ∈ [0..1]: 0 — «тихая» фаза (репко раз в ~15с), 1 — «злая»
// (сообщения почти подряд + бёрсты). Цель (target) меняется раз в 25-70с,
// уровень медленно тянется к ней — живой пульс чата как в Twitch.
const DEMO_GAP_CALM = 15_000 // пауза при level → 0
const DEMO_GAP_HYPE = 1_100 // пауза при level → 1
const DEMO_BURST_LEVEL = 0.6 // с какого уровня начинаются бёрсты 2-4 подряд
type DemoHype = { level: number; target: number; retargetAt: number }
const demoHype = new Map<string, DemoHype>()

function hypeOf(slug: string): DemoHype {
  let h = demoHype.get(slug)
  if (!h) {
    h = {
      level: 0.12 + Math.random() * 0.25,
      target: 0.35 + Math.random() * 0.55,
      retargetAt: Date.now() + 20_000 + Math.floor(Math.random() * 40_000),
    }
    demoHype.set(slug, h)
  }
  return h
}

/** Шаг эволюции хайпа: тянем level к target, target периодически меняем. */
function stepHype(slug: string): void {
  const h = hypeOf(slug)
  if (Date.now() >= h.retargetAt) {
    // новая цель: чаще около середины, иногда — «пожар» или «полная тишина»
    const roll = Math.random()
    h.target = roll < 0.18 ? 0.05 + Math.random() * 0.15 : roll > 0.82 ? 0.75 + Math.random() * 0.25 : 0.3 + Math.random() * 0.4
    h.retargetAt = Date.now() + 25_000 + Math.floor(Math.random() * 45_000)
  }
  const step = 0.015 + Math.random() * 0.05
  h.level += h.target > h.level ? step : -step
  h.level = Math.min(1, Math.max(0, h.level))
}

/** Пауза до следующего сообщения с учётом текущего уровня хайпа. */
function demoGapMs(level: number): number {
  const base = DEMO_GAP_CALM - level * (DEMO_GAP_CALM - DEMO_GAP_HYPE)
  return Math.max(600, Math.round(base * (0.75 + Math.random() * 0.5)))
}
/** Редкие реплики демо-модераторов — их бейдж 'mod' виден в чате. */
const DEMO_MOD_TEXTS: string[] = [
  'чат, не спамим Clap',
  'культурно, пожалуйста',
  'вопросы — в !команды, там всё есть',
  'напоминаю: !эмоции — список смайлов',
  'мут не выношу, но капс прикручу Stare',
  'следим за вайбом, всем добра',
  'ссылки только в личку, правила есть правила',
  'смайл-спам по чуть-чуть, ладно? peepoSad',
  'по темпу не отставаем ffzHyper',
  'прошу без капса, ведущая всё слышит monkaS',
]

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

/** forced = «принудительный» спикер (демо-модератор со своей репликой). */
function emitDemoMessage(slug: string, forced?: { user: { name: string; color: string }; text: string }): void {
  const u = forced?.user ?? pick(DEMO_USERS)
  const text = forced?.text ?? pick(DEMO_TEXTS)
  const message: ChatMsg = {
    id: randomUUID(),
    channelSlug: slug,
    uid: `demo:${u.name}`,
    name: u.name,
    color: u.color,
    avatar: null,
    text,
    ts: Date.now(),
    system: false,
  }
  message.badges = demoBadges(u.name)
  appendHistory(slug, message)
  io.in(roomKey(slug)).emit('chat:message', { message })
  if (text.startsWith('!')) {
    // demo viewers can trigger public commands too (!uptime etc.)
    const pseudo: ChatUser = {
      uid: message.uid as string,
      name: u.name,
      color: u.color,
      avatar: null,
      slug: '',
      sub: true,
      adm: false,
      role: 'VIEWER',
      exp: Number.MAX_SAFE_INTEGER,
    }
    tryPublicCommand(slug, pseudo, text.split(/\s+/)[0].slice(1).trim().toLowerCase()).catch(
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`[demo] command failed: ${msg}`)
      },
    )
  }
}

// демо-чат: раз в 1.5с проверяем, не пора ли подсунуть сообщение.
// Интенсивность динамическая: «хайп» каждого канала живёт своей волной
// (тихие фазы ~15с между репликами → бешеные с бёрстами по 2-4 подряд).
// (таймер ставится через startDemoTimer — см. ensureBackground ниже)
function startDemoTimer(): void {
  setInterval(() => {
    if (!demoEnabled) return
    const now = Date.now()
    for (const [room, members] of io.sockets.adapter.rooms) {
      const name = String(room)
      if (!name.startsWith('ch:')) continue // skip per-socket rooms
      if (members.size === 0) continue
      const slug = name.slice(3)
      stepHype(slug)
      const at = nextDemoAt.get(slug)
      if (at === undefined) {
        nextDemoAt.set(slug, now + 2000 + Math.floor(Math.random() * 5000))
        continue
      }
      if (now < at) continue
      const level = hypeOf(slug).level
      nextDemoAt.set(slug, now + demoGapMs(level))
      emitDemoMessage(slug, maybeModMessage(slug))
      // бёрст: при высоком хайпе реплики летят очередью 2-4 подряд
      if (level >= DEMO_BURST_LEVEL && Math.random() < 0.45) {
        const extra = 1 + Math.floor(Math.random() * 3)
        for (let i = 1; i <= extra; i++) {
          setTimeout(() => {
            if (!demoEnabled) return
            const r = io.sockets.adapter.rooms.get(roomKey(slug))
            if (!r || r.size === 0) return
            emitDemoMessage(slug)
          }, Math.round(i * (500 + Math.random() * 800)))
        }
      }
    }
  }, 1500)
}

/** ~15% демо-сообщений пишет модератор из присутствующих в комнате. */
function maybeModMessage(slug: string): { user: { name: string; color: string }; text: string } | undefined {
  if (Math.random() >= 0.15) return undefined
  const mods = [...getDemoPresence(slug)].filter((n) => DEMO_MODS.has(n))
  if (mods.length === 0) return undefined
  const u = DEMO_USERS_BY_NAME.get(pick(mods))
  if (!u) return undefined
  return { user: u, text: pick(DEMO_MOD_TEXTS) }
}

// ---------------------------------------------------------------------------
// Chatters list («кто в чате», community-drawer как в Twitch)
// ---------------------------------------------------------------------------

const CHATTERS_INTERVAL_MS = 15_000
const DEMO_PRESENCE_MIN = 6 // нижняя граница при «уходах»
const DEMO_PRESENCE_MAX = 12 // верхняя граница набора демо-зрителей
const DEMO_PRESENCE_BASE = 8 // стартовый размер набора (8..12 по хешу slug)

const demoPresence = new Map<string, Set<string>>() // channelSlug -> имена присутствующих демо-зрителей

let bgTickAt = 0 // диагностика /health: последний тик 15с-таймера (0 = ещё не тикал)
let bgTimeoutAt = 0 // диагностика /health: сработал ли отложенный setTimeout (из ensureBackground)
let healthProbeAt = 0 // диагностика /health: setTimeout, созданный прямо в обработчике запроса

const BADGE_RANK: Record<string, number> = { owner: 0, mod: 1, vip: 2, sub: 3 }

/** Приоритет бейджа в списке: owner -> mod -> vip -> sub -> обычный зритель. */
function chatterRank(badges: string[]): number {
  let rank = 9
  for (const b of badges) rank = Math.min(rank, BADGE_RANK[b] ?? 9)
  return rank
}

/** Стабильный стартовый набор демо-зрителей канала (8–12, детерминированно по slug). */
function initDemoPresence(slug: string): Set<string> {
  const sorted = [...DEMO_USERS].sort((a, b) => hashName(slug + '|' + a.name) - hashName(slug + '|' + b.name))
  const count = DEMO_PRESENCE_BASE + (hashName(slug) % (DEMO_PRESENCE_MAX - DEMO_PRESENCE_BASE + 1))
  const presence = new Set(sorted.slice(0, count).map((u) => u.name))
  if (![...presence].some((n) => DEMO_MODS.has(n))) {
    presence.add('MilkTea') // хотя бы один демо-мод всегда в списке
    if (presence.size > DEMO_PRESENCE_MAX) {
      const plain = [...presence].find((n) => !DEMO_MODS.has(n))
      if (plain) presence.delete(plain)
    }
  }
  return presence
}

/** Присутствие демо-зрителей канала (ленивая инициализация). */
function getDemoPresence(slug: string): Set<string> {
  let presence = demoPresence.get(slug)
  if (!presence) {
    presence = initDemoPresence(slug)
    demoPresence.set(slug, presence)
  }
  return presence
}

/** Лёгкое шевеление демо-присутствия: редкий приход/уход зрителя. */
function churnDemoPresence(slug: string): void {
  const presence = getDemoPresence(slug)
  const absent = DEMO_USERS.filter((u) => !presence.has(u.name))
  if (presence.size < DEMO_PRESENCE_MAX && absent.length > 0 && Math.random() < 0.3) {
    presence.add(pick(absent).name)
    return
  }
  if (presence.size > DEMO_PRESENCE_MIN && Math.random() < 0.2) {
    // модераторов стараемся не трогать — пусть стабильно висят в списке
    const plain = [...presence].filter((n) => !DEMO_MODS.has(n))
    if (plain.length > 0) presence.delete(pick(plain))
  }
}

/** Список «кто в чате»: реальные подключённые пользователи + демо-зрители. */
function buildChatters(slug: string): { channelSlug: string; chatters: Chatter[]; count: number } {
  const byUid = new Map<string, Chatter>()
  const room = io.sockets.adapter.rooms.get(roomKey(slug))
  if (room) {
    for (const sid of room) {
      const s = io.sockets.sockets.get(sid)
      const user = (s?.data?.user ?? null) as ChatUser | null
      if (!user) continue // анонимные watch-сокеты (оверлей) в список не входят
      if (byUid.has(user.uid)) continue // один юзер в нескольких вкладках
      byUid.set(user.uid, {
        uid: user.uid,
        name: user.name,
        color: user.color,
        avatar: user.avatar,
        badges: userBadges(user, effectiveRole(user)),
      })
    }
  }
  if (demoEnabled) {
    for (const name of getDemoPresence(slug)) {
      const u = DEMO_USERS_BY_NAME.get(name)
      if (!u) continue
      const uid = `demo:${name}`
      byUid.set(uid, { uid, name, color: u.color, avatar: null, badges: demoBadges(name) })
    }
  }
  const chatters = [...byUid.values()].sort(
    (a, b) => chatterRank(a.badges) - chatterRank(b.badges) || a.name.localeCompare(b.name, 'ru'),
  )
  return { channelSlug: slug, chatters, count: chatters.length }
}

/** Рассылка «кто в чате» в комнату канала. */
function broadcastChatters(slug: string): void {
  io.in(roomKey(slug)).emit('chatters:update', buildChatters(slug))
}

/** Периодический апдейт списка + шевеление демо-присутствия (~15с). */
function startChattersTimer(): void {
  setInterval(() => {
    bgTickAt = Date.now()
    for (const [room, members] of io.sockets.adapter.rooms) {
      const name = String(room)
      if (!name.startsWith('ch:')) continue // skip per-socket rooms
      if (members.size === 0) continue
      const slug = name.slice(3)
      if (demoEnabled) churnDemoPresence(slug)
      broadcastChatters(slug)
    }
  }, CHATTERS_INTERVAL_MS)
}

// ---------------------------------------------------------------------------
// Демо-онлайн: «скачущий» счётчик зрителей (random-walk вокруг базы).
// Реальные сокеты + симулированные зрители: чат-шапка и пилюля зрителей
// на витрине дышат (±единицы), иногда прыгают — как живой эфир в Twitch.
// ---------------------------------------------------------------------------

const DEMO_VIEWERS_DRIFT_MS = 4_000 // период дрейфа счётчика
const demoViewers = new Map<string, { base: number; v: number }>() // slug -> симулируемый онлайн

function demoViewersCount(slug: string): number {
  const s = demoViewers.get(slug)
  return s ? Math.max(0, Math.round(s.v)) : 0
}

/** Один шаг дрейфа: ±единицы, изредка прыжок; держимся в коридоре базы. */
function driftDemoViewers(slug: string): void {
  let s = demoViewers.get(slug)
  if (!s) {
    const base = 47 + (hashName(slug) % 130) // 47..176 — «якорь» канала
    s = { base, v: base + (Math.random() * 10 - 5) }
    demoViewers.set(slug, s)
  }
  let v = s.v + (Math.random() * 7 - 3.5)
  if (Math.random() < 0.07) v += Math.random() < 0.5 ? -(6 + Math.random() * 14) : 6 + Math.random() * 14
  s.v = Math.min(s.base * 1.3, Math.max(s.base * 0.72, v))
}

/** Счётчик присутствия канала: реальные сокеты + демо-онлайн (если демо вкл.). */
function presenceCount(slug: string): number {
  const real = roomCount(slug)
  return demoEnabled ? real + demoViewersCount(slug) : real
}

/** Дрейф + рассылка presence:update по активным комнатам (~4с). */
function startDemoViewersTimer(): void {
  setInterval(() => {
    if (!demoEnabled) return
    for (const [room, members] of io.sockets.adapter.rooms) {
      const name = String(room)
      if (!name.startsWith('ch:')) continue // skip per-socket rooms
      if (members.size === 0) continue
      const slug = name.slice(3)
      driftDemoViewers(slug)
      io.in(roomKey(slug)).emit('presence:update', { channelSlug: slug, count: presenceCount(slug) })
    }
  }, DEMO_VIEWERS_DRIFT_MS)
}

/** Немедленно восстановить реальный онлайн после выключения демо. */
function resetDemoPresence(): void {
  for (const [room] of io.sockets.adapter.rooms) {
    const name = String(room)
    if (!name.startsWith('ch:')) continue // skip per-socket rooms
    const slug = name.slice(3)
    io.in(roomKey(slug)).emit('presence:update', { channelSlug: slug, count: roomCount(slug) })
  }
}

// ---------------------------------------------------------------------------
// Socket.io connection handling
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  ensureBackground() // любое подключение перевооружает фоновые таймеры (bun --hot)

  // Invalid / expired token -> proceed as anonymous (user = null).
  socket.data.user = verifyToken((socket.handshake.auth as { token?: unknown } | undefined)?.token)
  socket.data.channel = null

  // overlay / read-only watcher: handshake query watch=1 allows an anonymous join
  const handshakeQuery = (socket.handshake.query ?? {}) as Record<string, unknown>
  const isWatcher = handshakeQuery.watch === '1' || handshakeQuery.watch === 1

  socket.on('channel:join', (raw: unknown) => {
    const channelSlug = (raw as { channelSlug?: unknown } | null)?.channelSlug
    if (typeof channelSlug !== 'string' || channelSlug.length === 0) return
    const user = socket.data.user as ChatUser | null
    if (!user && !isWatcher) {
      socket.emit('system:error', { code: 'auth_required', message: 'Войдите, чтобы наблюдать за чатом' })
      return
    }
    // keep one channel per socket: silently leave the previous one
    const previous = socket.data.channel as string | null
    if (previous && previous !== channelSlug) {
      socket.leave(roomKey(previous))
      socket.data.channel = null
      io.in(roomKey(previous)).emit('presence:update', { channelSlug: previous, count: presenceCount(previous) })
      broadcastChatters(previous) // обновляем «кто в чате» для покинутой комнаты
    }
    socket.join(roomKey(channelSlug))
    socket.data.channel = channelSlug
    socket.emit('chat:history', { channelSlug, messages: visibleHistory(channelSlug) })
    // v2.2: вошедшему сразу отдаём текущее закреплённое сообщение канала (если есть)
    const pin = pins.get(channelSlug)
    if (pin) socket.emit('chat:pin', { channelSlug, message: pin.message, until: pin.until })
    io.in(roomKey(channelSlug)).emit('presence:update', { channelSlug, count: presenceCount(channelSlug) })
    broadcastChatters(channelSlug) // сразу присылаем «кто в чате» вошедшему
  })

  socket.on('channel:leave', (raw: unknown) => {
    const channelSlug = (raw as { channelSlug?: unknown } | null)?.channelSlug
    if (typeof channelSlug !== 'string' || channelSlug.length === 0) return
    if (socket.data.channel === channelSlug) socket.data.channel = null
    socket.leave(roomKey(channelSlug))
    io.in(roomKey(channelSlug)).emit('presence:update', { channelSlug, count: presenceCount(channelSlug) })
    broadcastChatters(channelSlug)
  })

  socket.on('chat:send', (raw: unknown) => {
    const payload = raw as { channelSlug?: unknown; text?: unknown; color?: unknown } | null
    const user = socket.data.user as ChatUser | null
    if (!user) {
      socket.emit('system:error', { code: 'auth_required', message: 'Войдите через Telegram, чтобы писать в чат' })
      return
    }
    const channelSlug = payload?.channelSlug
    if (typeof channelSlug !== 'string' || channelSlug.length === 0) return
    if (socket.data.channel !== channelSlug) return // must be a room member
    const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
    const color = paletteColor(payload?.color) // v2.2: override цвета ника (палитра Twitch)
    processChatText(channelSlug, user, text, socket, color)
      .then((result) => {
        if (!result.ok && result.code) {
          socket.emit('system:error', { code: result.code, message: result.message })
          return
        }
        if (result.senderOnly) {
          // private system reply (e.g. /cmd list) — sender's socket only
          socket.emit('chat:message', { message: result.senderOnly })
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`[chat:send] failed: ${msg}`)
        socket.emit('system:error', { code: 'internal', message: 'Внутренняя ошибка, попробуйте ещё раз' })
      })
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
      broadcastChatters(channel) // список «кто в чате» без отключившегося
    }
  })
})

// ---------------------------------------------------------------------------
// Viewer counts reporting (every 10s, fire-and-forget)
// С демо-чатом в отчёт включается симулируемый онлайн — тогда пилюля
// зрителей на витрине «скачет» (дрейф из driftDemoViewers).
// ---------------------------------------------------------------------------

function pushViewersNow(): void {
  const counts: Record<string, number> = {}
  for (const [room, members] of io.sockets.adapter.rooms) {
    const name = String(room)
    if (!name.startsWith('ch:')) continue // skip per-socket rooms
    const slug = name.slice(3)
    counts[slug] = demoEnabled ? members.size + demoViewersCount(slug) : members.size
  }
  // include 0 for previously-known slugs so the main app can reset them
  for (const slug of lastReportedViewers.keys()) {
    if (!(slug in counts)) counts[slug] = 0
  }
  const anyPositive = Object.values(counts).some((n) => n > 0)
  const needsReset = [...lastReportedViewers.entries()].some(
    ([slug, prev]) => prev > 0 && (counts[slug] ?? 0) === 0,
  )
  if (!anyPositive && !needsReset) return
  for (const [slug, n] of Object.entries(counts)) lastReportedViewers.set(slug, n)
  postJson(`${MAIN_APP_BASE}/api/internal/viewers`, { counts }, 'viewers')
}

function startViewersTimer(): void {
  setInterval(pushViewersNow, VIEWERS_INTERVAL_MS)
}

// ---------------------------------------------------------------------------
// Background jobs: emotes refresh (6h), expired bans cleanup (60s), pin TTL (5s)
//
// ВАЖНО: bun --hot не сохраняет таймеры, созданные при пере-исполнении модуля
// (после хот-релоада они молча умирают). Поэтому все фоновые интервалы ставятся
// идемпотентно через ensureBackground(): при оценке модуля, при первом
// подключении сокета и на REST-запросах. После следующего релоада флаг
// обнулится и таймеры перевооружатся заново от первого же клиента.
// ---------------------------------------------------------------------------

refreshEmotes() // разовый рефреш при загрузке модуля — не таймер, --hot не мешает

function startMaintenanceTimers(): void {
  setInterval(refreshEmotes, EMOTES_REFRESH_MS)
  setInterval(() => {
    try {
      qBanCleanup.run(Date.now())
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`[bans] cleanup failed: ${msg}`)
    }
  }, BANS_CLEANUP_MS)
}

let backgroundArmed = false

/** v2.2: TTL закреплённых сообщений — раз в ~5с снимаем истёкшие пины (анпин + broadcast). */
function startPinTtlTimer(): void {
  setInterval(() => {
    const now = Date.now()
    for (const [slug, pin] of pins) {
      if (pin.until === null || pin.until > now) continue
      clearChannelPin(slug)
    }
  }, PIN_TTL_CHECK_MS)
}

/** Идемпотентное (пере)вооружение всех фоновых таймеров сервиса. */
function ensureBackground(): void {
  if (backgroundArmed) return
  backgroundArmed = true
  setTimeout(() => {
    bgTimeoutAt = Date.now()
  }, 5000)
  startDemoTimer()
  startChattersTimer()
  startViewersTimer()
  startDemoViewersTimer()
  startMaintenanceTimers()
  startPinTtlTimer()
}

// ВАЖНО: вызов ensureBackground() при оценке модуля убран сознательно —
// bun --hot убивает таймеры, созданные при пере-исполнении модуля; единственный
// надёжный способ вооружить таймеры — создать их из runtime-события
// (REST-запрос или подключение сокета), что и делают вызовы выше.

// ---------------------------------------------------------------------------
// OBS overlay page (browser source; transparent background, watch-only)
// ---------------------------------------------------------------------------

const OVERLAY_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BACKSTAGE chat overlay</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@600;800&display=swap" rel="stylesheet">
<script src="https://cdn.socket.io/4.8.4/socket.io.min.js"></script>
<style>
  html, body {
    background: transparent !important;
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
  #chat {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 10px 14px;
    font-family: 'Golos Text', 'Segoe UI', system-ui, -apple-system, sans-serif;
    -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 14%);
    mask-image: linear-gradient(to bottom, transparent 0, #000 14%);
  }
  .msg {
    color: #fff;
    font-weight: 800;
    font-size: var(--fs, 26px);
    line-height: 1.32;
    text-shadow: 0 2px 4px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.9);
    word-break: break-word;
    padding: 1px 0;
    animation: fadein 0.22s ease-out both;
  }
  .msg .nm { font-weight: 600; margin-right: 7px; }
  .msg .badge { margin-right: 4px; }
  .msg .txt { font-weight: 800; }
  .msg.sys { font-style: italic; font-weight: 600; color: #a970ff; }
  .msg img.emote { height: 1.85em; width: auto; vertical-align: -0.35em; margin: -1px 1px; }
  @keyframes fadein {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: none; }
  }
</style>
</head>
<body>
<div id="chat" role="log" aria-live="polite"></div>
<script>
(function () {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var CHANNEL = __CHANNEL_JSON__;
  var SCALE = __SCALE_JSON__;
  var PORT = qs.get('XTransformPort') || '3003';
  var MAX = 30;
  var box = document.getElementById('chat');
  box.style.setProperty('--fs', Math.round(26 * SCALE) + 'px');

  // emotes (7TV/BTTV/FFZ) rendered as <img> by exact word match
  var emotes = {};
  fetch('/api/emotes?XTransformPort=' + encodeURIComponent(PORT))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.emotes) return;
      for (var i = 0; i < d.emotes.length; i++) emotes[d.emotes[i].name] = d.emotes[i].url;
    })
    .catch(function () {});

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderText(text) {
    var parts = String(text).split(/(\\s+)/);
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      var tok = parts[i];
      if (!tok) continue;
      if (tok.trim() === '') { out += tok; continue; }
      var url = emotes[tok];
      if (url) {
        out += '<img class="emote" src="' + esc(url) + '" alt="' + esc(tok) + '" title="' + esc(tok) + '">';
      } else {
        out += esc(tok);
      }
    }
    return out;
  }

  function render(m) {
    var div = document.createElement('div');
    div.className = m.system ? 'msg sys' : 'msg';
    div.setAttribute('data-id', m.id || '');
    var html = '';
    if (m.system) {
      html = renderText(m.text);
    } else {
      if (m.role === 'OWNER') html += '<span class="badge">👑</span>';
      else if (m.role === 'MOD') html += '<span class="badge">🗡</span>';
      html += '<span class="nm" style="color:' + esc(m.color || '#a970ff') + '">' + esc(m.name) + ':</span>';
      html += '<span class="txt">' + renderText(m.text) + '</span>';
    }
    div.innerHTML = html;
    return div;
  }

  function push(m) {
    box.appendChild(render(m));
    while (box.childElementCount > MAX) box.removeChild(box.firstElementChild);
  }

  var socket = io('/?XTransformPort=' + encodeURIComponent(PORT) + '&watch=1', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    timeout: 10000
  });

  socket.on('connect', function () {
    socket.emit('channel:join', { channelSlug: CHANNEL });
  });
  socket.on('chat:history', function (d) {
    if (!d || d.channelSlug !== CHANNEL) return;
    box.innerHTML = '';
    var ms = (d.messages || []).filter(function (m) { return !m.deleted; });
    for (var i = Math.max(0, ms.length - MAX); i < ms.length; i++) push(ms[i]);
  });
  socket.on('chat:message', function (d) {
    if (d && d.message && (!d.message.channelSlug || d.message.channelSlug === CHANNEL)) push(d.message);
  });
  socket.on('chat:clear', function (d) {
    if (!d || d.channelSlug === CHANNEL) box.innerHTML = '';
  });
  socket.on('chat:delete', function (d) {
    if (!d || !d.ids) return;
    for (var i = 0; i < d.ids.length; i++) {
      var el = box.querySelector('[data-id="' + d.ids[i] + '"]');
      if (el) el.remove();
    }
  });
})();
</script>
</body>
</html>
`

// ---------------------------------------------------------------------------
// Engine errors + startup
// ---------------------------------------------------------------------------

io.engine.on('connection_error', (err: { code?: number; message?: string }) => {
  console.log('connection_error:', err && err.code)
})

httpServer.listen(PORT, () => {
  console.log('backstage-chat v2 listening on :3003')
  console.log(`demo chat: ${demoEnabled ? 'on' : 'off'} (DEMO_CHAT=${DEMO_ENV ? '1' : '0'})`)
})

// hot-reload probe 1

// reload trigger via in-place modify
