"use client";

// Чат трансляции v2: socket.io мини-сервис (порт 3003 через XTransformPort).
// Эмодзи 7TV/BTTV/FFZ, бейджи OWNER/MOD, инструменты модерации, команды.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Crown, Lock, SmilePlus, Sword, Trash2, Users, Zap, Ban, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useBackstageStore } from "@/components/backstage/store";
import { useAutoScroll } from "@/components/backstage/hooks";
import { toast } from "@/hooks/use-toast";
import type { ChatMessageDto, EmoteDto } from "@/lib/types";

const CHAT_BASE = "/?XTransformPort=3003";

type EmoteMap = Map<string, EmoteDto>;

async function fetchChatJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${path}${path.includes("?") ? "&" : "?"}XTransformPort=3003`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Разбивает текст на слова; слова-эмодзи рендерит картинками (Twitch-стиль) */
function MessageText({ text, emotes }: { text: string; emotes: EmoteMap }) {
  if (emotes.size === 0) return <span className="text-foreground/90">{text}</span>;
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((part, i) => {
        const emote = emotes.get(part);
        if (emote) {
          return (
            <img
              key={i}
              src={emote.url}
              alt={part}
              title={`${part} · ${emote.provider.toUpperCase()}`}
              loading="lazy"
              className="mx-0.5 inline-block h-[1.55em] w-auto align-[-0.38em]"
            />
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** Пикер эмодзи с табами провайдеров */
function EmotePicker({ emotes, onPick }: { emotes: EmoteDto[]; onPick: (name: string) => void }) {
  const [tab, setTab] = useState<"7tv" | "bttv" | "ffz">("7tv");
  const providers: Array<"7tv" | "bttv" | "ffz"> = ["7tv", "bttv", "ffz"];
  const list = emotes.filter((e) => e.provider === tab);

  return (
    <div className="w-[min(20rem,calc(100vw-5rem))]">
      <div className="label-caps flex gap-1 border-b border-white/5 pb-1.5">
        {providers.map((p) => (
          <button
            key={p}
            onClick={() => setTab(p)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] transition-colors",
              tab === p ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5"
            )}
          >
            {p.toUpperCase()}
          </button>
        ))}
        <span className="ml-auto self-center text-[10px] text-muted-foreground/60">{list.length}</span>
      </div>
      <div className="grid max-h-72 grid-cols-[repeat(auto-fill,minmax(2.4rem,1fr))] gap-1 overflow-y-auto p-1.5">
        {list.map((e) => (
          <button
            key={`${e.provider}-${e.name}`}
            onClick={() => onPick(e.name)}
            title={e.name}
            aria-label={`Вставить эмодзи ${e.name}`}
            className="grid aspect-square place-items-center rounded-xl p-1 transition-colors hover:bg-white/5"
          >
            <img src={e.url} alt={e.name} loading="lazy" className="size-6 object-contain" />
          </button>
        ))}
        {list.length === 0 && (
          <p className="col-span-full py-6 text-center text-xs text-muted-foreground">Эмодзи не загрузились</p>
        )}
      </div>
    </div>
  );
}

export function ChatPanel({ channelSlug, className }: { channelSlug: string; className?: string }) {
  const user = useBackstageStore((s) => s.user);
  const setAuthOpen = useBackstageStore((s) => s.setAuthOpen);
  const channel = useBackstageStore((s) => s.channels.find((c) => c.slug === channelSlug));

  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [viewers, setViewers] = useState<number>(channel?.viewers ?? 0);
  const [connected, setConnected] = useState(false);
  const [draft, setDraft] = useState("");
  const [token, setToken] = useState<string | null>(null);

  const [emotes, setEmotes] = useState<EmoteDto[]>([]);
  const [modUids, setModUids] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [target, setTarget] = useState<{ id: string; uid: string | null; name: string } | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const { ref, pending, scrollToBottom } = useAutoScroll(messages);
  const emoteMap = useMemo(() => {
    const m: EmoteMap = new Map();
    for (const e of emotes) if (!m.has(e.name)) m.set(e.name, e);
    return m;
  }, [emotes]);

  const isOwner = user?.role === "ADMIN";
  const isMod = isOwner || user?.role === "MOD" || (user ? modUids.includes(user.id) : false);
  const canSend = Boolean(user && (user.isSubscriber || user.role === "ADMIN" || user.role === "MOD"));

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

  // ── Эмодзи + список модов (REST чат-сервиса) ────────────────────────────
  useEffect(() => {
    let alive = true;
    void fetchChatJson<{ emotes: EmoteDto[] }>("/api/emotes").then((d) => {
      if (alive && d?.emotes) setEmotes(d.emotes);
    });
    void fetchChatJson<{ mods: Array<{ uid: string }> }>(`/api/mods?channel=${encodeURIComponent(channelSlug)}`).then((d) => {
      if (alive && d?.mods) setModUids(d.mods.map((m) => m.uid));
    });
    return () => {
      alive = false;
    };
  }, [channelSlug, connected]);

  // ── Подключение к чат-сервису ──────────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    // Подключение строго через XTransformPort (шлюз Caddy), путь /
    const socket = io(CHAT_BASE, {
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

    socket.on("chat:clear", (data: { channelSlug: string }) => {
      if (data.channelSlug !== channelSlug) return;
      setMessages([]);
    });

    socket.on("chat:delete", (data: { channelSlug: string; ids: string[] }) => {
      if (data.channelSlug !== channelSlug) return;
      const ids = new Set(data.ids);
      setMessages((prev) => prev.filter((m) => !ids.has(m.id)));
    });

    socket.on("presence:update", (data: { channelSlug: string; count: number }) => {
      if (data.channelSlug === channelSlug) setViewers(data.count);
    });

    socket.on("system:error", (data: { code: string; message: string }) => {
      if (data.code === "rate_limited" || data.code === "banned" || data.code === "forbidden") {
        toast({ title: "Чат", description: data.message, variant: "destructive" });
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
    setTarget(null);
  }, [draft, channelSlug, canSend]);

  const runCommand = useCallback(
    (cmd: string) => {
      if (!socketRef.current || !canSend) return;
      socketRef.current.emit("chat:send", { channelSlug, text: cmd });
    },
    [channelSlug, canSend]
  );

  const insertEmote = useCallback(
    (name: string) => {
      setDraft((d) => (d.length === 0 || d.endsWith(" ") ? `${d}${name} ` : `${d} ${name} `));
      setPickerOpen(false);
    },
    []
  );

  const list = useMemo(() => messages.slice(-100), [messages]);
  const showCommandHint =
    canSend && (draft.startsWith("/") || draft.startsWith("!")) && draft.length <= 24;

  return (
    <section
      aria-label="Чат трансляции"
      className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-[#0d0d12]/60", className)}
    >
      {/* Заголовок */}
      <header className="label-caps glass flex h-12 shrink-0 items-center gap-2 rounded-none border-x-0 border-t-0 px-3.5 text-[12px]">
        <h2 className="headline text-[12px]">ЧАТ</h2>
        {emotes.length > 0 && (
          <span className="rounded-full bg-white/5 px-2 py-px text-[10px] text-muted-foreground" title="7TV · BTTV · FFZ">
            {emotes.length} ЭМОЦИЙ
          </span>
        )}
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
          className="chat-fade-top absolute inset-0 overflow-y-auto px-3 py-2.5 text-sm leading-relaxed"
          role="log"
          aria-live="polite"
        >
          {list.length === 0 && (
            <div className="grid h-full place-items-center">
              <p className="label-caps max-w-52 text-center text-[11px] text-muted-foreground/60">
                {user ? "Сообщений пока нет" : "Войдите, чтобы читать чат"}
              </p>
            </div>
          )}
          {list.map((m) =>
            m.system ? (
              <div key={m.id} className="fade-up px-2 py-1.5 text-center text-xs italic text-primary/85">
                {m.text}
              </div>
            ) : (
              <div
                key={m.id}
                className={cn(
                  "fade-up group/msg flex gap-2 rounded-xl px-2 py-1 transition-colors hover:bg-white/[.04]",
                  target?.id === m.id && "bg-white/[.07]"
                )}
                onClick={() => {
                  if (!m.system && m.uid && isMod) setTarget({ id: m.id, uid: m.uid, name: m.name });
                  else setTarget(null);
                }}
              >
                <Avatar className="mt-0.5 size-6 rounded-full ring-1 ring-white/10">
                  <AvatarImage src={m.avatar ?? undefined} alt={m.name} />
                  <AvatarFallback
                    style={{ backgroundColor: `${m.color}26`, color: m.color }}
                    className="rounded-full text-[10px] font-semibold"
                  >
                    {m.name.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <p className="min-w-0 flex-1 break-words">
                  {m.role === "OWNER" && (
                    <Crown
                      className="mr-1 inline size-3.5 -translate-y-px text-[#ffb86b]"
                      aria-label="Владелец канала"
                    />
                  )}
                  {m.role === "MOD" && (
                    <Sword
                      className="mr-1 inline size-3.5 -translate-y-px text-[#5ad1a4]"
                      aria-label="Модератор"
                    />
                  )}
                  <span className="mr-1.5 font-bold" style={{ color: m.color }}>
                    {m.name}
                  </span>
                  <MessageText text={m.text} emotes={emoteMap} />
                </p>
              </div>
            )
          )}
        </div>

        {pending > 0 && (
          <button
            onClick={scrollToBottom}
            className="btn-gradient glow-primary label-caps absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3.5 py-1.5 text-[11px] text-white"
          >
            {pending} НОВЫХ ↓
          </button>
        )}
      </div>

      {/* Панель модерации: клик по сообщению (только моды) */}
      {target && isMod && (
        <div className="fade-up shrink-0 border-t border-white/5 bg-white/[.03] px-2.5 py-2">
          <div className="label-caps flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Sword className="size-3.5 text-[#5ad1a4]" aria-hidden />
            МОДЕРАЦИЯ · {target.name}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              className="label-caps h-8 gap-1.5 px-2 text-[10px]"
              onClick={() => {
                runCommand(`/delete ${target.id}`);
                setTarget(null);
              }}
            >
              <Trash2 className="size-3.5" /> УДАЛИТЬ
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="label-caps h-8 gap-1.5 px-2 text-[10px]"
              onClick={() => {
                runCommand(`/timeout ${target.name} 300`);
                setTarget(null);
              }}
            >
              <Clock className="size-3.5" /> ТАЙМ-АУТ 5М
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="label-caps h-8 gap-1.5 px-2 text-[10px]"
              onClick={() => {
                runCommand(`/timeout ${target.name} 3600`);
                setTarget(null);
              }}
            >
              <Clock className="size-3.5" /> 1Ч
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="label-caps h-8 gap-1.5 px-2 text-[10px]"
              onClick={() => {
                runCommand(`/ban ${target.name}`);
                setTarget(null);
              }}
            >
              <Ban className="size-3.5" /> БАН
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-8 px-2 text-[10px] text-muted-foreground"
              onClick={() => setTarget(null)}
              aria-label="Закрыть панель модерации"
            >
              ✕
            </Button>
          </div>
        </div>
      )}

      {/* Подсказка команд */}
      {showCommandHint && (
        <div className="label-caps shrink-0 border-t border-white/5 bg-white/[.02] px-3 py-1.5 text-[10px] text-muted-foreground">
          КОМАНДЫ: !UPTIME · !TITLE · !КОМАНДЫ · !ЭМОЦИИ
          {isMod && " · /BAN · /TIMEOUT · /CLEAR · /SLOW · /SO"}
          {isOwner && " · /MOD · /DEMO"}
        </div>
      )}

      {/* Ввод */}
      <footer className="shrink-0 border-t border-white/5 p-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)]">
        {!user ? (
          <Button
            variant="secondary"
            className="glass label-caps w-full gap-2 rounded-full text-[12px]"
            onClick={() => setAuthOpen(true)}
          >
            <Lock className="size-4" />
            ВОЙДИТЕ, ЧТОБЫ УЧАСТВОВАТЬ
          </Button>
        ) : !canSend ? (
          <div className="label-caps glass flex items-center gap-2 rounded-full px-4 py-2.5 text-[11px] text-muted-foreground">
            <Crown className="size-4 shrink-0 text-primary" />
            ЧАТ ДОСТУПЕН ТОЛЬКО ПОДПИСЧИКАМ
          </div>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 500))}
                placeholder="НАПИСАТЬ СООБЩЕНИЕ…"
                aria-label="Сообщение в чат"
                maxLength={500}
                className="label-caps rounded-full border-white/10 bg-white/[.05] pr-10 text-[12px] placeholder:text-muted-foreground/50 focus-visible:ring-primary/60"
              />
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Эмодзи"
                    className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-primary"
                  >
                    <SmilePlus className="size-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" side="top" className="glass-strong w-auto rounded-xl p-2">
                  <EmotePicker emotes={emotes} onPick={insertEmote} />
                </PopoverContent>
              </Popover>
            </div>
            <Button
              type="submit"
              size="icon"
              aria-label="Отправить"
              disabled={!draft.trim()}
              className="btn-gradient glow-primary shrink-0 rounded-full"
            >
              <Zap className="size-4" />
            </Button>
          </form>
        )}
      </footer>
    </section>
  );
}
