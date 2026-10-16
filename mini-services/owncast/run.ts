// Раннер Owncast для BACKSTAGE.
// Держит процесс Owncast живым (авторестарт при падении) с детерминированными
// флагами: веб на 127.0.0.1:8080, RTMP на 1935, админ-пароль — из env.
// NB: стрим-ключ БЕЗ флага -streamkey — ключи управляются через Admin API
// (POST /api/admin/config/streamkeys) и регенерируются из UI «УПРАВЛЕНИЕ».
// Флаг перекрывает конфиг и ломает регенерацию — не возвращать!
//
// v2 (инфра-харднинг, Task 2):
//  - stdout/stderr бинаря → /tmp/owncast.log (append) вместо /dev/null —
//    owncast умирал дважды «без причины» (подозрение на OOM), логов не было.
//  - Порт-страж: если :8080/:1935 уже слушает живой owncast (дубль-раннер из
//    гонки dev-keeper'а) — выходим с code 0. Ломает crash-loop
//    «EADDRINUSE → рестарт через 2с» и CPU-пики от дублей.
//  - Страж срабатывает и перед каждым рестартом после падения бинаря.
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import net from "node:net";

const ADMIN_PASSWORD = process.env.OWNCAST_ADMIN_PASSWORD ?? "backstage-admin-2024";
const HTTP_PORT = process.env.OWNCAST_HTTP_PORT ?? "8080";
const RTMP_PORT = String(process.env.OWNCAST_RTMP_PORT ?? "1935");
const LOG_FILE = "/tmp/owncast.log";

const args = [
  "-webserverip", "127.0.0.1",
  "-webserverport", HTTP_PORT,
  "-rtmpport", RTMP_PORT,
  "-adminpassword", ADMIN_PASSWORD,
];

// Лог бинаря owncast — файловый дескриптор, shared на stdout и stderr.
const logFd = openSync(LOG_FILE, "a");

/** true, если порт уже слушает кто-то живой (локальная проба, 800мс) */
const portBusy = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    sock.setTimeout(800);
    const done = (busy: boolean) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(busy);
    };
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });

const portsBusy = (): Promise<boolean> =>
  Promise.all([portBusy(Number(HTTP_PORT)), portBusy(Number(RTMP_PORT))]).then(
    (r) => r[0] || r[1],
  );

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

console.log(`[owncast-runner] запуск: ./owncast ${args.join(" ")} (лог бинаря: ${LOG_FILE})`);

function start(): void {
  const child = spawn("./owncast", args, {
    cwd: import.meta.dir,
    stdio: ["ignore", logFd, logFd],
  });

  child.on("exit", (code, signal) => {
    if (signal === "SIGTERM" || signal === "SIGINT") {
      console.log("[owncast-runner] остановлен сигналом, выходим");
      process.exit(0);
    }
    console.log(`[owncast-runner] owncast упал (code=${code}), перезапуск через 2с…`);
    void wait(2000).then(async () => {
      if (await portsBusy()) {
        console.log("[owncast-runner] owncast уже запущен, выходим");
        process.exit(0);
      }
      start();
    });
  });

  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("SIGINT", () => child.kill("SIGINT"));
}

void (async () => {
  if (await portsBusy()) {
    console.log("[owncast-runner] owncast уже запущен, выходим");
    process.exit(0);
  }
  start();
})();
