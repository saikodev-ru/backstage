// Локальный e2e-тест OBS-моста (запускается ВНУТРИ песочницы):
// имитирует то, что делает obs-bridge-client.mjs на ПК пользователя:
// TCP-приёмник :1936 → WS через шлюз :81 (?XTransformPort=3004) → rtmp-bridge → RTMP :1935.
// Использование: bun scripts/test-bridge-client.mjs
// Затем: ffmpeg ... -f flv rtmp://127.0.0.1:1936/live/bs-dypaGPT
import net from "node:net";

const TARGET_WS = process.env.TARGET_WS || "ws://127.0.0.1:81/?XTransformPort=3004";
const LISTEN_PORT = Number(process.env.LISTEN_PORT || 1936);

const server = net.createServer((sock) => {
  const id = Math.random().toString(36).slice(2, 8);
  const pending = [];
  console.log(`[${id}] входящее TCP-подключение → ${TARGET_WS}`);
  const ws = new WebSocket(TARGET_WS);
  try { ws.binaryType = "arraybuffer"; } catch { /* noop */ }
  sock.on("data", (c) => (ws.readyState === 1 ? ws.send(c) : pending.push(c)));
  ws.onopen = () => { console.log(`[${id}] WS открыт, флеш буфера (${pending.length} чанков)`); while (pending.length) ws.send(pending.shift()); };
  ws.onmessage = (e) => sock.write(e.data instanceof ArrayBuffer ? Buffer.from(e.data) : Buffer.from(e.data ?? 0));
  ws.onclose = () => sock.destroy();
  ws.onerror = () => { console.error(`[${id}] ошибка WS`); sock.destroy(); };
  sock.on("close", () => { try { ws.close(); } catch { /* noop */ } });
  sock.on("error", () => { /* noop */ });
});

server.listen(LISTEN_PORT, "127.0.0.1", () => {
  console.log(`test-bridge: 127.0.0.1:${LISTEN_PORT} ⇄ ${TARGET_WS}`);
});
