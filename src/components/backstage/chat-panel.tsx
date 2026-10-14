"use client";

// Чат трансляции: socket.io мини-сервис (порт 3003 через XTransformPort).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Crown, Lock, MessageSquare, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useBackstageStore } from "@/components/backstage/store";
import { useAutoScroll } from "@/components/backstage/hooks";
import { toast } from "@/hooks/use-toast";
import type { ChatMessageDto } from "@/lib/types";

export function ChatPanel({ channelSlug, className }: { channelSlug: string; className?: string }) {
  const user = useBackstageStore((s) => s.user);
  const setAuthOpen = useBackstageStore((s) => s.setAuthOpen);
  const channel = useBackstageStore((s) => s.channels.find((c) => c.slug === channelSlug));

  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [viewers, setViewers] = useState<number>(channel?.viewers ?? 0);
  const [connected, setConnected] = useState(false);
  const [draft, setDraft] = useState("");
  const [token, setToken] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const { ref, pending, scrollToBottom } = useAutoScroll(messages);
  const canSend = Boolean(user && (user.isSubscriber || user.role === "ADMIN"));

  // ── Токен чата ──────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!user) {
        if (alive) setToken(null);
        return;
      }
      try {
        const r = await fetch("/api/chat/token", { cache: "no-store" });
        if (!r.ok) throw new Error("token");
        const d = (await r.json()) as { token: string };
        if (alive) setToken(d.token);
      } catch {
        if (alive) setToken(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user]);

  // ── Подключение к чат-сервису ──────────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    // Подключение строго через XTransformPort (шлюз Caddy), путь /
    const socket = io("/?XTransformPort=3003", {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setMessages([]);
      socket.emit("channel:join", { channelSlug });
    });
    socket.on("disconnect", () => setConnected(false));

    socket.on("chat:history", (data: { channelSlug: string; messages: ChatMessageDto[] }) => {
      if (data.channelSlug !== channelSlug) return;
      setMessages(data.messages);
      requestAnimationFrame(scrollToBottom);
    });

    socket.on("chat:message", (data: { message: ChatMessageDto }) => {
      if (data.message.channelSlug !== channelSlug) return;
      setMessages((prev) => [...prev.slice(-199), data.message]);
    });

    socket.on("presence:update", (data: { channelSlug: string; count: number }) => {
      if (data.channelSlug === channelSlug) setViewers(data.count);
    });

    socket.on("system:error", (data: { code: string; message: string }) => {
      if (data.code === "rate_limited") {
        toast({ title: "Не так часто", description: data.message, variant: "destructive" });
      }
    });

    return () => {
      socket.emit("channel:leave", { channelSlug });
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
      setMessages([]);
    };
  }, [token, channelSlug, scrollToBottom]);

  // ── Отправка ───────────────────────────────────────────────────────────
  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || !socketRef.current || !canSend) return;
    socketRef.current.emit("chat:send", { channelSlug, text });
    setDraft("");
  }, [draft, channelSlug, canSend]);

  const list = useMemo(() => messages.slice(-100), [messages]);

  return (
    <section
      aria-label="Чат трансляции"
      className={cn("flex h-full min-h-0 flex-col border-border bg-[#141419]", className)}
    >
      {/* Заголовок */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <MessageSquare className="size-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold">Чат трансляции</h2>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5" title="Зрителей в чате">
            <Users className="size-3.5" aria-hidden />
            {viewers}
          </span>
          <span
            className={cn("size-2 rounded-full", connected ? "bg-[#5ad1a4] live-dot" : "bg-muted-foreground/40")}
            aria-label={connected ? "Чат подключён" : "Чат отключён"}
            title={connected ? "Подключено" : "Переподключение…"}
          />
        </span>
      </header>

      {/* Сообщения */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={ref}
          className="chat-fade-top absolute inset-0 overflow-y-auto px-3 py-2 text-sm leading-relaxed"
          role="log"
          aria-live="polite"
        >
          {list.length === 0 && (
            <div className="grid h-full place-items-center">
              <p className="max-w-52 text-center text-xs text-muted-foreground/60">
                {user ? "Сообщений пока нет. Начните первым!" : "Войдите, чтобы читать чат"}
              </p>
            </div>
          )}
          {list.map((m) =>
            m.system ? (
              <div key={m.id} className="fade-up px-2 py-1.5 text-center text-xs italic text-primary/80">
                {m.text}
              </div>
            ) : (
              <div key={m.id} className="fade-up group/msg flex gap-2 px-1 py-1 hover:bg-secondary/40 rounded-sm">
                <Avatar className="mt-0.5 size-6 rounded-full ring-1 ring-border">
                  <AvatarImage src={m.avatar ?? undefined} alt={m.name} />
                  <AvatarFallback
                    style={{ backgroundColor: `${m.color}26`, color: m.color }}
                    className="rounded-full text-[10px] font-semibold"
                  >
                    {m.name.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <p className="min-w-0 flex-1 break-words">
                  <span className="mr-1.5 font-semibold" style={{ color: m.color }}>
                    {m.name}
                  </span>
                  <span className="text-foreground/90">{m.text}</span>
                </p>
              </div>
            )
          )}
        </div>

        {pending > 0 && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-lg shadow-primary/30"
          >
            {pending} новых ↓
          </button>
        )}
      </div>

      {/* Ввод */}
      <footer className="shrink-0 border-t border-border p-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)]">
        {!user ? (
          <Button
            variant="secondary"
            className="w-full gap-2"
            onClick={() => setAuthOpen(true)}
          >
            <Lock className="size-4" />
            Войдите, чтобы участвовать
          </Button>
        ) : !canSend ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2.5 text-xs text-muted-foreground">
            <Crown className="size-4 shrink-0 text-primary" />
            Чат доступен только платным подписчикам
          </div>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 500))}
              placeholder="Написать сообщение…"
              aria-label="Сообщение в чат"
              maxLength={500}
              className="border-border bg-[#1a1a21] focus-visible:ring-primary/60"
            />
            <Button type="submit" size="icon" aria-label="Отправить" disabled={!draft.trim()}>
              <Send className="size-4" />
            </Button>
          </form>
        )}
      </footer>
    </section>
  );
}
