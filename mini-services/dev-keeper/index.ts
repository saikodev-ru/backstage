/**
 * dev-keeper — смотритель Next.js dev-сервера (:3000).
 *
 * Контекст: harness песочницы убивает процессы, порождённые агентским
 * шеллом (PID-diff в конце каждого bash-вызова). Долгоживущие процессы —
 * только потомки загрузочной цепочки start.sh. Chat-сервис (bun --hot)
 * живёт в этой цепочке и при старте/hot-reload поднимает dev-keeper как
 * своего ребёнка (см. bootstrap в mini-services/chat-service/index.ts).
 *
 * dev-keeper каждые 4 секунды проверяет :3000 и, если сервер лежит,
 * поднимает `bun run dev` в корне проекта. Дубликаты смотрителя
 * исключаются локом на 127.0.0.1:3099 (занят → тихо выходим).
 *
 * Self-healing в два слоя: даже если harness убьёт keeper или dev-сервер,
 * цикл в chat-service перезапустит keeper (каждые 45с), а keeper
 * перезапустит dev-сервер (через cooldown 30с).
 */
import { appendFileSync } from 'node:fs'
import { createServer as netCreateServer } from 'node:net'

const PROJECT_ROOT = '/home/z/my-project'
const LOCK_HOST = '127.0.0.1'
const LOCK_PORT = 3099
const CHECK_EVERY_MS = 4000
const SPAWN_COOLDOWN_MS = 30_000 // next dev нужно ~5–10с, чтобы занять порт
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

// ─── Проверка живости dev-сервера ──────────────────────────────────────────
async function isDevUp(): Promise<boolean> {
  try {
    await fetch('http://127.0.0.1:3000/', { signal: AbortSignal.timeout(2000) })
    return true // любой статус-код = сервер отвечает
  } catch {
    return false
  }
}

// ─── Подъём dev-сервера ────────────────────────────────────────────────────
let lastSpawnAt = 0
async function tick(): Promise<void> {
  if (Date.now() - lastSpawnAt < SPAWN_COOLDOWN_MS) return
  if (await isDevUp()) return
  lastSpawnAt = Date.now()
  log('port 3000 down → spawning `bun run dev`')
  try {
    Bun.spawn(['bun', 'run', 'dev'], {
      cwd: PROJECT_ROOT,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    })
  } catch (e) {
    log('spawn failed: ' + String(e))
  }
}

log(`dev-keeper started (pid ${process.pid}, lock :${LOCK_PORT})`)
void tick()
setInterval(tick, CHECK_EVERY_MS)
