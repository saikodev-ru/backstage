"use client";

// Топбар «GLASS ARENA»: только необходимое — бренд, live-CTA, профиль.
// Поиск и уведомления убраны: один канал не нуждается в них.

import Link from "next/link";
import { LogOut, Radio, Settings2, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useAuthActions } from "@/components/backstage/hooks";

export function BrandMark({ withText = true }: { withText?: boolean }) {
  return (
    <span className="flex select-none items-center gap-2.5">
      <span
        aria-hidden
        className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-[#c9a4ff] via-[#a970ff] to-[#6d3eda] shadow-[0_0_22px_rgba(169,112,255,0.45)]"
      >
        <svg viewBox="0 0 24 24" className="size-4.5 text-white" fill="currentColor">
          <path d="M9.5 7.6v8.8c0 .8.9 1.3 1.6.9l7-4.4c.6-.4.6-1.4 0-1.8l-7-4.4c-.7-.4-1.6.1-1.6.9Z" />
          <path d="M4 8.5c.6 0 1 .4 1 1v5c0 .6-.4 1-1 1s-1-.4-1-1v-5c0-.6.4-1 1-1Z" opacity=".55" />
        </svg>
      </span>
      {withText && (
        <span className="brand text-base sm:text-lg" aria-label="BACKSTAGE">
          BACK<span className="text-gradient">STAGE</span>
        </span>
      )}
    </span>
  );
}

export function TopBar() {
  const { user, channels, setAuthOpen, setAdminOpen, openChannel, view } = useBackstageStore();
  const { logout, verifySubscription } = useAuthActions();

  const liveChannel = channels.find((c) => c.isLive);

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-background/70 backdrop-blur-2xl">
      <div className="flex h-16 items-center gap-3 px-3 sm:px-5">
        <Link href="/" aria-label="Бэкстейдж — на главную" className="shrink-0">
          <BrandMark withText />
        </Link>

        {/* Live-CTA: появляется только когда эфир идёт, а мы не на экране эфира */}
        <div className="mx-auto hidden sm:block">
          {liveChannel && view !== "live" && (
            <button
              onClick={() => openChannel(liveChannel.slug)}
              className="btn-gradient glow-primary label-caps group flex items-center gap-2 rounded-full px-4 py-2 text-[12px] text-white"
            >
              <span className="size-2 rounded-full bg-white live-dot" aria-hidden />
              СМОТРЕТЬ ЭФИР
              <span className="hidden max-w-[36ch] truncate font-semibold text-white/70 lg:inline">
                {liveChannel.liveTitle ? `· ${liveChannel.liveTitle}` : ""}
              </span>
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
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
