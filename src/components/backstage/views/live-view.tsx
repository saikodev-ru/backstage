"use client";

// Экран эфира v4 «Twitch»: плеер вплотную к краям (без скруглений/контуров),
// инфо-бар как в Twitch (круглый аватар с красным кольцом и плашкой LIVE,
// заголовок → никнейм → категория/теги, справа компактные кнопки + зрители),
// секция «О канале» с редактором панелей (для автора) и чат:
// справа от md (drag-resize + сворачивание), внизу — только мобилки.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Crown,
  ExternalLink,
  Heart,
  Image as ImageIcon,
  Lock,
  MessageSquare,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { findCategory } from "@/lib/categories";
import { ViewersIcon } from "@/components/backstage/icons";
import { useBackstageStore } from "@/components/backstage/store";
import { useAuthActions, useContent, formatCount } from "@/components/backstage/hooks";
import { VideoPlayer } from "@/components/backstage/video-player";
import { ChatPanel } from "@/components/backstage/chat-panel";
import { toast } from "@/hooks/use-toast";
import type { ChannelPanelDto, PublicChannel, ScheduleDto } from "@/lib/types";

/* ── Раскладка чата (persist: ширина + свёрнутость) ───────────────────── */

const CHAT_W_KEY = "backstage:chatw";
const CHAT_OPEN_KEY = "backstage:chat";
const CHAT_W_MIN = 300;
const CHAT_W_MAX = 560;
const CHAT_W_DEFAULT = 340;

type ChatLayout = { w: number; open: boolean };

let chatLayoutCache: ChatLayout | null = null;
const chatLayoutListeners = new Set<() => void>();

function clampChatW(w: number): number {
  return Math.min(CHAT_W_MAX, Math.max(CHAT_W_MIN, Math.round(w)));
}

function readChatLayout(): ChatLayout {
  if (chatLayoutCache) return chatLayoutCache;
  let w = CHAT_W_DEFAULT;
  let open = true;
  try {
    const rawW = Number(window.localStorage.getItem(CHAT_W_KEY));
    if (Number.isFinite(rawW) && rawW > 0) w = clampChatW(rawW);
    open = window.localStorage.getItem(CHAT_OPEN_KEY) !== "collapsed";
  } catch {
    /* приватный режим браузера — живём с дефолтом до перезагрузки */
  }
  chatLayoutCache = { w, open };
  return chatLayoutCache;
}

function chatLayoutServer(): ChatLayout {
  return CHAT_LAYOUT_SERVER;
}

const CHAT_LAYOUT_SERVER: ChatLayout = { w: CHAT_W_DEFAULT, open: true };

function setChatLayout(patch: Partial<ChatLayout>) {
  chatLayoutCache = { ...readChatLayout(), ...patch };
  try {
    window.localStorage.setItem(CHAT_W_KEY, String(chatLayoutCache.w));
    window.localStorage.setItem(CHAT_OPEN_KEY, chatLayoutCache.open ? "open" : "collapsed");
  } catch {
    /* noop */
  }
  chatLayoutListeners.forEach((l) => l());
}

function subscribeChatLayout(listener: () => void): () => void {
  chatLayoutListeners.add(listener);
  return () => chatLayoutListeners.delete(listener);
}

/** Ручка drag-resize на левом краю чата (double-click — сброс ширины) */
function ChatResizeHandle({
  width,
  onResize,
  onReset,
}: {
  width: number;
  onResize: (w: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [active, setActive] = useState(false);

  const stop = () => {
    drag.current = null;
    setActive(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Изменить ширину чата"
      title="Потяните, чтобы изменить ширину · двойной клик — сброс"
      tabIndex={0}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onResize(width + 24);
        if (e.key === "ArrowRight") onResize(width - 24);
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width };
        setActive(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        onResize(drag.current.w - (e.clientX - drag.current.x));
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      className={cn(
        "absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize outline-none transition-colors focus-visible:bg-white/25",
        active ? "bg-white/30" : "bg-transparent hover:bg-white/15"
      )}
    />
  );
}

/* ── Бесплатная подписка («Отслеживать») убрана: единственная CTA —
   платная «ПОДПИСАТЬСЯ» (см. кнопки в инфо-баре и на странице канала) ── */

/* ── Диалог платной подписки ────────────────────────────────────── */

export function SubscribeDialog({
  channel,
  open,
  onOpenChange,
}: {
  channel: PublicChannel;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { verifySubscription } = useAuthActions();
  const [checking, setChecking] = useState(false);
  const subLink = channel.telegramLink ?? "https://t.me";

  const benefits = [
    { icon: Lock, text: "Доступ к приватным эфирам и записям" },
    { icon: MessageSquare, text: "Эксклюзивный чат подписчиков" },
    { icon: Star, text: "Бейдж платного подписчика в чате" },
    { icon: Crown, text: "Поддержка канала напрямую" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong max-w-md rounded-2xl border-white/[.06]">
        <DialogHeader>
          <DialogTitle className="headline flex items-center gap-2 text-base">
            <Star className="size-5 text-foreground" />
            ПОДПИСКА · {channel.name}
          </DialogTitle>
          <DialogDescription>
            Подписка оформляется в приватном Telegram-канале и открывает доступ ко всем приватным эфирам.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2.5">
          {benefits.map((b) => (
            <li key={b.text} className="flex items-center gap-3 rounded-xl bg-white/[.03] px-3.5 py-2.5 text-sm">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[.05]">
                <b.icon className="size-4 text-foreground/80" />
              </span>
              {b.text}
            </li>
          ))}
        </ul>

        <div className="mt-1 flex flex-col gap-2">
          <Button asChild className="btn-gradient glow-primary label-caps gap-2 rounded-full">
            <a href={subLink} target="_blank" rel="noreferrer noopener">
              <Crown className="size-4" />
              ОФОРМИТЬ В TELEGRAM
            </a>
          </Button>
          <Button
            variant="secondary"
            className="glass label-caps gap-2 rounded-full"
            disabled={checking}
            onClick={() => {
              setChecking(true);
              void verifySubscription().finally(() => {
                setChecking(false);
                onOpenChange(false);
              });
            }}
          >
            <Check className="size-4" />
            {checking ? "ПРОВЕРЯЕМ…" : "Я УЖЕ ПОДПИСАН — ПРОВЕРИТЬ"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Редактор панелей «О канале» (только автор, 1:1 Twitch) ───────────── */

type PanelDraft = {
  title: string;
  body: string;
  imageUrl: string;
  link: string;
  linkLabel: string;
};

function toDraft(p: ChannelPanelDto): PanelDraft {
  return {
    title: p.title,
    body: p.body ?? "",
    imageUrl: p.imageUrl ?? "",
    link: p.link ?? "",
    linkLabel: p.linkLabel ?? "",
  };
}

function PanelsEditor({
  channel,
  initialPanels,
  onClose,
  onSaved,
}: {
  channel: PublicChannel;
  initialPanels: ChannelPanelDto[];
  onClose: () => void;
  onSaved: (description: string | null, panels: ChannelPanelDto[]) => void;
}) {
  const [description, setDescription] = useState(channel.description ?? "");
  const [items, setItems] = useState<PanelDraft[]>(() => initialPanels.map(toDraft));
  const [saving, setSaving] = useState(false);

  const update = (i: number, patch: Partial<PanelDraft>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const move = (i: number, dir: -1 | 1) =>
    setItems((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[i];
      next[i] = next[j];
      next[j] = tmp;
      return next;
    });

  const remove = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const add = () =>
    setItems((prev) => [...prev, { title: "", body: "", imageUrl: "", link: "", linkLabel: "" }]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = items
        .filter((it) => it.title.trim().length > 0)
        .map((it) => ({
          title: it.title.trim().slice(0, 60),
          body: it.body.trim() || null,
          imageUrl: it.imageUrl.trim() || null,
          link: it.link.trim() || null,
          linkLabel: it.linkLabel.trim() || null,
        }))
        .slice(0, 20);

      const nextDescription = description.trim() ? description.trim().slice(0, 500) : null;
      if (nextDescription !== (channel.description ?? null)) {
        const r1 = await fetch(`/api/channels/${channel.slug}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: nextDescription }),
        });
        if (!r1.ok) {
          const d = (await r1.json().catch(() => ({}))) as { message?: string };
          throw new Error(d.message ?? `HTTP ${r1.status}`);
        }
      }

      const r2 = await fetch(`/api/channels/${channel.slug}/panels`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ panels: payload }),
      });
      const d2 = (await r2.json().catch(() => ({}))) as {
        panels?: ChannelPanelDto[];
        message?: string;
      };
      if (!r2.ok) throw new Error(d2.message ?? `HTTP ${r2.status}`);

      onSaved(nextDescription, d2.panels ?? []);
    } catch (e) {
      toast({
        title: "Не удалось сохранить панели",
        description: e instanceof Error ? e.message : "Ошибка",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="glass-strong max-w-2xl rounded-2xl border-white/[.06]">
        <DialogHeader>
          <DialogTitle className="headline flex items-center gap-2 text-base">
            <Pencil className="size-5 text-foreground" />
            ПАНЕЛИ КАНАЛА
          </DialogTitle>
          <DialogDescription>
            Описание и панели секции «О канале» — так их увидят зрители.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[58vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="panel-description" className="label-caps text-[11px] text-muted-foreground">
              ОПИСАНИЕ КАНАЛА
            </Label>
            <Textarea
              id="panel-description"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              rows={3}
              maxLength={500}
              placeholder="Расскажите о канале…"
              className="resize-none rounded-lg border-white/10 bg-white/[.03] text-sm"
            />
          </div>

          <div className="space-y-3">
            {items.map((it, i) => (
              <div key={i} className="space-y-2.5 rounded-xl border border-white/[.07] bg-white/[.02] p-3.5">
                <div className="flex items-center gap-1.5">
                  <span className="label-caps text-[10px] text-muted-foreground">ПАНЕЛЬ {i + 1}</span>
                  <div className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Панель выше"
                      disabled={i === 0}
                      className="size-7 rounded-lg text-muted-foreground hover:text-foreground"
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Панель ниже"
                      disabled={i === items.length - 1}
                      className="size-7 rounded-lg text-muted-foreground hover:text-foreground"
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Удалить панель"
                      className="size-7 rounded-lg text-muted-foreground hover:text-live"
                      onClick={() => remove(i)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <Input
                  value={it.title}
                  onChange={(e) => update(i, { title: e.target.value.slice(0, 60) })}
                  maxLength={60}
                  placeholder="Название панели"
                  className="rounded-lg border-white/10 bg-white/[.03] text-sm font-semibold"
                />
                <Textarea
                  value={it.body}
                  onChange={(e) => update(i, { body: e.target.value.slice(0, 1000) })}
                  maxLength={1000}
                  rows={2}
                  placeholder="Текст панели"
                  className="resize-none rounded-lg border-white/10 bg-white/[.03] text-sm"
                />
                <Input
                  value={it.imageUrl}
                  onChange={(e) => update(i, { imageUrl: e.target.value.slice(0, 500) })}
                  maxLength={500}
                  placeholder="URL картинки (необязательно)"
                  inputMode="url"
                  className="rounded-lg border-white/10 bg-white/[.03] text-sm"
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={it.link}
                    onChange={(e) => update(i, { link: e.target.value.slice(0, 500) })}
                    maxLength={500}
                    placeholder="Ссылка (необязательно)"
                    inputMode="url"
                    className="flex-1 rounded-lg border-white/10 bg-white/[.03] text-sm"
                  />
                  <Input
                    value={it.linkLabel}
                    onChange={(e) => update(i, { linkLabel: e.target.value.slice(0, 40) })}
                    maxLength={40}
                    placeholder="Текст ссылки"
                    className="sm:w-44 rounded-lg border-white/10 bg-white/[.03] text-sm"
                  />
                </div>
              </div>
            ))}

            <Button
              variant="secondary"
              onClick={add}
              className="label-caps w-full gap-2 rounded-xl border border-dashed border-white/15"
            >
              <Plus className="size-4" />
              ДОБАВИТЬ ПАНЕЛЬ
            </Button>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="secondary"
            className="label-caps rounded-full"
            disabled={saving}
            onClick={onClose}
          >
            ОТМЕНА
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving}
            className="btn-gradient glow-primary label-caps gap-2 rounded-full px-6"
          >
            <Check className="size-4" />
            {saving ? "СОХРАНЯЕМ…" : "СОХРАНИТЬ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Секция «О канале»: описание + сетка панелей ───────────────────────── */

function PanelCard({ panel }: { panel: ChannelPanelDto }) {
  return (
    <article className="overflow-hidden rounded-xl border border-white/[.05] bg-white/[.02]">
      {panel.imageUrl && (
        <div className="relative aspect-video bg-white/[.03]">
          <img
            src={panel.imageUrl}
            alt={panel.title}
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}
      <div className="p-4">
        <h3 className="card-title text-[13px]">{panel.title}</h3>
        {panel.body && (
          <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
            {panel.body}
          </p>
        )}
        {panel.link && (
          <a
            href={panel.link}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-secondary px-3.5 py-1.5 text-[12px] font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            {panel.linkLabel || "Открыть"}
          </a>
        )}
      </div>
    </article>
  );
}

export function AboutSection({ channel }: { channel: PublicChannel }) {
  const user = useBackstageStore((s) => s.user);
  const patchChannel = useBackstageStore((s) => s.patchChannel);
  const isAdmin = user?.role === "ADMIN";
  const [panels, setPanels] = useState<ChannelPanelDto[] | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/channels/${channel.slug}/panels`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { panels: ChannelPanelDto[] }) => {
        if (alive) setPanels(d.panels);
      })
      .catch(() => {
        if (alive) setPanels([]);
      });
    return () => {
      alive = false;
    };
  }, [channel.slug]);

  const hasDescription = Boolean(channel.description);

  return (
    <section aria-label="О канале" className="border-t border-white/5 px-3 py-5 sm:px-4">
      <header className="mb-4 flex items-center gap-3">
        <h2 className="label-caps text-[13px]">
          О КАНАЛЕ <span className="text-muted-foreground">· {channel.name}</span>
        </h2>
        {isAdmin && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setEditorOpen(true)}
            className="label-caps ml-auto h-8 gap-1.5 rounded-full px-3 text-[11px]"
          >
            <Pencil className="size-3.5" />
            РЕДАКТИРОВАТЬ ПАНЕЛИ
          </Button>
        )}
      </header>

      {hasDescription ? (
        <p className="max-w-3xl whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/75">
          {channel.description}
        </p>
      ) : isAdmin ? (
        <p className="text-[13px] text-muted-foreground">
          Описание пока не задано — нажмите «Редактировать панели».
        </p>
      ) : null}

      {panels && panels.length > 0 && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {panels.map((p) => (
            <PanelCard key={p.id} panel={p} />
          ))}
        </div>
      )}

      {panels && panels.length === 0 && !hasDescription && !isAdmin && (
        <div className="grid place-items-center rounded-xl border border-dashed border-white/[.07] px-4 py-10 text-center">
          <ImageIcon className="size-6 text-muted-foreground/50" aria-hidden />
          <p className="label-caps mt-2 text-[11px] text-muted-foreground/60">ПАНЕЛИ НЕ ЗАДАНЫ</p>
        </div>
      )}

      {editorOpen && (
        <PanelsEditor
          channel={channel}
          initialPanels={panels ?? []}
          onClose={() => setEditorOpen(false)}
          onSaved={(description, saved) => {
            patchChannel(channel.slug, { description });
            setPanels(saved);
            setEditorOpen(false);
            toast({ title: "Панели сохранены", description: "Секция «О канале» обновлена" });
          }}
        />
      )}
    </section>
  );
}

/* ── Экран эфира ───────────────────────────────────────────────────────── */

export function LiveView() {
  const { user, channels, activeChannel, setAuthOpen, setView, openChannelPage } = useBackstageStore();
  const { verifySubscription } = useAuthActions();
  const channel = channels.find((c) => c.slug === activeChannel) ?? channels[0];
  const schedule = useContent<ScheduleDto>("schedule");
  const [mobileChatOpen, setMobileChatOpen] = useState(true);
  const [subOpen, setSubOpen] = useState(false);

  const chatLayout = useSyncExternalStore(subscribeChatLayout, readChatLayout, chatLayoutServer);

  // Ссылка шаринга (SSR-безопасно: window только на клиенте)
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    setShareUrl(`${window.location.origin}${window.location.pathname}#ch-${channel?.slug ?? ""}`);
  }, [channel?.slug]);

  const copyShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast({ title: "Ссылка скопирована", description: `backstage · ${channel.name}` });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Не удалось скопировать ссылку", variant: "destructive" });
    }
  };

  const nextStream = useMemo(
    () =>
      schedule
        ?.filter((s) => s.channelSlug === channel?.slug && new Date(s.startsAt).getTime() > Date.now())
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null,
    [schedule, channel?.slug]
  );

  if (!channel) {
    return (
      <div className="space-y-3 p-4 sm:p-6">
        <Skeleton className="aspect-video w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  // Публичный эфир — открыт всем; приватный — только подписчикам и админу
  const isPrivateLive = channel.isLive && channel.access === "private";
  const canWatch =
    channel.isLive && (channel.access === "public" || user?.isSubscriber || user?.role === "ADMIN");
  const needsLogin = isPrivateLive && !user;
  const needsSub = isPrivateLive && user && !user.isSubscriber && user.role !== "ADMIN";
  const subLink = channel.telegramLink ?? "https://t.me";
  const category = findCategory(channel.liveCategory);
  const viewCount = formatCount(Math.max(channel.viewers, 1));

  // overflow-x-clip: эмбиент-ореол плеера выходит за его края — без обрезки
  // на мобильных он распирал страницу по горизонтали. clip (не hidden) не
  // создаёт скролл-контейнер — sticky-чат продолжает работать.
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col overflow-x-clip md:flex-row">
      {/* Левая часть: плеер вплотную к краям + инфо + «О канале» */}
      <div className="min-w-0 flex-1">
        {/* ── Плеер (edge-to-edge, без контуров и скруглений) ── */}
        {channel.isLive ? (
          <VideoPlayer
            src={canWatch ? (channel.hlsUrl ?? null) : "locked-placeholder"}
            locked={!canWatch}
            liveStartedAt={channel.liveStartedAt}
            poster={channel.livePreviewUrl ?? channel.bannerUrl}
            posterAccent="#6f6f78"
            posterLabel={channel.name}
            lockTitle={needsLogin ? "ПРИВАТНЫЙ ЭФИР" : "ТОЛЬКО ДЛЯ ПОДПИСЧИКОВ"}
            lockDescription={
              needsLogin
                ? "Войдите через Telegram — платформа проверит вашу подписку на приватный канал и откроет эфир."
                : "Эфир доступен платным подписчикам приватного Telegram-канала. Оформите подписку и возвращайтесь."
            }
            lockChildren={
              needsLogin ? (
                <div className="fade-up flex flex-col items-center gap-3">
                  <Button
                    size="lg"
                    className="btn-gradient glow-primary label-caps gap-2 rounded-full px-6"
                    onClick={() => setAuthOpen(true)}
                  >
                    <Crown className="size-4" />
                    Войти через Telegram
                  </Button>
                  <span className="text-xs text-white/60">Уже подписаны? Вход проверит статус автоматически</span>
                </div>
              ) : needsSub ? (
                <div className="fade-up flex flex-col items-center gap-3">
                  <Button
                    size="lg"
                    asChild
                    className="btn-gradient glow-primary label-caps gap-2 rounded-full px-6"
                  >
                    <a href={subLink} target="_blank" rel="noreferrer noopener">
                      <Crown className="size-4" />
                      Подписаться
                    </a>
                  </Button>
                  <Button
                    variant="secondary"
                    className="glass label-caps gap-2 rounded-full"
                    onClick={() => void verifySubscription()}
                  >
                    <Check className="size-4" />
                    Я уже подписан — проверить
                  </Button>
                </div>
              ) : undefined
            }
          />
        ) : (
          /* Оффлайн-экран: кино-заглушка (чистый графит, вплотную к краям) */
          <div className="relative aspect-video w-full overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(120%_130%_at_30%_10%,#232329_0%,#121215_60%),linear-gradient(160deg,#17171b_0%,#0c0c0f_100%)]" />
            <div className="absolute inset-0 grid place-items-center px-4">
              <div className="text-center">
                <Avatar className="mx-auto size-20 rounded-3xl ring-2 ring-white/15">
                  <AvatarImage src={channel.avatarUrl ?? undefined} alt={channel.name} />
                  <AvatarFallback className="rounded-3xl bg-[#1c1c21] text-3xl font-black text-[#d6d6de]">
                    {channel.name.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <h2 className="headline mt-4 text-lg sm:text-2xl">{channel.name} — ОФЛАЙН</h2>
                {nextStream ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Следующий эфир:{" "}
                    <span className="card-title text-foreground">{nextStream.title}</span>
                    {" · "}
                    {new Date(nextStream.startsAt).toLocaleString("ru-RU", {
                      weekday: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">Расписание уточняется</p>
                )}
                <div className="mt-5 flex flex-wrap justify-center gap-2.5">
                  <Button
                    variant="secondary"
                    className="glass label-caps gap-2 rounded-full text-[12px]"
                    onClick={() => setView("schedule")}
                  >
                    <Bell className="size-4" />
                    НАПОМНИТЬ ОБ ЭФИРЕ
                  </Button>
                  <Button
                    variant="ghost"
                    className="label-caps rounded-full text-[12px] text-muted-foreground"
                    onClick={() => setView("recordings")}
                  >
                    ЗАПИСИ ЭФИРОВ
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Инфо-бар в стиле Twitch: полупрозрачная glass-панель поверх
            эмбиент-свечения (wash-канвас светит позади) ── */}
        <div className="fade-up glass-panel-bordered relative z-10 mx-2 mt-3 flex flex-wrap items-start gap-x-4 gap-y-3 rounded-2xl p-4 sm:mx-4">
          {/* Аватар: толстое кольцо (live — красное) + плашка LIVE в стиле Twitch:
              плашка перекрывает нижнюю дугу кольца БЕЗ зазоров (ширина/высота
              рассчитаны так, чтобы верхний край плашки был выше дуги в её краях).
              Клик — страница канала (как в Twitch) */}
          <div className="relative shrink-0 self-start">
            <span
              className={cn(
                "grid place-items-center rounded-full p-1",
                channel.isLive ? "bg-live" : "bg-white/25"
              )}
            >
              <button
                type="button"
                onClick={() => openChannelPage(channel.slug)}
                aria-label={`Страница канала ${channel.name}`}
                className="block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <Avatar className="size-12 rounded-full sm:size-14">
                  <AvatarImage src={channel.avatarUrl ?? undefined} alt={channel.name} />
                  <AvatarFallback className="rounded-full bg-[#1c1c21] text-xl font-black text-[#d6d6de]">
                    {channel.name.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </button>
            </span>
            {channel.isLive && (
              <span
                className="label-caps absolute bottom-0 left-1/2 h-3.5 w-10 -translate-x-1/2 rounded-[4px] text-center text-[9px] font-bold leading-[14px] tracking-[0.08em] text-white"
                style={{ backgroundColor: "#eb0400" }}
                title="В эфире"
              >
                LIVE
              </span>
            )}
          </div>

          {/* Заголовок → никнейм (клик — страница канала) → категория и теги.
              Название трансляции НЕ пропадает после завершения эфира */}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-extrabold sm:text-lg">
              {channel.liveTitle ?? channel.name}
            </h1>
            <button
              type="button"
              onClick={() => openChannelPage(channel.slug)}
              className="mt-0.5 text-sm font-bold text-foreground/90 transition-colors hover:text-foreground hover:underline"
            >
              {channel.name}
            </button>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
              {channel.liveCategory && (
                <button
                  type="button"
                  onClick={() => openChannelPage(channel.slug)}
                  title="Категория"
                  className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 font-semibold text-foreground/80 transition-colors hover:bg-white/15"
                >
                  {category && <span aria-hidden className="text-[13px] leading-none">{category.emoji}</span>}
                  {category?.name ?? channel.liveCategory}
                </button>
              )}
              {channel.liveTags.slice(0, 4).map((t) => (
                <span key={t} className="rounded-full bg-white/[.06] px-2.5 py-0.5">
                  {t}
                </span>
              ))}
              {!channel.isLive && channel.tagline && <span className="truncate">{channel.tagline}</span>}
              {channel.access === "private" && (
                <span
                  className="flex items-center gap-1 rounded-full bg-white/[.06] px-2.5 py-0.5"
                  title="Эфир видят только платные подписчики"
                >
                  <Lock className="size-3" aria-hidden />
                  ПРИВАТНЫЙ
                </span>
              )}
            </div>
          </div>

          {/* Справа: компактные кнопки + пилюля зрителей (как в Twitch) */}
          <div className="flex w-full shrink-0 flex-col items-stretch gap-2.5 sm:w-auto sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              {/* Единственная CTA — подписка (фоллоу-кнопки больше нет):
                  гость/без подписки → градиент «ПОДПИСАТЬСЯ» → диалог;
                  подписчик → активное стекло «ПОДПИСАН» (управление в диалоге) */}
              {user?.isSubscriber || user?.role === "ADMIN" ? (
                <Button
                  onClick={() => setSubOpen(true)}
                  variant="secondary"
                  className="glass label-caps gap-1.5 rounded-full px-4 py-1.5 text-[11px] text-foreground"
                  title="Платная подписка активна — нажмите для управления"
                  aria-pressed
                >
                  <Star className="size-3.5 fill-live text-live" aria-hidden />
                  ПОДПИСАН
                </Button>
              ) : (
                <Button
                  onClick={() => setSubOpen(true)}
                  className="btn-gradient glow-primary label-caps gap-1.5 rounded-full px-4 py-1.5 text-[11px]"
                >
                  <Star className="size-3.5" />
                  ПОДПИСАТЬСЯ
                </Button>
              )}

              {/* Пилюля зрителей: счётчик + «плюс» — копирование ссылки на эфир
                  (как на YouTube: плюс открывает ссылку с кнопкой «Скопировать»);
                  счётчик «дышит» — поп-анимация при каждом изменении (демо-онлайн) */}
              {channel.isLive ? (
                <div className="flex items-stretch overflow-hidden rounded-full bg-white/[.08]">
                  <span
                    className="flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-bold text-live"
                    title="Сейчас смотрят"
                  >
                    <ViewersIcon className="size-4" />
                    <span key={viewCount} className="viewer-pop inline-block tabular-nums">
                      {viewCount}
                    </span>
                  </span>
                  <Popover open={shareOpen} onOpenChange={setShareOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label="Поделиться ссылкой на эфир"
                        title="Скопировать ссылку на эфир"
                        className="grid w-8 place-items-center border-l border-white/10 text-foreground/80 transition-colors hover:bg-white/10 hover:text-foreground"
                      >
                        <Plus className="size-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="glass-strong w-[min(22rem,calc(100vw-2rem))] rounded-xl p-3"
                    >
                      <p className="label-caps text-[11px] text-muted-foreground">ПОДЕЛИТЬСЯ ЭФИРОМ</p>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-white/[.06] px-3 py-2 font-mono text-[12px] text-foreground/90">
                          {shareUrl}
                        </div>
                        <Button
                          size="sm"
                          onClick={() => void copyShare()}
                          className="label-caps h-9 shrink-0 gap-1.5 rounded-lg px-3 text-[11px]"
                        >
                          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                          {copied ? "ГОТОВО" : "КОПИР."}
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              ) : (
                <span className="label-caps flex items-center rounded-full bg-white/[.06] px-3.5 py-1.5 text-[11px] text-muted-foreground">
                  ОФЛАЙН
                </span>
              )}
            </div>

            {/* Поддержать канал: ссылка из настроек канала (donateLink) */}
            {channel.donateLink && (
              <a
                href={channel.donateLink}
                target="_blank"
                rel="noreferrer noopener"
                title="Поддержать канал"
                className="label-caps flex w-fit items-center gap-1.5 text-[11px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                ПОДДЕРЖАТЬ
                <Heart className="size-3.5 fill-live text-live" aria-hidden />
              </a>
            )}
          </div>
        </div>

        {/* ── «О канале»: описание + панели (редактор для автора) ──
            z-10 — поверх эмбиент-свечения плеера */}
        <div className="relative z-10">
          <AboutSection key={channel.slug} channel={channel} />
        </div>
      </div>

      {/* ── Чат: справа от md (drag-resize + сворачивание), glass-панель —
          сквозь неё светит эмбиент-свечение ── */}
      {chatLayout.open ? (
        <aside
          className="glass-panel relative hidden shrink-0 border-l border-white/5 md:sticky md:top-16 md:flex md:h-[calc(100vh-4rem)] md:flex-col"
          style={{ width: chatLayout.w }}
          aria-label="Чат трансляции"
        >
          <ChatResizeHandle
            width={chatLayout.w}
            onResize={(w) => setChatLayout({ w: clampChatW(w) })}
            onReset={() => setChatLayout({ w: CHAT_W_DEFAULT })}
          />
          <button
            onClick={() => setChatLayout({ open: false })}
            aria-label="Свернуть чат"
            title="Свернуть чат"
            className="absolute right-1.5 top-1.5 z-20 grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <ChevronsRight className="size-4" />
          </button>
          <ChatPanel channelSlug={channel.slug} className="min-h-0 flex-1" />
        </aside>
      ) : (
        <button
          onClick={() => setChatLayout({ open: true })}
          aria-label="Развернуть чат"
          title="Чат"
          className="sticky top-20 hidden h-10 w-10 shrink-0 items-center justify-center self-start rounded-l-xl border border-l-0 border-white/10 bg-white/[.03] text-muted-foreground transition-colors hover:bg-white/[.06] hover:text-foreground md:flex"
        >
          <ChevronsLeft className="size-4" />
        </button>
      )}

      {/* ── Чат: сворачиваемый блок внизу — ТОЛЬКО мобильные ── */}
      <div className="px-2 pt-2 md:hidden">
        <button
          onClick={() => setMobileChatOpen((v) => !v)}
          aria-expanded={mobileChatOpen}
          className="glass label-caps flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-[12px]"
        >
          <span className="flex items-center gap-1.5 text-foreground">
            <ViewersIcon className="size-4" />
            ЧАТ
          </span>
          {channel.isLive && (
            <span className="rounded-full bg-live/15 px-2 py-px text-[11px] font-bold text-live">
              {formatCount(Math.max(channel.viewers, 1))}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            {mobileChatOpen ? "Свернуть" : "Развернуть"}
            {mobileChatOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </span>
        </button>
        {mobileChatOpen && (
          <ChatPanel
            channelSlug={channel.slug}
            className="glass-panel-bordered mt-2 h-[62vh] min-h-80 overflow-hidden rounded-2xl"
          />
        )}
      </div>

      {/* Диалог платной подписки */}
      <SubscribeDialog channel={channel} open={subOpen} onOpenChange={setSubOpen} />
    </div>
  );
}
