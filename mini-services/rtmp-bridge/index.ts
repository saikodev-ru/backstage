// BACKSTAGE — RTMP-мост поверх WebSocket.
// Зачем: песочница наружу отдаёт только HTTP-шлюз (Caddy :81, протокол XTransformPort),
// RTMP-порт 1935 извне недоступен. OBS не умеет WebSocket — поэтому:
//   ПК пользователя: scripts/obs-bridge-client.mjs (локальный RTMP-приёмник :1935)
//     → WSS через шлюз платформы (?XTransformPort=3004) → этот сервис
//     → net.connect(127.0.0.1:1935) → Owncast.
// Каждое WS-подключение = один RTMP-поток (байт-стрим).

import net from "node:net";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT ?? 3004);
const RTMP_HOST = process.env.RTMP_HOST ?? "127.0.0.1";
const RTMP_PORT = Number(process.env.RTMP_PORT ?? 1935);

const wss = new WebSocketServer({
  port: PORT,
  perMessageDeflate: false, // важно для бинарного стрима
  maxPayload: 16 * 1024 * 1024,
});

const ts = () => new Date().toISOString().slice(11, 23);
const mb = (n: number) => (n / 1024 / 1024).toFixed(2) + " MiB";

wss.on("connection", (ws: WebSocket) => {
  const id = Math.random().toString(36).slice(2, 8);
  const t0 = Date.now();
  let up = 0; // ws → rtmp (данные OBS)
  let down = 0; // rtmp → ws (ответы сервера)
  let closed = false;

  const tcp = net.connect({ host: RTMP_HOST, port: RTMP_PORT });
  tcp.setNoDelay(true);

  const bye = (why: string) => {
    if (closed) return;
    closed = true;
    console.log(
      `[${ts()}][${id}] закрыто: ${why} | ${((Date.now() - t0) / 1000).toFixed(1)}с | ws→rtmp ${mb(up)} | rtmp→ws ${mb(down)}`
    );
    try { tcp.destroy(); } catch { /* noop */ }
    try { ws.close(); } catch { /* noop */ }
  };

  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (!isBinary) return bye("не-бинарное WS-сообщение");
    up += data.length;
    if (!tcp.write(data)) (ws as unknown as { _socket?: { pause?: () => void } })._socket?.pause?.();
  });
  tcp.on("drain", () => (ws as unknown as { _socket?: { resume?: () => void } })._socket?.resume?.());

  tcp.on("data", (chunk: Buffer) => {
    down += chunk.length;
    if (ws.readyState === WebSocket.OPEN) ws.send(chunk, { binary: true });
    else bye("ws закрыт");
  });

  tcp.on("error", (err: Error) => bye(`rtmp error: ${err.message}`));
  tcp.on("close", () => bye("rtmp closed"));
  ws.on("error", () => bye("ws error"));
  ws.on("close", () => bye("ws closed"));

  console.log(`[${ts()}][${id}] WS-мост подключён → ${RTMP_HOST}:${RTMP_PORT}`);
});

setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.ping();
  }
}, 30_000).unref?.();

console.log(`[${ts()}] rtmp-bridge: WS :${PORT} → RTMP ${RTMP_HOST}:${RTMP_PORT}`);
