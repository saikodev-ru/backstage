"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, LogOut, Search, Settings2, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useBackstageStore } from "@/components/backstage/store";
import { useAuthActions, formatCount } from "@/components/backstage/hooks";
import type { PublicChannel } from "@/lib/types";

export function BrandMark({ withText = true }: { withText?: boolean }) {
  return (
    <span className="flex items-center gap-2 select-none">
      <span
        aria-hidden
        className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-[#c9a4ff] via-[#a970ff] to-[#7c46d9] shadow-[0_0_18px_rgba(169,112,255,0.35)]"
      >
        <svg viewBox="0 0 24 24" className="size-4 text-white" fill="currentColor">
          <path d="M9.5 7.6v8.8c0 .8.9 1.3 1.6.9l7-4.4c.6-.4.6-1.4 0-1.8l-7-4.4c-.7-.4-1.6.1-1.6.9Z" />
          <path d="M4 8.5c.6 0 1 .4 1 1v5c0 .6-.4 1-1 1s-1-.4-1-1v-5c0-.6.4-1 1-1Z" opacity=".55" />
        </svg>
      </span>
      {withText && (
        <span className="text-lg font-bold tracking-tight">
          Бэк<span className="text-primary">стейдж</span>
        </span>
      )}
    </span>
  );
}

function ChannelResultRow({ channel, onPick }: { channel: PublicChannel; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent"
    >
      <Avatar className="size-8 rounded-full ring-1 ring-border">
        <AvatarImage src={channel.avatarUrl ?? undefined} alt={channel.name} />
        <AvatarFallback
          style={{ backgroundColor: `${channel.accentColor}26`, color: channel.accentColor }}
          className="rounded-full text-xs font-semibold"
        >
          {channel.name.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{channel.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {channel.isLive ? channel.liveTitle ?? "В эфире" : "Оффлайн"}
        </span>
      </span>
      {channel.isLive && (
        <Badge className="bg-live text-[10px] font-bold text-white hover:bg-live">LIVE</Badge>
      )}
    </button>
  );
}

export function TopBar() {
  const { user, channels, setAuthOpen, setAdminOpen, setSearchQuery, searchQuery, openChannel } =
    useBackstageStore();
  const { logout, verifySubscription } = useAuthActions();
  const [mobileSearch, setMobileSearch] = useState(false);
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const results = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return channels
      .filter((c) =>
        [c.name, c.handle, c.liveTitle, c.liveCategory, ...c.liveTags]
          .filter(Boolean)
          .some((s) => (s as string).toLowerCase().includes(q))
      )
      .slice(0, 6);
  }, [channels, searchQuery]);

  const showResults = focused && results.length > 0;
  const liveCount = channels.filter((c) => c.isLive).length;

  const pick = (slug: string) => {
    openChannel(slug);
    setSearchQuery("");
    setFocused(false);
    setMobileSearch(false);
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-[#0d0d11]/90 backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <Link href="/" aria-label="Бэкстейдж — на главную" className="shrink-0">
          <BrandMark withText />
        </Link>

        {/* Поиск: десктоп */}
        <div className="relative mx-auto hidden max-w-md flex-1 md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              blurTimer.current = setTimeout(() => setFocused(false), 150);
            }}
            placeholder="Поиск каналов и эфиров"
            aria-label="Поиск"
            className="border-border bg-[#1a1a21] pl-9 focus-visible:ring-primary/60"
          />
          {showResults && (
            <div
              ref={(el) => {
                if (el && blurTimer.current) {
                  clearTimeout(blurTimer.current);
                  blurTimer.current = null;
                }
              }}
              onMouseDown={(e) => e.preventDefault()}
              className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-border bg-popover shadow-xl shadow-black/40"
            >
              {results.map((c) => (
                <ChannelResultRow key={c.slug} channel={c} onPick={() => pick(c.slug)} />
              ))}
            </div>
          )}
        </div>

        {/* Поиск: мобильный триггер */}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Поиск"
          className="ml-auto md:hidden"
          onClick={() => setMobileSearch((v) => !v)}
        >
          <Search className="size-5" />
        </Button>

        <div className="ml-auto flex items-center gap-1 md:ml-0">
          {user?.role === "ADMIN" && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Панель администратора"
              title="Панель администратора"
              onClick={() => setAdminOpen(true)}
            >
              <Settings2 className="size-5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" aria-label="Уведомления" className="relative">
            <Bell className="size-5" />
            {liveCount > 0 && (
              <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-live live-dot" aria-hidden />
            )}
          </Button>

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Профиль"
                  className="ml-1 rounded-full ring-2 ring-transparent transition-all hover:ring-primary/60 focus-visible:outline-none focus-visible:ring-primary"
                >
                  <Avatar className="size-8 rounded-full">
                    <AvatarImage src={user.photoUrl ?? undefined} alt={user.firstName} />
                    <AvatarFallback className="rounded-full bg-primary/20 text-xs font-semibold text-primary">
                      {user.firstName.slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">
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
                      {user.role === "ADMIN" && (
                        <Badge className="bg-accent text-accent-foreground hover:bg-accent">Админ</Badge>
                      )}
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {!user.isSubscriber && (
                  <DropdownMenuItem onClick={() => void verifySubscription()}>
                    <ShieldCheck className="size-4" /> Проверить подписку
                  </DropdownMenuItem>
                )}
                {user.isSubscriber && user.authProvider === "telegram" && (
                  <DropdownMenuItem onClick={() => void verifySubscription()}>
                    <ShieldCheck className="size-4" /> Обновить статус подписки
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => void logout()}>
                  <LogOut className="size-4" /> Выйти
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button onClick={() => setAuthOpen(true)} className="ml-1 gap-2">
              <UserRound className="size-4" />
              Войти
            </Button>
          )}
        </div>
      </div>

      {/* Поиск: мобильная строка */}
      {mobileSearch && (
        <div className="relative border-t border-border px-3 py-2 md:hidden">
          <Search className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск каналов и эфиров"
            aria-label="Поиск"
            className="border-border bg-[#1a1a21] pl-9"
          />
          {results.length > 0 && (
            <div className="mt-1 overflow-hidden rounded-lg border border-border bg-popover">
              {results.map((c) => (
                <ChannelResultRow key={c.slug} channel={c} onPick={() => pick(c.slug)} />
              ))}
            </div>
          )}
        </div>
      )}
    </header>
  );
}

export { formatCount };
