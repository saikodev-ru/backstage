"use client";

// Чат трансляции v5 «TWITCH 1:1»: строки «[бейджи] Имя: текст» без аватарок,
// хедер «ЧАТ ТРАНСЛЯЦИИ» по центру + eye-кнопка «кто в чате» (слева от collapse),
// ПКМ-меню модерации (отстранить/забанить/удалить/закрепить), баннер закреплённого
// сообщения, настройки чата (шестерёнка: цвет ника из палитры Twitch, размер
// текста, время сообщений), ввод: Enter на десктопе / компактная кнопка на мобиле.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import {
  Gem,
  Lock,
  Pin,
  Settings,
  SmilePlus,
  Star,
  Sword,
  Users,
  Send,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { ViewersIcon } from "@/components/backstage/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { useBackstageStore } from "@/components/backstage/store";
import { useAutoScroll } from "@/components/backstage/hooks";
import { toast } from "@/hooks/use-toast";
import type { ChatMessageDto, ChatterDto, EmoteDto } from "@/lib/types";

const CHAT_BASE = "/?XTransformPort=3003";

// ── Палитра Twitch (16 цветов) — для выбора цвета никнейма ──────────────
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

// ── Настройки чата (persist localStorage, useSyncExternalStore) ─────────

type ChatTextSize = "sm" | "md" | "lg";
type ChatSettings = { color: string | null; textSize: ChatTextSize; timestamps: boolean };

const CHAT_SETTINGS_KEY = "backstage:chatsettings";
const CHAT_SETTINGS_DEFAULTS: ChatSettings = { color: null, textSize: "md", timestamps: false };

let chatSettingsCache: ChatSettings | null = null;
const chatSettingsListeners = new Set<() => void>();

function readChatSettings(): ChatSettings {
  if (chatSettingsCache) return chatSettingsCache;
  let parsed: Partial<ChatSettings> = {};
  try {
    parsed = JSON.parse(window.localStorage.getItem(CHAT_SETTINGS_KEY) ?? "{}") as Partial<ChatSettings>;
  } catch {
    /* битый JSON — дефолты */
  }
  chatSettingsCache = {
    color: typeof parsed.color === "string" && (TWITCH_PALETTE as readonly string[]).includes(parsed.color) ? parsed.color : null,
    textSize: parsed.textSize === "sm" || parsed.textSize === "lg" ? parsed.textSize : "md",
    timestamps: parsed.timestamps === true,
  };
  return chatSettingsCache;
}

function chatSettingsServer(): ChatSettings {
  return CHAT_SETTINGS_DEFAULTS;
}

function setChatSettings(patch: Partial<ChatSettings>) {
  chatSettingsCache = { ...readChatSettings(), ...patch };
  try {
    window.localStorage.setItem(CHAT_SETTINGS_KEY, JSON.stringify(chatSettingsCache));
  } catch {
    /* noop */
  }
  chatSettingsListeners.forEach((l) => l());
}

function subscribeChatSettings(listener: () => void): () => void {
  chatSettingsListeners.add(listener);
  return () => chatSettingsListeners.delete(listener);
}

/** Размер текста сообщений → классы */
const TEXT_SIZE_CLASS: Record<ChatTextSize, string> = {
  sm: "text-[12px] leading-[1.35]",
  md: "text-[13px] leading-[1.4]",
  lg: "text-[15px] leading-[1.45]",
};

/** Время сообщения HH:MM (для тумблера «время сообщений») */
function fmtTs(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Остаток времени закрепления для баннера */
function fmtRemaining(until: number): string {
  const ms = until - Date.now();
  if (ms <= 0) return "снимается…";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "меньше минуты";
  const h = Math.floor(min / 60);
  if (h < 1) return `ещё ${min} мин`;
  return `ещё ${h} ч ${min % 60} мин`;
}

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

// ── Бейджи ролей (1:1 Twitch): цветная плашка + белая пиктограмма ──────
// Иконки и цвета повторяют Twitch: владелец — камера, мод — меч,
// VIP — бриллиант, подписчик — звезда. Размер привязан к кеглю шрифта
// (Twitch масштабирует бейджи вместе с размером текста чата).

const BADGE_META: Record<string, { label: string; className: string; Icon: LucideIcon }> = {
  owner: { label: "Владелец канала", className: "bg-[#e91916]", Icon: Video },
  mod: { label: "Модератор", className: "bg-[#00ad03]", Icon: Sword },
  vip: { label: "VIP", className: "bg-[#e005b9]", Icon: Gem },
  sub: { label: "Платный подписчик", className: "bg-[#8205b9]", Icon: Star },
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
        "inline-grid h-[1.25em] w-[1.25em] shrink-0 place-items-center rounded-[3px] align-[-0.22em]",
        meta.className,
        className
      )}
    >
      <meta.Icon className="size-[0.72em] text-white" strokeWidth={2.6} aria-hidden />
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

/** Содержимое строки сообщения: [время] [бейджи] Имя: текст */
function MessageBody({
  m,
  emotes,
  showTimestamp,
}: {
  m: ChatMessageDto;
  emotes: EmoteMap;
  showTimestamp: boolean;
}) {
  return (
    <>
      {showTimestamp && (
        <span className="mr-1 select-none text-[11px] tabular-nums text-muted-foreground/60">{fmtTs(m.ts)}</span>
      )}
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
        <MessageText text={m.text} emotes={emotes} />
      </span>
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

/** Настройки чата (шестерёнка у поля ввода): цвет ника, размер текста, время */
function ChatSettingsMenu({ settings }: { settings: ChatSettings }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Настройки чата"
          title="Настройки чата"
          className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <Settings className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="glass-strong w-[min(19rem,calc(100vw-5rem))] rounded-xl p-3"
      >
        <h3 className="label-caps px-1 pb-2.5 text-[11px] text-foreground">НАСТРОЙКИ ЧАТА</h3>

        {/* Цвет никнейма (палитра Twitch) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-[12px] font-semibold text-foreground/90">Цвет никнейма</span>
            {settings.color ? (
              <button
                type="button"
                onClick={() => setChatSettings({ color: null })}
                className="label-caps rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                СБРОС
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-8 gap-1.5 px-1">
            {TWITCH_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Цвет никнейма ${c}`}
                title={c}
                onClick={() => setChatSettings({ color: c })}
                className={cn(
                  "size-5.5 rounded-md transition-transform",
                  settings.color === c
                    ? "ring-2 ring-white ring-offset-2 ring-offset-popover"
                    : "hover:scale-110"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {/* Размер текста */}
        <div className="mt-3.5 space-y-1.5">
          <span className="px-1 text-[12px] font-semibold text-foreground/90">Размер текста</span>
          <div className="flex gap-1 px-1">
            {(["sm", "md", "lg"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setChatSettings({ textSize: s })}
                aria-pressed={settings.textSize === s}
                className={cn(
                  "label-caps flex-1 rounded-lg px-2 py-1.5 text-[10px] transition-colors",
                  settings.textSize === s ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5"
                )}
              >
                {s === "sm" ? "МЕЛКИЙ" : s === "md" ? "СРЕДНИЙ" : "КРУПНЫЙ"}
              </button>
            ))}
          </div>
        </div>

        {/* Время сообщений */}
        <div className="mt-3.5 flex items-center justify-between gap-2 px-1">
          <span className="text-[12px] font-semibold text-foreground/90">Время сообщений</span>
          <Switch
            checked={settings.timestamps}
            onCheckedChange={(v) => setChatSettings({ timestamps: v })}
            aria-label="Показывать время сообщений"
          />
        </div>
      </PopoverContent>
    </Popover>
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

  // Закреплённое сообщение (chat:pin от сервиса; null = не закреплено)
  const [pinned, setPinned] = useState<{ message: ChatMessageDto; until: number | null } | null>(null);

  // «Кто в чате» (community drawer)
  const [chatters, setChatters] = useState<ChatterDto[]>([]);
  const [chattersOpen, setChattersOpen] = useState(false);

  // Настройки чата (цвет ника, размер текста, время) — persist localStorage
  const chatSettings = useSyncExternalStore(subscribeChatSettings, readChatSettings, chatSettingsServer);

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

    // Закреплённое сообщение (пин/анпин/TTL — от чат-сервиса)
    socket.on(
      "chat:pin",
      (data: { channelSlug: string; message: ChatMessageDto | null; until: number | null }) => {
        if (data.channelSlug !== channelSlug) return;
        setPinned(data.message ? { message: data.message, until: data.until ?? null } : null);
      }
    );

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
    // Цвет никнейма из настроек чата (валидируется и на сервисе)
    socketRef.current.emit("chat:send", {
      channelSlug,
      text,
      ...(chatSettings.color ? { color: chatSettings.color } : {}),
    });
    setDraft("");
  }, [draft, channelSlug, canSend, chatSettings.color]);

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
      {/* Хедер: «ЧАТ ТРАНСЛЯЦИИ» по центру, справа — eye-кнопка зрителей
          (на md+ левее кнопки сворачивания, которую рендерит live-view) */}
      <header className="relative flex h-10 shrink-0 items-center justify-between gap-1.5 px-2.5">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            connected ? "bg-[#5ad1a4] live-dot" : "bg-muted-foreground/40"
          )}
          aria-label={connected ? "Чат подключён" : "Чат отключён"}
          title={connected ? "Подключено" : "Переподключение…"}
        />
        <h2 className="label-caps absolute left-1/2 -translate-x-1/2 text-[11px] tracking-wide text-muted-foreground">
          ЧАТ ТРАНСЛЯЦИИ
        </h2>
        <button
          onClick={() => setChattersOpen((v) => !v)}
          aria-label="Кто сейчас в чате"
          aria-pressed={chattersOpen}
          title="Кто сейчас в чате"
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-[12px] font-bold transition-colors md:mr-10",
            chattersOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <ViewersIcon className="size-4" />
          {chatters.length > 0 ? chatters.length : viewers}
        </button>
      </header>

      {/* Закреплённое сообщение (закреплено модером через ПКМ) */}
      {pinned && (
        <div className="shrink-0 border-b border-white/5 bg-white/[.03] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Pin className="size-3.5 shrink-0 text-foreground/70" aria-hidden />
            <span className="label-caps truncate text-[10px] text-muted-foreground">
              ЗАКРЕПЛЕНО{pinned.until ? ` · ${fmtRemaining(pinned.until)}` : " · ДО КОНЦА ЭФИРА"}
            </span>
            {isMod && (
              <button
                onClick={() => runCommand("/unpin")}
                aria-label="Снять закрепление"
                title="Снять закрепление"
                className="ml-auto grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <p className={cn("chat-shadow mt-1 truncate", TEXT_SIZE_CLASS[chatSettings.textSize])}>
            <span className="font-bold" style={{ color: pinned.message.color }}>
              {pinned.message.name}
            </span>
            <span className="text-foreground/70">: </span>
            <span className="text-foreground/90">
              <MessageText text={pinned.message.text} emotes={emoteMap} />
            </span>
          </p>
        </div>
      )}

      {/* Сообщения */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={ref}
          className={cn(
            "chat-fade-top absolute inset-0 overflow-y-auto px-2 py-2",
            TEXT_SIZE_CLASS[chatSettings.textSize]
          )}
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
            ) : isMod ? (
              /* ПКМ-меню модерации (только для модов) */
              <ContextMenu key={m.id}>
                <ContextMenuTrigger asChild>
                  <div className="chat-shadow fade-up break-words px-2 py-[3px] transition-colors hover:bg-white/[.06]">
                    <MessageBody m={m} emotes={emoteMap} showTimestamp={chatSettings.timestamps} />
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="glass-strong min-w-56 rounded-xl">
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>Закрепить сообщение</ContextMenuSubTrigger>
                    <ContextMenuSubContent className="glass-strong rounded-xl">
                      <ContextMenuItem onClick={() => runCommand(`/pin ${m.id} 300`)}>
                        на 5 минут
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => runCommand(`/pin ${m.id} 1800`)}>
                        на 30 минут
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => runCommand(`/pin ${m.id}`)}>
                        до конца эфира
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  {pinned?.message.id === m.id && (
                    <ContextMenuItem onClick={() => runCommand("/unpin")}>Снять закрепление</ContextMenuItem>
                  )}
                  <ContextMenuSeparator />
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>Отстранить {m.name}</ContextMenuSubTrigger>
                    <ContextMenuSubContent className="glass-strong rounded-xl">
                      <ContextMenuItem onClick={() => runCommand(`/timeout ${m.name} 300`)}>
                        на 5 минут
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => runCommand(`/timeout ${m.name} 3600`)}>
                        на 1 час
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => runCommand(`/timeout ${m.name} 86400`)}>
                        на 24 часа
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => runCommand(`/ban ${m.name}`)} className="text-live">
                        навсегда
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuItem onClick={() => runCommand(`/ban ${m.name}`)} className="text-live">
                    Забанить {m.name}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => runCommand(`/delete ${m.id}`)}>
                    Удалить сообщение
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ) : (
              <div key={m.id} className="chat-shadow fade-up break-words px-2 py-[3px] transition-colors hover:bg-white/[.06]">
                <MessageBody m={m} emotes={emoteMap} showTimestamp={chatSettings.timestamps} />
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

      {/* Подсказка команд */}
      {showCommandHint && (
        <div className="label-caps shrink-0 bg-white/[.02] px-3 py-1.5 text-[10px] text-muted-foreground">
          КОМАНДЫ: !UPTIME · !TITLE · !КОМАНДЫ · !ЭМОЦИИ
          {isMod && " · /BAN · /TIMEOUT · /PIN · /UNPIN · /CLEAR · /SLOW · /SO"}
          {isOwner && " · /MOD · /DEMO"}
        </div>
      )}

      {/* Ввод: Enter на десктопе, компактная кнопка справа — на мобиле */}
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
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div className="relative min-w-0">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 500))}
                placeholder="Отправить сообщение"
                aria-label="Сообщение в чат"
                maxLength={500}
                className="rounded-lg border-white/10 bg-white/[.05] pr-[6.75rem] text-[13px] placeholder:text-muted-foreground/50 focus-visible:ring-white/40 md:pr-[5rem]"
              />
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                <ChatSettingsMenu settings={chatSettings} />
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="Эмодзи"
                      className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                    >
                      <SmilePlus className="size-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" side="top" className="glass-strong w-auto rounded-xl p-2">
                    <EmotePicker emotes={emotes} onPick={insertEmote} />
                  </PopoverContent>
                </Popover>
                {/* Компактная отправка — только мобильные */}
                <button
                  type="submit"
                  aria-label="Отправить сообщение"
                  disabled={!draft.trim()}
                  className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40 md:hidden"
                >
                  <Send className="size-4" />
                </button>
              </div>
            </div>
          </form>
        )}
      </footer>
    </section>
  );
}
