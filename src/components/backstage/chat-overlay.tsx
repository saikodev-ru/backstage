"use client";

// Оверлей чата для OBS (Browser Source): /?overlay=chat&channel=<slug>
// — прозрачный фон: страница кладётся поверх сцены OBS (тело гасится ещё
//   серверным <style> в page.tsx, чтобы не было вспышки «графита» на старте);
// — сообщения прижаты к низу, новые всплывают с fade-up;
// — ники в цвете отправителя (иначе палитра Twitch по хэшу имени);
// — эмодзи чата рендерятся картинками (как в основном чате);
// — подключение к чат-сервису в read-only watch-режиме (без входа);
// — URL-параметры: scale (0.5–3 — кегль текста), limit (5–50 строк).

import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { cn } from "@/lib/utils";
import type { ChatMessageDto, EmoteDto } from "@/lib/types";

/** Палитра Twitch (16 цветов) — как в настройках основного чата */
const TWITCH_PALETTE = [
  "#ff7bac",
  "#7bd3ff",
  "#a970ff",
  "#ffb86b",
  "#c3e88d",
  "#8be9fd",
  "#f97ac0",
  "#d6bcff",
  "#5ad1a4",
  "#ff8080",
  "#a6e22e",
  "#f78c6c",
  "#e6db74",
  "#fd971f",
  "#7f7fff",
  "#00b5ad",
] as const;

/** Цвет ника: цвет сообщения (если валиден) иначе палитра по хэшу имени */
function nickColor(m: ChatMessageDto): string {
  if (/^#[0-9a-f]{6}$/i.test(m.color)) return m.color;
  let h = 0;
  for (let i = 0; i < m.name.length; i++) h = (h * 31 + m.name.charCodeAt(i)) | 0;
  return TWITCH_PALETTE[Math.abs(h) % TWITCH_PALETTE.length];
}

/** Текст сообщения: слова-эмодзи → картинки (упрощённый MessageText чата) */
function OverlayText({ text, emotes }: { text: string; emotes: Map<string, string> }) {
  const parts = useMemo(() => text.split(/(\s+)/), [text]);
  if (emotes.size === 0) return <>{text}</>;
  return (
    <>
      {parts.map((tok, i) => {
        const url = emotes.get(tok);
        if (url) {
          return (
            <img
              key={i}
              src={url}
              alt={tok}
              title={tok}
              className="inline-block size-[1.4em] translate-y-[0.18em] object-contain"
            />
          );
        }
        return <span key={i}>{tok}</span>;
      })}
    </>
  );
}

export function ChatOverlay({
  channelSlug,
  scale,
  limit,
}: {
  channelSlug: string;
  scale: number;
  limit: number;
}) {
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [emoteMap, setEmoteMap] = useState<Map<string, string>>(() => new Map());
  const [connected, setConnected] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Эмодзи чата (REST чат-сервиса через шлюз)
  useEffect(() => {
    let alive = true;
    void fetch("/api/emotes?XTransformPort=3003", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ emotes?: EmoteDto[] }>) : null))
      .then((d) => {
        if (!alive || !d?.emotes) return;
        setEmoteMap(new Map(d.emotes.map((e) => [e.name, e.url])));
      })
      .catch(() => {
        /* оверлей живёт и без эмодзи */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Чат-сокет: гость-watch (только чтение, без токена)
  useEffect(() => {
    const socket: Socket = io("/", {
      query: { XTransformPort: 3003, watch: 1 },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    socket.on("connect", () => {
      setConnected(true);
      socket.emit("channel:join", { channelSlug });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("chat:history", (d: { channelSlug: string; messages: ChatMessageDto[] }) => {
      if (d.channelSlug !== channelSlug) return;
      setMessages(d.messages.slice(-limit));
    });
    socket.on("chat:message", (d: { message: ChatMessageDto }) => {
      if (d.message.channelSlug !== channelSlug) return;
      setMessages((prev) => [...prev, d.message].slice(-limit));
    });
    socket.on("chat:clear", (d: { channelSlug: string }) => {
      if (d.channelSlug === channelSlug) setMessages([]);
    });
    socket.on("chat:delete", (d: { channelSlug: string; ids: string[] }) => {
      if (d.channelSlug !== channelSlug) return;
      const ids = new Set(d.ids);
      setMessages((prev) => prev.filter((m) => !ids.has(m.id)));
    });
    return () => {
      socket.emit("channel:leave", { channelSlug });
      socket.disconnect();
    };
  }, [channelSlug, limit]);

  // автоскролл к последнему сообщению
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const visible = useMemo(
    () => messages.filter((m) => !m.system && !m.deleted),
    [messages]
  );

  return (
    <div
      className="fixed inset-0 flex flex-col justify-end overflow-hidden p-3"
      style={{ fontSize: `${Math.round(15 * scale)}px`, background: "transparent" }}
    >
      {/* Индикатор соединения — крошечная точка, чтобы не портить сцену */}
      <span
        aria-hidden
        title={connected ? "чат подключён" : "переподключение…"}
        className={cn(
          "absolute right-2.5 top-2.5 size-1.5 rounded-full transition-colors",
          connected ? "bg-white/25" : "bg-live/80"
        )}
      />
      <div
        ref={listRef}
        className="overlay-list flex max-h-full flex-col gap-1.5 overflow-y-auto pr-1"
        role="log"
        aria-live="polite"
        aria-label="Чат трансляции (оверлей OBS)"
      >
        {visible.map((m) => (
          <p
            key={m.id}
            className="fade-up break-words leading-snug"
            style={{ textShadow: "0 1px 3px rgba(0,0,0,.95), 0 0 8px rgba(0,0,0,.65)" }}
          >
            <span className="font-bold" style={{ color: nickColor(m) }}>
              {m.name}
            </span>
            <span className="text-white/55">: </span>
            <span className="text-[#f2f2f5]">
              <OverlayText text={m.text} emotes={emoteMap} />
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}
