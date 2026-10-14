"use client";

// Экран эфира «GLASS ARENA»: трансляция — главный герой экрана.
// Плеер + чат (десктоп: колонки, мобайл: сворачиваемый чат). Лишнее убрано.

import { useEffect, useMemo, useState } from "react";
import { Bell, Check, Crown, Eye, Heart, Share2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useBackstageStore } from "@/components/backstage/store";
import { useAuthActions, useContent, formatCount, formatUptime } from "@/components/backstage/hooks";
import { VideoPlayer } from "@/components/backstage/video-player";
import { ChatPanel } from "@/components/backstage/chat-panel";
import { toast } from "@/hooks/use-toast";
import type { ScheduleDto } from "@/lib/types";

function useFollow(slug: string) {
  const [followed, setFollowed] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        const raw = localStorage.getItem("backstage:follows");
        const set = new Set<string>(raw ? JSON.parse(raw) : []);
        setFollowed(set.has(slug));
      } catch {
        setFollowed(false);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [slug]);

  const toggle = () => {
    setFollowed((prev) => {
      const next = !prev;
      try {
        const raw = localStorage.getItem("backstage:follows");
        const set = new Set<string>(raw ? JSON.parse(raw) : []);
        if (next) set.add(slug);
        else set.delete(slug);
        localStorage.setItem("backstage:follows", JSON.stringify([...set]));
      } catch {
        /* noop */
      }
      toast({
        title: next ? "Вы подписались на канал" : "Подписка отменена",
        description: next ? "Уведомим о старте эфира" : undefined,
      });
      return next;
    });
  };

  return { followed, toggle };
}

export function LiveView() {
  const { user, channels, activeChannel, setAuthOpen, setView } = useBackstageStore();
  const { verifySubscription } = useAuthActions();
  const channel = channels.find((c) => c.slug === activeChannel) ?? channels[0];
  const schedule = useContent<ScheduleDto>("schedule");
  const [chatOpen, setChatOpen] = useState(true);
  const { followed, toggle } = useFollow(channel?.slug ?? "");

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
        <Skeleton className="aspect-video w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </div>
    );
  }

  const canWatch = channel.isLive && (user?.isSubscriber || user?.role === "ADMIN");
  const needsLogin = channel.isLive && !user;
  const needsSub = channel.isLive && user && !user.isSubscriber && user.role !== "ADMIN";
  const uptime = formatUptime(channel.liveStartedAt);
  const subLink = channel.telegramLink ?? "https://t.me";

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#ch-${channel.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Ссылка скопирована", description: `backstage · ${channel.name}` });
    } catch {
      toast({ title: "Не удалось скопировать ссылку", variant: "destructive" });
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col xl:flex-row">
      {/* Левая часть: плеер + инфо */}
      <div className="min-w-0 flex-1">
        <div className="p-2 sm:p-3 xl:p-4">
          {channel.isLive ? (
            <div className="overflow-hidden rounded-2xl ring-1 ring-white/10 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.9)]">
              <VideoPlayer
                src={canWatch ? (channel.hlsUrl ?? null) : "locked-placeholder"}
                locked={!canWatch}
                poster={channel.livePreviewUrl ?? channel.bannerUrl}
                posterAccent={channel.accentColor}
                posterLabel={channel.name}
                lockTitle={needsLogin ? "ПРИВАТНАЯ ТРАНСЛЯЦИЯ" : "ТОЛЬКО ДЛЯ ПОДПИСЧИКОВ"}
                lockDescription={
                  needsLogin
                    ? "Войдите через Telegram — платформа проверит вашу подписку на приватный канал и откроет эфир."
                    : "Эфир доступен подписчикам приватного Telegram-канала. Оформите подписку и возвращайтесь."
                }
                lockChildren={
                  needsLogin ? (
                    <div className="fade-up flex flex-col items-center gap-3">
                      <Button size="lg" className="btn-gradient glow-primary label-caps gap-2 rounded-full px-6" onClick={() => setAuthOpen(true)}>
                        <Crown className="size-4" />
                        Войти через Telegram
                      </Button>
                      <span className="text-xs text-white/60">
                        Уже подписаны? Вход проверит статус автоматически
                      </span>
                    </div>
                  ) : needsSub ? (
                    <div className="fade-up flex flex-col items-center gap-3">
                      <Button size="lg" asChild className="btn-gradient glow-primary label-caps gap-2 rounded-full px-6">
                        <a href={subLink} target="_blank" rel="noreferrer noopener">
                          <Crown className="size-4" />
                          Оформить подписку
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
            </div>
          ) : (
            /* Оффлайн-экран: кино-заглушка */
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl ring-1 ring-white/10">
              <div
                className="absolute inset-0"
                style={{
                  background: `radial-gradient(120% 130% at 30% 10%, ${channel.accentColor}2e 0%, #121218 60%), linear-gradient(160deg, #17171f 0%, #0a0a0e 100%)`,
                }}
              />
              <div className="absolute inset-0 grid place-items-center px-4">
                <div className="text-center">
                  <Avatar className="mx-auto size-20 rounded-3xl ring-2 ring-white/15">
                    <AvatarImage src={channel.avatarUrl ?? undefined} alt={channel.name} />
                    <AvatarFallback
                      style={{ backgroundColor: `${channel.accentColor}33`, color: channel.accentColor }}
                      className="rounded-3xl text-3xl font-black"
                    >
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
                    <Button variant="secondary" className="glass label-caps gap-2 rounded-full text-[12px]" onClick={() => setView("schedule")}>
                      <Bell className="size-4" />
                      НАПОМНИТЬ ОБ ЭФИРЕ
                    </Button>
                    <Button variant="ghost" className="label-caps rounded-full text-[12px] text-muted-foreground" onClick={() => setView("recordings")}>
                      ЗАПИСИ ЭФИРОВ
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Инфо-бар: стеклянная панель, только суть */}
        <div className="px-2 pb-4 sm:px-3 xl:px-4">
          <div className="fade-up flex flex-wrap items-center gap-3.5 rounded-2xl border border-white/5 bg-white/[.03] p-3.5 backdrop-blur-md sm:p-4">
            <Avatar className="size-12 rounded-2xl ring-2 ring-primary/40 sm:size-14">
              <AvatarImage src={channel.avatarUrl ?? undefined} alt={channel.name} />
              <AvatarFallback
                style={{ backgroundColor: `${channel.accentColor}33`, color: channel.accentColor }}
                className="rounded-2xl text-xl font-black"
              >
                {channel.name.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="headline text-base sm:text-lg">{channel.name}</h1>
                {channel.isLive && (
                  <span className="live-breathe label-caps flex items-center gap-1.5 rounded-full bg-live px-2.5 py-0.5 text-[11px] text-white">
                    <span className="size-1.5 rounded-full bg-white live-dot" aria-hidden />
                    LIVE
                  </span>
                )}
                {uptime && (
                  <span className="label-caps text-[11px] text-muted-foreground">{uptime} В ЭФИРЕ</span>
                )}
              </div>
              {channel.isLive ? (
                <>
                  <p className="card-title mt-1 text-sm sm:text-base">{channel.liveTitle}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {channel.liveCategory && (
                      <span className="rounded-full bg-primary/15 px-2.5 py-px font-semibold text-primary">
                        {channel.liveCategory}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Eye className="size-3.5" aria-hidden />
                      {formatCount(Math.max(channel.viewers, 1))} смотрят
                    </span>
                    {channel.liveTags.slice(0, 4).map((t) => (
                      <span key={t} className="rounded-full bg-secondary px-2.5 py-px">
                        {t}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  {channel.tagline ?? `@${channel.handle}`}
                </p>
              )}
            </div>

            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <Button
                onClick={toggle}
                className={cn(
                  "label-caps gap-2 rounded-full px-4 text-[12px]",
                  followed ? "glass text-primary hover:text-primary" : "btn-gradient glow-primary text-white"
                )}
                aria-pressed={followed}
              >
                <Heart className={cn("size-4", followed && "fill-primary")} />
                {followed ? "ВЫ С НАМИ" : formatCount(channel.followers)}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Поделиться"
                className="glass rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => void share()}
              >
                <Share2 className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Чат: справа на десктопе */}
      <aside className="hidden w-[360px] shrink-0 border-l border-white/5 xl:flex xl:flex-col">
        <ChatPanel channelSlug={channel.slug} className="sticky top-16 h-[calc(100vh-4rem)]" />
      </aside>

      {/* Чат: сворачиваемый на мобиле/планшете */}
      <div className="border-t border-white/5 px-2 pt-2 xl:hidden sm:px-3">
        <button
          onClick={() => setChatOpen((v) => !v)}
          aria-expanded={chatOpen}
          className="glass label-caps flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-[12px]"
        >
          <span className="flex items-center gap-1.5 text-primary">
            <Eye className="size-4" aria-hidden />
            ЧАТ
          </span>
          {channel.isLive && (
            <span className="rounded-full bg-live/15 px-2 py-px text-[11px] font-bold text-[#ff8080]">
              {formatCount(Math.max(channel.viewers, 1))}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            {chatOpen ? "Свернуть" : "Развернуть"}
            {chatOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </span>
        </button>
        {chatOpen && <ChatPanel channelSlug={channel.slug} className="mt-2 h-[62vh] min-h-80 rounded-2xl" />}
      </div>
    </div>
  );
}
