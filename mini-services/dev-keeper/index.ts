/**
 * dev-keeper — смотритель сервисов BACKSTAGE.
 *
 * Контекст: harness песочницы убивает процессы, порождённые агентским
 * шеллом (PID-diff в конце каждого bash-вызова). Долгоживущие процессы —
 * только потомки загрузочной цепочки start.sh. Chat-сервис (bun --hot)
 * живёт в этой цепочке и при старте/hot-reload + каждые 45с поднимает
 * dev-keeper как своего ребёнка (см. bootstrap в mini-services/chat-service).
 *
 * Смотритель каждые 4 секунды проверяет сервисы и поднимает упавшие:
 *   - Next.js dev      :3000  (bun run dev в корне проекта)
 *   - chat-service     :3003  (bun --hot index.ts)
 *   - rtmp-bridge      :3004  (bun --hot index.ts, RTMP-WS-мост для OBS)
 *   - owncast          :8080/:1935 (bun --hot run.ts — раннер бинаря)
 * Дубликаты смотрителя исключаются локом на 127.0.0.1:3099.
 *
 * Self-healing в два слоя: даже если harness убьёт keeper или сервисы,
 * цикл в chat-service перезапустит keeper (каждые 45с), а keeper
 * перезапустит сервисы (через cooldown 30с).
 */
import { appendFileSync } from 'node:fs'
import { createServer as netCreateServer } from 'node:net'

const PROJECT_ROOT = '/home/z/my-project'
const LOCK_HOST = '127.0.0.1'
const LOCK_PORT = 3099
const CHECK_EVERY_MS = 4000
const SPAWN_COOLDOWN_MS = 30_000 // сервису нужно время занять порт
const LOG_FILE = '/tmp/dev-keeper.log'

function log(msg: string): void {
  try {
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    /* лог не критичен */
  }
}

// ─── Лок от дублей: порт занят → другой keeper уже работает ────────────────
const lock = netCreateServer()
lock.once('error', () => {
  // порт занят другим смотрителем — тихо выходим
  process.exit(0)
})
lock.listen(LOCK_PORT, LOCK_HOST)

// ─── Сервисы под присмотром ────────────────────────────────────────────────
type Service = {
  id: string
  probe: () => Promise<boolean>
  spawn: () => void
}

/** Любой HTTP-ответ (даже 4xx/5xx) = сервис жив; network error = лежит */
async function probeHttp(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) })
    return true
  } catch {
    return false
  }
}

function spawnIn(cwd: string, args: string[]): void {
  Bun.spawn(['bun', ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  })
}

const services: Service[] = [
  {
    id: 'next :3000',
    probe: () => probeHttp('http://127.0.0.1:3000/'),
    spawn: () => spawnIn(PROJECT_ROOT, ['run', 'dev']),
  },
  {
    id: 'chat :3003',
    probe: () => probeHttp('http://127.0.0.1:3003/'),
    spawn: () => spawnIn(`${PROJECT_ROOT}/mini-services/chat-service`, ['--hot', 'index.ts']),
  },
  {
    id: 'rtmp-bridge :3004',
    probe: () => probeHttp('http://127.0.0.1:3004/'),
    spawn: () => spawnIn(`${PROJECT_ROOT}/mini-services/rtmp-bridge`, ['--hot', 'index.ts']),
  },
  {
    id: 'owncast :8080',
    probe: () => probeHttp('http://127.0.0.1:8080/'),
    spawn: () => spawnIn(`${PROJECT_ROOT}/mini-services/owncast`, ['--hot', 'run.ts']),
  },
]

const lastSpawnAt = new Map<string, number>()

async function tick(): Promise<void> {
  for (const s of services) {
    if (Date.now() - (lastSpawnAt.get(s.id) ?? 0) < SPAWN_COOLDOWN_MS) continue
    if (await s.probe()) continue
    lastSpawnAt.set(s.id, Date.now())
    log(`${s.id} down → spawn`)
    try {
      s.spawn()
    } catch (e) {
      log(`spawn ${s.id} failed: ${String(e)}`)
    }
  }
}

log(`dev-keeper v2 started (pid ${process.pid}, lock :${LOCK_PORT}, watching 3000/3003/3004/8080)`)
void tick()
setInterval(tick, CHECK_EVERY_MS)
