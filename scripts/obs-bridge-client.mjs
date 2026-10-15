#!/usr/bin/env node
// BACKSTAGE — OBS → песочница: мост RTMP поверх WebSocket (клиент).
//
// Зачем: превью-песочница наружу отдаёт только HTTP-шлюз платформы, RTMP-порт
// 1935 извне недоступен. Скрипт поднимает ЛОКАЛЬНЫЙ RTMP-приёмник, OBS стримит
// в него как в обычный RTMP-сервер, а байты уходят через WebSocket шлюза
// (?XTransformPort=3004 → mini-services/rtmp-bridge → Owncast).
//
// Запуск (bun ЛИБО node >= 22):
//   BRIDGE_URL="https://<адрес-превью-страницы>" bun scripts/obs-bridge-client.mjs
//
// BRIDGE_URL — адрес из адресной строки браузера, когда превью открыто
// «в новой вкладке» (можно с путём; ws(s):// тоже принимается).
//
// Затем в OBS:
//   Сервер:      rtmp://127.0.0.1:1935/live
//   Ключ потока: bs-dypaGPT (или ваш ключ из админки Owncast)
//
// ENV:
//   BRIDGE_URL    — обязательный, базовый URL превью или готовый ws(s)://
//   LISTEN_PORT   — локальный RTMP-порт (по умолчанию 1935)
//   EXTRA_HEADERS — JSON с заголовками WS, напр. '{"Cookie":"…"}' (только bun)
//   VERBOSE=1     — подробный лог

import net from "node:net";

const BRIDGE_URL = (process.env.BRIDGE_URL || "").trim();
const LISTEN_PORT = Number(process.env.LISTEN_PORT || 1935);
const VERBOSE = !!process.env.VERBOSE;

if (!BRIDGE_URL) {
  console.error("✗ Укажите BRIDGE_URL (адрес превью-страницы). Подробнее — в шапке этого файла.");
  process.exit(1);
}

const toWsUrl = (base) => {
  let u;
  try { u = new URL(base); } catch { console.error("✗ BRIDGE_URL не является корректным URL:", base); process.exit(1); }
  if (u.protocol === "ws:" || u.protocol === "wss:") { /* уже ws */ }
  else if (u.protocol === "http:") u.protocol = "ws:";
  else if (u.protocol === "https:") u.protocol = "wss:";
  else { console.error("✗ Неожиданный протокол в BRIDGE_URL:", u.protocol); process.exit(1); }
  u.searchParams.set("XTransformPort", "3004");
  return u.toString();
};

const WS_URL = toWsUrl(BRIDGE_URL);

let WS = globalThis.WebSocket;
if (!WS) {
  try { const mod = await import("ws"); WS = mod.default || mod; }
  catch { console.error("✗ Нет глобального WebSocket (нужен bun или node ≥ 22) и не установлен пакет ws."); process.exit(1); }
}

const isBun = typeof Bun !== "undefined";
let extraHeaders = {};
if (process.env.EXTRA_HEADERS) {
  try { extraHeaders = JSON.parse(process.env.EXTRA_HEADERS); }
  catch { console.error("✗ EXTRA_HEADERS должен быть валидным JSON"); process.exit(1); }
}

const mb = (n) => (n / 1024 / 1024).toFixed(2) + " MiB";

console.log(`OBS-мост: RTMP 127.0.0.1:${LISTEN_PORT} ⇄ ${WS_URL}`);
if (!isBun && Object.keys(extraHeaders).length) {
  console.warn("! EXTRA_HEADERS поддерживается только в bun (глобальный WebSocket в node не принимает заголовки)");
}

const server = net.createServer((sock) => {
  const id = Math.random().toString(36).slice(2, 8);
  const t0 = Date.now();
  let up = 0, down = 0, open = false, closed = false;
  const pending = []; // данные OBS до открытия WS (хендшейк OBS шлёт сразу)

  const bye = (why) => {
    if (closed) return;
    closed = true;
    console.log(`[${id}] ∎ ${why} | ${((Date.now() - t0) / 1000).toFixed(1)}с | к серверу ${mb(up)} | от сервера ${mb(down)}`);
    try { ws.close(); } catch { /* noop */ }
    sock.destroy();
  };

  console.log(`[${id}] OBS подключился → открываю WS…`);
  let ws;
  try {
    ws = isBun && Object.keys(extraHeaders).length
      ? new WS(WS_URL, { headers: extraHeaders })
      : new WS(WS_URL);
  } catch (err) {
    console.error(`[${id}] ✗ WS не открылся: ${err?.message || err}`);
    sock.destroy();
    return;
  }
  try { ws.binaryType = "arraybuffer"; } catch { /* ws-пакет использует nodebuffer — ок */ }

  ws.onopen = () => {
    open = true;
    console.log(`[${id}] мост установлен`);
    while (pending.length) ws.send(pending.shift());
  };
  ws.onmessage = (e) => {
    const d = e.data;
    const buf = d instanceof ArrayBuffer ? Buffer.from(d) : d ? Buffer.from(d) : null;
    if (!buf) return bye("не-бинарное WS-сообщение");
    down += buf.length;
    sock.write(buf);
    if (VERBOSE) process.stdout.write(`\r[${id}] ↑${mb(up)} ↓${mb(down)}   `);
  };
  ws.onclose = () => bye("WS закрыт");
  ws.onerror = (e) => {
    if (!open) console.error(`[${id}] ✗ ошибка WS — проверьте BRIDGE_URL${e?.message ? ` (${e.message})` : ""}`);
    bye("ошибка WS");
  };

  sock.on("data", (chunk) => {
    up += chunk.length;
    if (open && ws.readyState === 1) ws.send(chunk);
    else if (!closed) pending.push(chunk);
  });
  sock.on("close", () => bye("OBS отключился"));
  sock.on("error", () => bye("ошибка сокета OBS"));
});

server.listen(LISTEN_PORT, () => {
  console.log(`✓ Ждём OBS на rtmp://127.0.0.1:${LISTEN_PORT} (ключ потока: bs-dypaGPT)`);
});
