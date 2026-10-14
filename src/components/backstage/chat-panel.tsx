"use client";

// Чат трансляции v4 «TWITCH 1:1»: строки «[бейджи] Имя: текст» без аватарок,
// hover-подсветка всей строки, тонкий прозрачный хедер «Кто в чате»,
// ввод как в Twitch (поле rounded-lg + кнопка «ЧАТ» на всю ширину),
// эмодзи 7TV/BTTV/FFZ, инструменты модерации, команды.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  Camera,
  Gem,
  Lock,
  SmilePlus,
  Star,
  Sword,
  Trash2,
  Users,
  Ban,
  Clock,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useBackstageStore } from "@/components/backstage/store";
import { useAutoScroll } from "@/components/backstage/hooks";
import { toast } from "@/hooks/use-toast";
import type { ChatMessageDto, ChatterDto, EmoteDto } from "@/lib/types";

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

// ── Бейджи ролей (Twitch-тип: цветная плашка + белая иконка) ────────────

const BADGE_META: Record<string, { label: string; className: string; Icon: LucideIcon }> = {
  owner: { label: "Владелец канала", className: "bg-[#eb0400]", Icon: Camera },
  mod: { label: "Модератор", className: "bg-[#00a870]", Icon: Sword },
  vip: { label: "VIP", className: "bg-[#ff77b0]", Icon: Gem },
  sub: { label: "Платный подписчик", className: "bg-[#a970ff]", Icon: Star },
};

function BadgeChip({ badge, className }: { badge: string; className?: string }) {
  const meta = BADGE_META[badge];
  if (!meta) return null;
  return (
    <span
      role="img"
      aria-label={meta.label}
      title={meta.label}
      className={cn(
        "inline-grid h-4 w-4 shrink-0 place-items-center rounded-[4px] align-[-3px]",
        meta.className,
        className
      )}
    >
      <meta.Icon className="size-2.5 text-white" aria-hidden />
    </span>
  );
}

/** Бейджи сообщения: приоритет полю badges (v2.1 чат-сервиса), fallback на role */
function messageBadges(m: ChatMessageDto): string[] {
  if (Array.isArray(m.badges) && m.badges.length > 0) return m.badges;
  if (m.role === "OWNER") return ["owner"];
  if (m.role === "MOD") return ["mod"];
  return [];
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

/** Пикер эмодзи с табами провайдеров (без счётчика количества) */
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
              tab === p ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5"
            )}
          >
            {p.toUpperCase()}
          </button>
        ))}
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

// ── «Кто в чате» — community drawer (как в Twitch) ──────────────────────

function ChattersDrawer({
  chatters,
  onClose,
}: {
  chatters: ChatterDto[];
  onClose: () => void;
}) {
  const groups: Array<{ key: string; title: string; list: ChatterDto[] }> = [
    { key: "owner", title: "ВЛАДЕЛЕЦ", list: chatters.filter((c) => c.badges.includes("owner")) },
    {
      key: "mod",
      title: "МОДЕРАТОРЫ",
      list: chatters.filter((c) => !c.badges.includes("owner") && c.badges.includes("mod")),
    },
    {
      key: "vip",
      title: "VIP",
      list: chatters.filter((c) => !c.badges.includes("owner") && !c.badges.includes("mod") && c.badges.includes("vip")),
    },
    {
      key: "sub",
      title: "ПОДПИСЧИКИ",
      list: chatters.filter(
        (c) => !c.badges.includes("owner") && !c.badges.includes("mod") && !c.badges.includes("vip") && c.badges.includes("sub")
      ),
    },
    { key: "viewers", title: "ЗРИТЕЛИ", list: chatters.filter((c) => c.badges.length === 0) },
  ].filter((g) => g.list.length > 0);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#0f0f13]/[.97] backdrop-blur-sm" role="dialog" aria-label="Кто сейчас в чате">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/5 px-3.5">
        <Users className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="label-caps text-[12px]">ЗРИТЕЛИ — {chatters.length}</h2>
        <button
          onClick={onClose}
          aria-label="Закрыть список зрителей"
          className="ml-auto grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {groups.length === 0 && (
          <p className="label-caps py-8 text-center text-[11px] text-muted-foreground/60">Пока никого нет</p>
        )}
        {groups.map((g) => (
          <section key={g.key} className="mb-1.5">
            <h3 className="label-caps px-2 py-1.5 text-[10px] text-muted-foreground">
              {g.title} — {g.list.length}
            </h3>
            {g.list.map((c) => (
              <div key={c.uid} className="flex items-center gap-1.5 px-2 py-[5px] hover:bg-white/[.06]">
                {c.badges.length > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-0.5">
                    {c.badges.map((b) => (
                      <BadgeChip key={b} badge={b} />
                    ))}
                  </span>
                )}
                <span className="min-w-0 truncate text-[13px] font-bold" style={{ color: c.color }}>
                  {c.name}
                </span>
              </div>
            ))}
          </section>
        ))}
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

  // «Кто в чате» (community drawer)
  const [chatters, setChatters] = useState<ChatterDto[]>([]);
  const [chattersOpen, setChattersOpen] = useState(false);

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
  // Гость (без токена) подключается в read-only watch-режиме (как оверлей):
  // публичный эфир → чат читается без входа, писать — только после входа.
  // NB: socket.io-client ИГНОРИРУЕТ opts.query, если query задан в самом URL —
  // поэтому XTransformPort передаётся строго через opts.query (не в CHAT_BASE).
  useEffect(() => {
    const socket = io("/", {
      auth: token ? { token } : undefined,
      query: token ? { XTransformPort: 3003 } : { XTransformPort: 3003, watch: 1 },
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

    // «Кто в чате»: живой список от чат-сервиса
    socket.on("chatters:update", (data: { channelSlug: string; chatters: ChatterDto[] }) => {
      if (data.channelSlug !== channelSlug) return;
      setChatters(data.chatters);
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

  // ── Стартовый список «кто в чате» (REST, до первого события сокета) ────
  useEffect(() => {
    let alive = true;
    void fetchChatJson<{ chatters: ChatterDto[] }>(`/api/chatters?channel=${encodeURIComponent(channelSlug)}`).then(
      (d) => {
        if (alive && d?.chatters) setChatters(d.chatters);
      }
    );
    return () => {
      alive = false;
    };
  }, [channelSlug, connected]);

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

  const insertEmote = useCallback((name: string) => {
    setDraft((d) => (d.length === 0 || d.endsWith(" ") ? `${d}${name} ` : `${d} ${name} `));
    setPickerOpen(false);
  }, []);

  const list = useMemo(() => messages.slice(-100), [messages]);
  const showCommandHint =
    canSend && (draft.startsWith("/") || draft.startsWith("!")) && draft.length <= 24;

  return (
    <section
      aria-label="Чат трансляции"
      className={cn("relative flex h-full min-h-0 flex-col overflow-hidden", className)}
    >
      {/* Тонкий прозрачный хедер: «Кто в чате» + точка коннекта (как в Twitch) */}
      <header className="flex h-10 shrink-0 items-center gap-2 px-2.5">
        <button
          onClick={() => setChattersOpen((v) => !v)}
          aria-label="Кто сейчас в чате"
          aria-pressed={chattersOpen}
          title="Кто сейчас в чате"
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px] font-semibold transition-colors",
            chattersOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Users className="size-3.5" aria-hidden />
          {chatters.length > 0 ? chatters.length : viewers}
          <span>Кто в чате</span>
        </button>
        {/* NB: точка коннекта слева — правый верх свободен под кнопку
            сворачивания чата, которую рендерит live-view поверх хедера */}
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            connected ? "bg-[#5ad1a4] live-dot" : "bg-muted-foreground/40"
          )}
          aria-label={connected ? "Чат подключён" : "Чат отключён"}
          title={connected ? "Подключено" : "Переподключение…"}
        />
      </header>

      {/* Сообщения */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={ref}
          className="chat-fade-top absolute inset-0 overflow-y-auto px-2 py-2 text-[13px] leading-[1.4]"
          role="log"
          aria-live="polite"
        >
          {list.length === 0 && (
            <div className="grid h-full place-items-center">
              <p className="label-caps max-w-52 text-center text-[11px] text-muted-foreground/60">
                {connected ? "Сообщений пока нет" : "Подключаемся к чату…"}
              </p>
            </div>
          )}
          {list.map((m) =>
            m.system ? (
              <div key={m.id} className="fade-up px-2 py-1.5 text-center text-xs italic text-muted-foreground">
                {m.text}
              </div>
            ) : (
              <div
                key={m.id}
                className={cn(
                  "fade-up break-words px-2 py-[3px] transition-colors hover:bg-white/[.06]",
                  target?.id === m.id && "bg-white/[.07]"
                )}
                onClick={() => {
                  if (!m.system && m.uid && isMod) setTarget({ id: m.id, uid: m.uid, name: m.name });
                  else setTarget(null);
                }}
              >
                {messageBadges(m).length > 0 && (
                  <span className="mr-1 inline-flex items-center gap-0.5 align-[1px]">
                    {messageBadges(m).map((b) => (
                      <BadgeChip key={b} badge={b} />
                    ))}
                  </span>
                )}
                <span className="font-bold" style={{ color: m.color }}>
                  {m.name}
                </span>
                <span className="text-foreground/70">: </span>
                <span className="text-foreground/90">
                  <MessageText text={m.text} emotes={emoteMap} />
                </span>
              </div>
            )
          )}
        </div>

        {/* «Кто в чате» — поверх сообщений */}
        {chattersOpen && <ChattersDrawer chatters={chatters} onClose={() => setChattersOpen(false)} />}

        {pending > 0 && !chattersOpen && (
          <button
            onClick={scrollToBottom}
            className="btn-gradient glow-primary label-caps absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3.5 py-1.5 text-[11px]"
          >
            {pending} НОВЫХ ↓
          </button>
        )}
      </div>

      {/* Панель модерации: клик по сообщению (только моды) */}
      {target && isMod && (
        <div className="fade-up shrink-0 bg-white/[.03] px-2.5 py-2">
          <div className="label-caps flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Sword className="size-3.5 text-[#00a870]" aria-hidden />
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
        <div className="label-caps shrink-0 bg-white/[.02] px-3 py-1.5 text-[10px] text-muted-foreground">
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
            className="label-caps w-full gap-2 rounded-lg text-[12px]"
            onClick={() => setAuthOpen(true)}
          >
            <Lock className="size-4" />
            ВОЙДИТЕ, ЧТОБЫ УЧАСТВОВАТЬ
          </Button>
        ) : !canSend ? (
          <div className="label-caps flex items-center gap-2 rounded-lg bg-white/[.05] px-4 py-2.5 text-[11px] text-muted-foreground">
            <Star className="size-4 shrink-0 text-muted-foreground" />
            ЧАТ ДОСТУПЕН ТОЛЬКО ПОДПИСЧИКАМ
          </div>
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div className="relative min-w-0">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 500))}
                placeholder="НАПИСАТЬ СООБЩЕНИЕ…"
                aria-label="Сообщение в чат"
                maxLength={500}
                className="rounded-lg border-white/10 bg-white/[.05] pr-10 text-[13px] placeholder:text-muted-foreground/50 focus-visible:ring-white/40"
              />
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Эмодзи"
                    className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
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
              aria-label="Отправить сообщение"
              disabled={!draft.trim()}
              className="label-caps h-9 w-full rounded-lg bg-primary text-primary-foreground"
            >
              ЧАТ
            </Button>
          </form>
        )}
      </footer>
    </section>
  );
}
