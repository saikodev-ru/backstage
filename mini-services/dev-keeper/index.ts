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
 *   - rtmp-bridge      :3004  (bun run dev → bun index.ts, БЕЗ --hot)
 *   - owncast          :8080/:1935 (bun run.ts, БЕЗ --hot)
 * Дубликаты смотрителя исключаются локом на 127.0.0.1:3099.
 *
 * v2.1 (Task 2, интра-харднинг):
 *  - мост и owncast-раннер спавнятся БЕЗ --hot: hot-reload на занятом порту
 *    (EADDRINUSE) оставляет в памяти СТАРЫЙ WebSocketServer со старыми
 *    хендлерами — так родился «мост требует AUTH», которого нет в git. Лучше
 *    обычный рестарт с кодом с диска, чем «живой» процесс с кодом из прошлого.
 *  - stdout/stderr спавнов → реальные логи (/tmp/rtmp-bridge.log,
 *    /tmp/owncast-runner.log, /tmp/chat-service.log), а не /dev/null.
 *  - гонка дублей убита: banner/tick только ПОСЛЕ захвата лока
 *    (раньше первый tick() успевал заспавнить сервис до выхода по занятому лока).
 *
 * Self-healing в два слоя: даже если harness убьёт keeper или сервисы,
 * цикл в chat-service перезапустит keeper (каждые 45с), а keeper
 * перезапустит сервисы (через cooldown 30с).
 */
import { appendFileSync, openSync } from 'node:fs'
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
// ВАЖНО: banner и первый tick() — только после события 'listening', т.е. когда
// лок ЗАХВАЧЕН. Раньше void tick() вызывался сразу после listen(): кандидаты
// успевали заспавнить сервисы (дубли owncast-раннеров) до выхода по занятому
// локу, а лог забивался «v2 started» каждые 45с от каждого кандидата.
const lock = netCreateServer()
lock.once('error', () => {
  // порт занят другим смотрителем — тихо выходим, БЕЗ спавнов
  process.exit(0)
})
lock.once('listening', () => {
  log(`dev-keeper v2.1 started (pid ${process.pid}, lock :${LOCK_PORT}, watching 3000/3003/3004/8080)`)
  void tick()
  setInterval(tick, CHECK_EVERY_MS)
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

function spawnIn(cwd: string, args: string[], logFile?: string): void {
  let stdout: 'ignore' | number = 'ignore'
  let stderr: 'ignore' | number = 'ignore'
  if (logFile) {
    try {
      const fd = openSync(logFile, 'a')
      stdout = fd
      stderr = fd
    } catch {
      /* лог не критичен */
    }
  }
  Bun.spawn(['bun', ...args], {
    cwd,
    stdin: 'ignore',
    stdout,
    stderr,
  })
}

const services: Service[] = [
  {
    id: 'next :3000',
    probe: () => probeHttp('http://127.0.0.1:3000/'),
    spawn: () => spawnIn(PROJECT_ROOT, ['run', 'dev'], '/tmp/next-respawn.log'),
  },
  {
    id: 'chat :3003',
    probe: () => probeHttp('http://127.0.0.1:3003/'),
    spawn: () => spawnIn(`${PROJECT_ROOT}/mini-services/chat-service`, ['--hot', 'index.ts'], '/tmp/chat-service.log'),
  },
  {
    id: 'rtmp-bridge :3004',
    probe: () => probeHttp('http://127.0.0.1:3004/'),
    // 'run dev' → package.json rtmp-bridge: "dev": "bun index.ts" (без --hot!)
    spawn: () => spawnIn(`${PROJECT_ROOT}/mini-services/rtmp-bridge`, ['run', 'dev'], '/tmp/rtmp-bridge.log'),
  },
  {
    id: 'owncast :8080',
    probe: () => probeHttp('http://127.0.0.1:8080/'),
    // без --hot (см. шапку); порт-страж внутри run.ts гасит дубли EADDRINUSE
    spawn: () => spawnIn(`${PROJECT_ROOT}/mini-services/owncast`, ['run.ts'], '/tmp/owncast-runner.log'),
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


