// Загрузка Owncast для BACKSTAGE (запуск: bun scripts/fetch-owncast.ts).
// Бинарь не хранится в git — этот скрипт ставит его детерминированно:
//   mini-services/owncast/owncast (linux-64bit, v0.3.0)
// Данные движка (SQLite, HLS, логи) живут в mini-services/owncast/data/.
// Другие платформы: замените суффикс ассета (linux-arm64, macOS-64bit, …) —
// список: https://github.com/owncast/owncast/releases

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const VERSION = "0.3.0";
const TAG = `v${VERSION}`;
const ASSET = `owncast-${VERSION}-linux-64bit.zip`;
const URL = `https://github.com/owncast/owncast/releases/download/${TAG}/${ASSET}`;
const DIR = path.resolve(import.meta.dir, "../mini-services/owncast");
const BIN = path.join(DIR, "owncast");

if (fs.existsSync(BIN)) {
  console.log(`✓ Owncast уже установлен: ${BIN}`);
  process.exit(0);
}

fs.mkdirSync(DIR, { recursive: true });

console.log(`↓ Скачиваем Owncast ${TAG}…`);
console.log(`  ${URL}`);
execSync(`curl -sL --fail -o /tmp/owncast.zip "${URL}"`, { stdio: "inherit" });

console.log("📦 Распаковываем…");
execSync(`unzip -o -q /tmp/owncast.zip -d /tmp/owncast-dist`, { stdio: "inherit" });
fs.copyFileSync("/tmp/owncast-dist/owncast", BIN);
fs.chmodSync(BIN, 0o755);
fs.rmSync("/tmp/owncast.zip", { force: true });
fs.rmSync("/tmp/owncast-dist", { recursive: true, force: true });

console.log(`✅ Owncast ${TAG} установлен: ${BIN}`);
console.log("   Запуск: cd mini-services/owncast && bun run dev");
