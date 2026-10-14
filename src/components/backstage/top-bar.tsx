"use client";

// Топбар v2 «ГРАФИТ»: бренд, live-CTA, ПОИСК (каналы/клипы/записи по словам),
// настройки канала (для автора) и профиль. Twitch-подобная компоновка.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  LogOut,
  Radio,
  Search,
  Settings,
  Settings2,
  ShieldCheck,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useBackstageStore } from "@/components/backstage/store";
import { useAuthActions, formatCount } from "@/components/backstage/hooks";
import type { ClipDto, PublicChannel, RecordingDto } from "@/lib/types";

export function BrandMark({ withText = true }: { withText?: boolean }) {
  return (
    <span className="flex select-none items-center gap-2.5">
      <span
        aria-hidden
        className="grid size-9 place-items-center rounded-xl bg-[#f2f2f5] text-[#101014] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.8)]"
      >
        <svg viewBox="0 0 24 24" className="size-4.5" fill="currentColor">
          <path d="M9.5 7.6v8.8c0 .8.9 1.3 1.6.9l7-4.4c.6-.4.6-1.4 0-1.8l-7-4.4c-.7-.4-1.6.1-1.6.9Z" />
          <path d="M4 8.5c.6 0 1 .4 1 1v5c0 .6-.4 1-1 1s-1-.4-1-1v-5c0-.6.4-1 1-1Z" opacity=".55" />
        </svg>
      </span>
      {withText && (
        <span className="brand text-base text-foreground sm:text-lg" aria-label="BACKSTAGE">
          BACKSTAGE
        </span>
      )}
    </span>
  );
}

/* ── Поиск: каналы / клипы / записи по словам ─────────────────────────── */

type SearchResults = {
  channels: PublicChannel[];
  clips: ClipDto[];
  recordings: RecordingDto[];
};

const EMPTY_RESULTS: SearchResults = { channels: [], clips: [], recordings: [] };

async function fetchSearch(q: string, signal?: AbortSignal): Promise<SearchResults | null> {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
      cache: "no-store",
      signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as SearchResults;
  } catch {
    return null;
  }
}

/** Список результатов (используется и в дропдауне, и в мобильном диалоге) */
function SearchResultsList({
  results,
  loading,
  onPickChannel,
  onPickClip,
  onPickRecording,
}: {
  results: SearchResults;
  loading: boolean;
  onPickChannel: (slug: string) => void;
  onPickClip: (c: ClipDto) => void;
  onPickRecording: (r: RecordingDto) => void;
}) {
  const { channels, clips, recordings } = results;
  const empty = channels.length === 0 && clips.length === 0 && recordings.length === 0;

  if (loading) {
    return <p className="label-caps px-4 py-6 text-center text-[11px] text-muted-foreground">ИЩЕМ…</p>;
  }
  if (empty) {
    return <p className="label-caps px-4 py-6 text-center text-[11px] text-muted-foreground">НИЧЕГО НЕ НАЙДЕНО</p>;
  }

  return (
    <div className="max-h-[min(24rem,60vh)] overflow-y-auto p-1.5">
      {channels.length > 0 && (
        <section>
          <h3 className="label-caps px-2.5 py-1.5 text-[10px] text-muted-foreground">Каналы</h3>
          {channels.map((c) => (
            <button
              key={c.slug}
              type="button"
              onClick={() => onPickChannel(c.slug)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[.05]"
            >
              <Avatar className="size-8 rounded-full">
                <AvatarImage src={c.avatarUrl ?? undefined} alt={c.name} />
                <AvatarFallback className="rounded-full bg-[#1c1c21] text-xs font-bold text-[#d6d6de]">
                  {c.name.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold">{c.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {c.isLive ? c.liveTitle ?? "в эфире" : c.tagline ?? "канал"}
                </span>
              </span>
              {c.isLive && (
                <span className="label-caps live-breathe flex items-center gap-1 rounded-full bg-live px-2 py-0.5 text-[10px] text-white">
                  <span className="live-dot size-1 rounded-full bg-white" aria-hidden />
                  LIVE
                </span>
              )}
            </button>
          ))}
        </section>
      )}
      {clips.length > 0 && (
        <section>
          <h3 className="label-caps px-2.5 py-1.5 text-[10px] text-muted-foreground">Клипы</h3>
          {clips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPickClip(c)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[.05]"
            >
              <Clapperboard className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{c.title}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{formatCount(c.views)} просм.</span>
            </button>
          ))}
        </section>
      )}
      {recordings.length > 0 && (
        <section>
          <h3 className="label-caps px-2.5 py-1.5 text-[10px] text-muted-foreground">Записи</h3>
          {recordings.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPickRecording(r)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[.05]"
            >
              <Video className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{r.title}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{formatCount(r.views)} просм.</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

/** Десктопный поиск в топбаре: поле + дропдаун результатов */
function TopSearch() {
  const openChannel = useBackstageStore((s) => s.openChannel);
  const setView = useBackstageStore((s) => s.setView);
  const [q, setQ] = useState("");
  // последний завершённый запрос — остальное состояние выводится из него
  const [fetched, setFetched] = useState<{ query: string; results: SearchResults } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const query = q.trim();
  const loading = query.length >= 2 && fetched?.query !== query;
  const results = loading || !fetched ? EMPTY_RESULTS : fetched.results;
  const open = query.length >= 2 && !dismissed;

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    const t = window.setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      void fetchSearch(query, ctrl.signal).then((r) => {
        if (r !== null) setFetched({ query, results: r });
      });
    }, 250);
    return () => {
      window.clearTimeout(t);
      abortRef.current?.abort();
    };
  }, [q]);

  const reset = () => {
    setQ("");
    setDismissed(true);
  };

  return (
    <Popover open={open} onOpenChange={(o) => !o && setDismissed(true)}>
      <PopoverTrigger asChild>
        <div className="relative w-full">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value.slice(0, 60));
              setDismissed(false);
            }}
            placeholder="Поиск видео, клипов и каналов"
            aria-label="Поиск по сайту"
            className="h-9 rounded-full border-white/10 bg-white/[.04] pl-9 pr-8 text-[13px] placeholder:text-muted-foreground/60 focus-visible:ring-white/30"
          />
          {q && (
            <button
              type="button"
              aria-label="Очистить поиск"
              onClick={reset}
              className="absolute right-2.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        className="glass-strong w-[var(--radix-popover-trigger-width)] rounded-xl p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SearchResultsList
          results={results}
          loading={loading}
          onPickChannel={(slug) => {
            openChannel(slug);
            reset();
          }}
          onPickClip={(c) => {
            setView("clips");
            reset();
          }}
          onPickRecording={(r) => {
            setView("recordings");
            reset();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Мобильный поиск: иконка → диалог */
function MobileSearch() {
  const openChannel = useBackstageStore((s) => s.openChannel);
  const setView = useBackstageStore((s) => s.setView);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [fetched, setFetched] = useState<{ query: string; results: SearchResults } | null>(null);

  const query = q.trim();
  const loading = query.length >= 2 && fetched?.query !== query;
  const results = loading || !fetched ? EMPTY_RESULTS : fetched.results;

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    const t = window.setTimeout(() => {
      void fetchSearch(query).then((r) => {
        if (r !== null) setFetched({ query, results: r });
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Поиск"
        title="Поиск"
        className="rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground sm:hidden"
        onClick={() => setOpen(true)}
      >
        <Search className="size-5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="glass-strong top-20 max-w-md translate-y-0 rounded-2xl border-white/[.06] p-3">
          <DialogHeader className="sr-only">
            <DialogTitle>Поиск по сайту</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value.slice(0, 60))}
              placeholder="Поиск видео, клипов и каналов"
              aria-label="Поиск по сайту"
              className="h-10 rounded-full border-white/10 bg-white/[.04] pl-9 text-[13px] placeholder:text-muted-foreground/60 focus-visible:ring-white/30"
            />
          </div>
          {query.length >= 2 && (
            <SearchResultsList
              results={results}
              loading={loading}
              onPickChannel={(slug) => {
                openChannel(slug);
                setOpen(false);
                setQ("");
              }}
              onPickClip={() => {
                setView("clips");
                setOpen(false);
                setQ("");
              }}
              onPickRecording={() => {
                setView("recordings");
                setOpen(false);
                setQ("");
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Топбар ───────────────────────────────────────────────────────────── */

export function TopBar() {
  const { user, channels, setAuthOpen, setAdminOpen, openChannel, setView, view } = useBackstageStore();
  const { logout, verifySubscription } = useAuthActions();

  const liveChannel = channels.find((c) => c.isLive);

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-background/70 backdrop-blur-2xl">
      <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-5">
        <Link href="/" aria-label="Бэкстейдж — на главную" className="shrink-0">
          <BrandMark withText />
        </Link>

        {/* Live-CTA: компактная пилюля, пока эфир идёт и мы не на экране эфира */}
        {liveChannel && view !== "live" && (
          <button
            onClick={() => openChannel(liveChannel.slug)}
            className="label-caps live-breathe ml-1 hidden shrink-0 items-center gap-1.5 rounded-full bg-live px-3 py-1.5 text-[11px] text-white md:flex"
            aria-label="Смотреть эфир"
          >
            <span className="size-1.5 rounded-full bg-white live-dot" aria-hidden />
            В ЭФИРЕ
          </button>
        )}

        {/* Поиск: центр топбара (десктоп); иконка на мобиле */}
        <div className="mx-auto hidden w-full max-w-md sm:block">
          <TopSearch />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <MobileSearch />

          {/* Мобильный live-CTA */}
          {liveChannel && view !== "live" && (
            <button
              onClick={() => openChannel(liveChannel.slug)}
              aria-label="Смотреть эфир"
              className="glow-live grid size-10 place-items-center rounded-full bg-live text-white sm:hidden"
            >
              <Radio className="size-5" />
            </button>
          )}

          {/* Настройки канала (только автор) */}
          {user?.role === "ADMIN" && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Настройки канала"
              title="Настройки канала"
              className="rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"
              onClick={() => setView("settings")}
            >
              <Settings className="size-5" />
            </Button>
          )}

          {/* Панель управления эфиром (пульт) */}
          {user?.role === "ADMIN" && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Панель управления"
              title="Панель управления"
              className="rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"
              onClick={() => setAdminOpen(true)}
            >
              <Settings2 className="size-5" />
            </Button>
          )}

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Профиль"
                  className="ml-1 rounded-full ring-2 ring-transparent transition-all hover:ring-primary/60 focus-visible:outline-none focus-visible:ring-primary"
                >
                  <Avatar className="size-9 rounded-full">
                    <AvatarImage src={user.photoUrl ?? undefined} alt={user.firstName} />
                    <AvatarFallback className="rounded-full bg-primary/20 text-sm font-semibold text-primary">
                      {user.firstName.slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="glass-strong w-64 rounded-xl">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="card-title text-sm">
                      {user.firstName} {user.lastName}
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {user.username ? `@${user.username}` : user.authProvider === "demo" ? "демо-аккаунт" : "Telegram"}
                    </span>
                    <div className="mt-1.5 flex gap-1.5">
                      {user.isSubscriber ? (
                        <Badge className="gap-1 bg-primary/15 text-primary hover:bg-primary/15">
                          <ShieldCheck className="size-3" /> Подписчик
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-muted-foreground">
                          Без подписки
                        </Badge>
                      )}
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {user.role === "ADMIN" && (
                  <DropdownMenuItem onClick={() => setView("settings")}>
                    <Settings className="size-4" /> Настройки канала
                  </DropdownMenuItem>
                )}
                {user.authProvider === "telegram" || !user.isSubscriber ? (
                  <DropdownMenuItem onClick={() => void verifySubscription()}>
                    <ShieldCheck className="size-4" />
                    {user.isSubscriber ? "Обновить статус подписки" : "Проверить подписку"}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => void logout()}>
                  <LogOut className="size-4" /> Выйти
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              onClick={() => setAuthOpen(true)}
              className="btn-gradient glow-primary label-caps ml-1 gap-2 rounded-full px-4"
            >
              <UserRound className="size-4" />
              ВОЙТИ
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
