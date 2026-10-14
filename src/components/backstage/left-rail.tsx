"use client";

// Левый сайдбар в Twitch-стиле (десктоп, lg+): два состояния —
// компактный рельс w-[72px] (иконки + аватары каналов) и развёрнутый w-[264px]
// (подписи + карточки каналов). Режим сохраняется в localStorage 'backstage:rail'.
// Плюс плавающий мобильный док (MobileNav).
// Палитра: тёмный монохром (zinc/white); красный — ТОЛЬКО live-индикаторы (bg-live/text-live).

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  Calendar,
  Clapperboard,
  Home,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useBackstageStore, type View } from "@/components/backstage/store";
import { toast } from "@/hooks/use-toast";
import type { PublicChannel } from "@/lib/types";

/* ── Навигация ─────────────────────────────────────────────────────────── */

type NavItem = {
  id: View;
  label: string;
  short: string;
  icon: LucideIcon;
};

const NAV: NavItem[] = [
  { id: "live", label: "В ЭФИРЕ", short: "ЭФИР", icon: Radio },
  { id: "home", label: "ГЛАВНАЯ", short: "ГЛАВ.", icon: Home },
  { id: "clips", label: "КЛИПЫ", short: "КЛИПЫ", icon: Clapperboard },
  { id: "recordings", label: "ЗАПИСИ", short: "ЗАПИСИ", icon: Video },
  { id: "collabs", label: "КОЛЛАБОРАЦИИ", short: "ЛАБЫ", icon: Users },
  { id: "schedule", label: "РАСПИСАНИЕ", short: "АЙСОН", icon: Calendar },
];

function useNavActions() {
  const { channels, view, openChannel, setView } = useBackstageStore();
  const liveChannels = channels.filter((c) => c.isLive);
  const liveCount = liveChannels.length;

  const go = (id: View) => {
    if (id === "live") {
      if (liveChannels.length > 0) {
        openChannel(liveChannels[0].slug);
      } else {
        // офлайн: всё равно открываем экран канала (расписание + напоминание)
        const fallback = channels[0];
        if (fallback) openChannel(fallback.slug);
        else {
          setView("home");
          toast({
            title: "Эфира сейчас нет",
            description: "Загляните в расписание — ближайший эфир уже отмечен",
          });
        }
      }
      return;
    }
    setView(id);
  };

  return { go, liveCount, active: view };
}

/* ── Режим рельса (persist в localStorage) ─────────────────────────────── */

const RAIL_KEY = "backstage:rail";
type RailMode = "compact" | "expanded";

type RailListener = () => void;
const railListeners = new Set<RailListener>();
let railCache: RailMode | null = null;

function readRailMode(): RailMode {
  try {
    return window.localStorage.getItem(RAIL_KEY) === "expanded" ? "expanded" : "compact";
  } catch {
    return "compact";
  }
}

/** Снапшот клиента (кэшируется, чтобы значение было стабильным между рендерами) */
function getRailSnapshot(): RailMode {
  if (railCache === null) railCache = readRailMode();
  return railCache;
}

/** Снапшот SSR/гидрации — по умолчанию компактный режим */
function getRailServerSnapshot(): RailMode {
  return "compact";
}

function setRailMode(mode: RailMode) {
  railCache = mode;
  try {
    window.localStorage.setItem(RAIL_KEY, mode);
  } catch {
    // localStorage недоступен — режим живёт до перезагрузки страницы
  }
  railListeners.forEach((l) => l());
}

function subscribeRail(listener: RailListener): () => void {
  railListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === RAIL_KEY) {
      railCache = null; // перечитаем при следующем снапшоте (могла изменить другая вкладка)
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    railListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Локальное сокращение числа зрителей (formatCount из hooks НЕ импортируем): 1234 → «1,2 тыс.» */
function shortCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".0", "")} млн`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(".0", "")} тыс.`;
  return String(n);
}

/** Доступный aria-label канала для кнопок-плиток */
function channelAriaLabel(ch: PublicChannel): string {
  const status = ch.isLive ? `в эфире, ${shortCount(Math.max(ch.viewers, 0))} зрителей` : "офлайн";
  const access = ch.access === "private" ? ", приватный канал" : "";
  return `${ch.name} — ${status}${access}`;
}

/* ── Общие мелкие детали ───────────────────────────────────────────────── */

/** Тултип рельса: тёмно-графитовая плашка (glass-strong перекрывает тему) */
function RailTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={10}
        className="label-caps glass-strong rounded-lg px-3 py-1.5 text-[11px] text-zinc-100"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Круглый аватар канала. Живой эфир → красное кольцо (ring-live),
 * активный канал → внешнее белое кольцо (ring-white). Фолбэк — буква имени.
 */
function ChannelAvatar({
  channel,
  active,
  wrapperClass,
}: {
  channel: PublicChannel;
  active: boolean;
  wrapperClass: string;
}) {
  const initial = (channel.name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      className={cn("relative inline-flex shrink-0 rounded-full p-[2px]", wrapperClass, active && "ring-2 ring-white")}
    >
      <span
        className={cn("relative block size-full overflow-hidden rounded-full", channel.isLive && "ring-2 ring-live")}
      >
        {channel.avatarUrl ? (
          <img
            src={channel.avatarUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full rounded-full object-cover"
          />
        ) : (
          <span className="grid size-full place-items-center rounded-full bg-zinc-800 text-[13px] font-bold text-zinc-300">
            {initial}
          </span>
        )}
      </span>
    </span>
  );
}

/** Красная точка + число зрителей (live-индикатор) */
function LiveViewers({ viewers, className }: { viewers: number; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1 text-live", className)}>
      <span className="live-dot size-1 rounded-full bg-live" aria-hidden />
      {shortCount(Math.max(viewers, 0))}
    </span>
  );
}

/* ── Канал: компактная плитка (только аватар) ──────────────────────────── */

function CompactChannelItem({ channel }: { channel: PublicChannel }) {
  const activeChannel = useBackstageStore((s) => s.activeChannel);
  const openChannel = useBackstageStore((s) => s.openChannel);
  const isActive = activeChannel === channel.slug;

  return (
    <li className="w-full">
      <RailTip label={channel.name}>
        <button
          type="button"
          onClick={() => openChannel(channel.slug)}
          aria-label={channelAriaLabel(channel)}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "flex w-full flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition-colors",
            isActive ? "bg-white/[.06]" : "hover:bg-white/[.04]",
          )}
        >
          <ChannelAvatar channel={channel} active={isActive} wrapperClass="size-10" />
          {channel.isLive && <LiveViewers viewers={channel.viewers} className="text-[10px] leading-none" />}
        </button>
      </RailTip>
    </li>
  );
}

/* ── Канал: карточка развёрнутого режима ───────────────────────────────── */

function ChannelCard({ channel }: { channel: PublicChannel }) {
  const activeChannel = useBackstageStore((s) => s.activeChannel);
  const openChannel = useBackstageStore((s) => s.openChannel);
  const isActive = activeChannel === channel.slug;

  return (
    <li className="w-full">
      <button
        type="button"
        onClick={() => openChannel(channel.slug)}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
          isActive ? "bg-white/[.06]" : "hover:bg-white/[.04]",
        )}
      >
        <ChannelAvatar channel={channel} active={isActive} wrapperClass="size-[34px]" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className={cn("truncate text-[13px] font-bold", isActive ? "text-white" : "text-zinc-200")}>
              {channel.name}
            </span>
            {channel.access === "private" && (
              <Lock className="size-3 shrink-0 text-zinc-500" aria-hidden />
            )}
          </span>
          {channel.isLive ? (
            <>
              <span className="block truncate text-xs text-muted-foreground">
                {channel.liveTitle ?? channel.name}
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] text-muted-foreground/70">
                  {channel.liveCategory ?? "—"}
                </span>
                <LiveViewers viewers={channel.viewers} className="text-[11px] leading-none" />
              </span>
            </>
          ) : (
            <span className="block truncate text-xs text-muted-foreground/70">
              {channel.tagline ?? "офлайн"}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/* ── Десктопный сайдбар ────────────────────────────────────────────────── */

export function LeftRail() {
  const { go, liveCount } = useNavActions();
  const view = useBackstageStore((s) => s.view);
  const channels = useBackstageStore((s) => s.channels);

  const mode = useSyncExternalStore(subscribeRail, getRailSnapshot, getRailServerSnapshot);
  const compact = mode === "compact";

  const toggle = () => setRailMode(compact ? "expanded" : "compact");

  const sortedChannels = useMemo(
    () => [...channels].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [channels],
  );

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        role="navigation"
        aria-label="Основная навигация"
        className={cn(
          "sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 flex-col overflow-hidden border-r border-white/5 bg-sidebar/60 backdrop-blur-xl transition-[width] duration-200 ease-out lg:flex",
          compact ? "w-[72px]" : "w-[264px]",
        )}
      >
        {/* Тумблер режима */}
        <div
          className={cn("flex h-14 shrink-0 items-center", compact ? "justify-center" : "justify-end px-3")}
        >
          <RailTip label={compact ? "Развернуть" : "Свернуть"}>
            <button
              type="button"
              onClick={toggle}
              aria-label={compact ? "Развернуть сайдбар" : "Свернуть сайдбар"}
              aria-expanded={!compact}
              className="grid size-10 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[.04] hover:text-zinc-100"
            >
              {compact ? (
                <PanelLeftOpen className="size-[22px]" aria-hidden />
              ) : (
                <PanelLeftClose className="size-[22px]" aria-hidden />
              )}
            </button>
          </RailTip>
        </div>

        {/* Прокручиваемое содержимое: навигация + каналы */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
          <ul className="flex shrink-0 flex-col gap-0.5 px-2 py-1">
            {NAV.map((item) => {
              const isActive = view === item.id;
              const showLiveDot = item.id === "live" && liveCount > 0;

              if (compact) {
                return (
                  <li key={item.id} className="w-full">
                    <RailTip label={item.label}>
                      <button
                        type="button"
                        onClick={() => go(item.id)}
                        aria-current={isActive ? "page" : undefined}
                        aria-label={item.label}
                        className={cn(
                          "group grid h-12 w-full place-items-center rounded-lg transition-colors",
                          isActive
                            ? "bg-white/[.06] text-white"
                            : "text-zinc-400 hover:bg-white/[.04] hover:text-zinc-100",
                        )}
                      >
                        <span className="relative">
                          <item.icon className="size-[22px]" aria-hidden />
                          {showLiveDot && (
                            <span
                              className="live-dot absolute -right-1.5 -top-1 size-2 rounded-full bg-live"
                              aria-hidden
                            />
                          )}
                        </span>
                      </button>
                    </RailTip>
                  </li>
                );
              }

              return (
                <li key={item.id} className="w-full">
                  <button
                    type="button"
                    onClick={() => go(item.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex h-11 w-full items-center gap-3 rounded-lg px-3 transition-colors",
                      isActive
                        ? "bg-white/5 text-white"
                        : "text-zinc-400 hover:bg-white/[.04] hover:text-zinc-100",
                    )}
                  >
                    <span className="relative shrink-0">
                      <item.icon className="size-[22px]" aria-hidden />
                      {showLiveDot && (
                        <span
                          className="live-dot absolute -right-1.5 -top-1 size-2 rounded-full bg-live"
                          aria-hidden
                        />
                      )}
                    </span>
                    <span className="label-caps truncate text-[11px]">{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Тонкий разделитель после навигации */}
          <div aria-hidden className="mx-3 my-1 h-px shrink-0 bg-white/10" />

          {/* Заголовок «КАНАЛЫ» между разделителями (только развёрнутый режим) */}
          {!compact && (
            <h2 className="label-caps shrink-0 px-4 py-2 text-[10px] text-muted-foreground">Каналы</h2>
          )}
          {!compact && <div aria-hidden className="mx-3 h-px shrink-0 bg-white/10" />}

          <ul className="flex flex-col gap-0.5 px-2 py-1" aria-label="Каналы">
            {sortedChannels.length === 0 ? (
              !compact && <li className="px-4 py-3 text-xs text-muted-foreground">Каналов пока нет</li>
            ) : compact ? (
              sortedChannels.map((ch) => <CompactChannelItem key={ch.slug} channel={ch} />)
            ) : (
              sortedChannels.map((ch) => <ChannelCard key={ch.slug} channel={ch} />)
            )}
          </ul>
        </div>
      </nav>
    </TooltipProvider>
  );
}

/* ── Мобильный док ─────────────────────────────────────────────────────── */

export function MobileNav() {
  const { go, liveCount } = useNavActions();
  const view = useBackstageStore((s) => s.view);

  return (
    <nav
      role="navigation"
      aria-label="Мобильная навигация"
      className="fixed inset-x-3 bottom-3 z-40 lg:hidden"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      <div className="glass-strong flex items-stretch justify-around rounded-3xl p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]">
        {NAV.map((item) => {
          const isActive = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item.id)}
              aria-current={isActive ? "page" : undefined}
              aria-label={item.label}
              className="relative flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 py-1.5 transition-colors"
            >
              <span className="relative">
                <item.icon
                  className={cn(
                    "size-5.5 transition-all duration-200",
                    isActive ? "scale-110 text-zinc-100" : "text-zinc-400",
                  )}
                  aria-hidden
                />
                {item.id === "live" && liveCount > 0 && (
                  <span className="live-dot absolute -right-1.5 -top-0.5 size-2 rounded-full bg-live" aria-hidden />
                )}
              </span>
              <span
                className={cn(
                  "label-caps text-[8.5px] leading-none",
                  isActive ? "text-zinc-200" : "text-zinc-500",
                )}
              >
                {item.short}
              </span>
              {isActive && (
                <span aria-hidden className="absolute -top-1 h-1 w-1 rounded-full bg-zinc-300" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
