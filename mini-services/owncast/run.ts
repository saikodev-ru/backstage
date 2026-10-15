// Раннер Owncast для BACKSTAGE.
// Держит процесс Owncast живым (авторестарт при падении) с детерминированными
// флагами: веб на 127.0.0.1:8080, RTMP на 1935, админ-пароль — из env.
// NB: стрим-ключ БЕЗ флага -streamkey — ключи управляются через Admin API
// (POST /api/admin/config/streamkeys) и регенерируются из UI «УПРАВЛЕНИЕ».
// Флаг перекрывает конфиг и ломает регенерацию — не возвращать!
import { spawn } from "node:child_process";

const ADMIN_PASSWORD = process.env.OWNCAST_ADMIN_PASSWORD ?? "backstage-admin-2024";
const HTTP_PORT = process.env.OWNCAST_HTTP_PORT ?? "8080";
const RTMP_PORT = String(process.env.OWNCAST_RTMP_PORT ?? "1935");

const args = [
  "-webserverip", "127.0.0.1",
  "-webserverport", HTTP_PORT,
  "-rtmpport", RTMP_PORT,
  "-adminpassword", ADMIN_PASSWORD,
];

console.log(`[owncast-runner] запуск: ./owncast ${args.join(" ")}`);

function start(): void {
  const child = spawn("./owncast", args, {
    cwd: import.meta.dir,
    stdio: ["ignore", "inherit", "inherit"],
  });

  child.on("exit", (code, signal) => {
    if (signal === "SIGTERM" || signal === "SIGINT") {
      console.log("[owncast-runner] остановлен сигналом, выходим");
      process.exit(0);
    }
    console.log(`[owncast-runner] owncast упал (code=${code}), перезапуск через 2с…`);
    setTimeout(start, 2000);
  });

  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("SIGINT", () => child.kill("SIGINT"));
}

start();
