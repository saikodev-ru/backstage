"use client";

// Экран эфира: плеер (с гейтингом подписки), инфо-бар, чат.
// Чат: справа на десктопе, сворачиваемый блок под плеером на мобиле.

import { useEffect, useMemo, useState } from "react";
import { Bell, Check, Crown, Heart, Share2, Users, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useBackstageStore } from "@/components/backstage/store";
import { useAuthActions, useContent, formatCount, formatUptime } from "@/components/backstage/hooks";
import { VideoPlayer } from "@/components/backstage/video-player";
import { ChatPanel } from "@/components/backstage/chat-panel";
import { RecordingCard } from "@/components/backstage/cards";
import { toast } from "@/hooks/use-toast";
import type { RecordingDto, ScheduleDto } from "@/lib/types";

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
  const recordings = useContent<RecordingDto>("recordings");
  const [chatOpen, setChatOpen] = useState(true);
  const { followed, toggle } = useFollow(channel?.slug ?? "");

  const nextStream = useMemo(
    () =>
      schedule
        ?.filter((s) => s.channelSlug === channel?.slug && new Date(s.startsAt).getTime() > Date.now())
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null,
    [schedule, channel?.slug]
  );

  const channelRecordings = useMemo(
    () => recordings?.filter((r) => r.channelSlug === channel?.slug).slice(0, 4) ?? [],
    [recordings, channel?.slug]
  );

  if (!channel) {
    return (
      <div className="space-y-3 px-4 py-8 sm:px-6">
        <Skeleton className="aspect-video w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
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
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col xl:flex-row">
      {/* Левая часть: плеер + инфо */}
      <div className="min-w-0 flex-1">
        <div className="px-2 pt-2 sm:px-4 sm:pt-4">
          {channel.isLive ? (
            <VideoPlayer
              src={canWatch ? (channel.hlsUrl ?? null) : "locked-placeholder"}
              locked={!canWatch}
              poster={channel.livePreviewUrl ?? channel.bannerUrl}
              posterAccent={channel.accentColor}
              posterLabel={channel.name}
              lockTitle={needsLogin ? "Приватная трансляция" : "Только для платных подписчиков"}
              lockDescription={
                needsLogin
                  ? "Войдите через Telegram — платформа проверит вашу подписку на приватный канал и откроет эфир."
                  : "Эфир доступен подписчикам приватного Telegram-канала. Оформите подписку и возвращайтесь."
              }
              lockChildren={
                needsLogin ? (
                  <div className="fade-up flex flex-col items-center gap-2.5">
                    <Button size="lg" className="gap-2" onClick={() => setAuthOpen(true)}>
                      <Crown className="size-4" />
                      Войти через Telegram
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Уже подписаны? Вход проверит статус автоматически
                    </span>
                  </div>
                ) : needsSub ? (
                  <div className="fade-up flex flex-col items-center gap-2.5">
                    <Button size="lg" asChild className="gap-2">
                      <a href={subLink} target="_blank" rel="noreferrer noopener">
                        <Crown className="size-4" />
                        Оформить подписку
                      </a>
                    </Button>
                    <Button variant="secondary" onClick={() => void verifySubscription()}>
                      <Check className="size-4" />
                      Я уже подписан — проверить
                    </Button>
                  </div>
                ) : undefined
              }
            />
          ) : (
            /* Оффлайн-экран */
            <div className="relative aspect-video w-full overflow-hidden rounded-lg">
              <div
                className="absolute inset-0"
                style={{
                  background: `radial-gradient(120% 130% at 30% 10%, ${channel.accentColor}2e 0%, #14141a 60%), linear-gradient(160deg, #191920 0%, #101015 100%)`,
                }}
              />
              <div className="absolute inset-0 grid place-items-center px-4">
                <div className="text-center">
                  <Avatar className="mx-auto size-16 rounded-full ring-2 ring-border/60">
                    <AvatarImage src={channel.avatarUrl ?? undefined} alt={channel.name} />
                    <AvatarFallback
                      style={{ backgroundColor: `${channel.accentColor}33`, color: channel.accentColor }}
                      className="rounded-full text-2xl font-bold"
                    >
                      {channel.name.slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <h2 className="headline mt-3 text-lg">{channel.name} СЕЙЧАС ОФЛАЙН</h2>
                  {nextStream ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Следующий эфир: <span className="font-semibold text-foreground">{nextStream.title}</span>
                      {" · "}
                      {new Date(nextStream.startsAt).toLocaleString("ru-RU", {
                        weekday: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">Расписание уточняется</p>
                  )}
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Button variant="secondary" className="label-caps gap-2 text-[12px]" onClick={() => setView("schedule")}>
                      <Bell className="size-4" />
                      НАПОМНИТЬ ОБ ЭФИРЕ
                    </Button>
                    <Button variant="ghost" className="label-caps text-[12px]" onClick={() => setView("recordings")}>
                      ЗАПИСИ ЭФИРОВ
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Инфо-бар */}
        <div className="px-2 py-3 sm:px-4">
          <div
            className={cn(
              "flex flex-wrap items-start gap-3 rounded-lg border border-border bg-card p-3 sm:p-4",
              "fade-up"
            )}
          >
            <Avatar className="size-11 rounded-full ring-2 ring-primary/30 sm:size-12">
              <AvatarImage src={channel.avatarUrl ?? undefined} alt={channel.name} />
              <AvatarFallback
                style={{ backgroundColor: `${channel.accentColor}33`, color: channel.accentColor }}
                className="rounded-full text-lg font-bold"
              >
                {channel.name.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="headline text-base sm:text-lg">{channel.name}</h1>
                {channel.isLive && (
                  <span className="label-caps flex items-center gap-1.5 rounded-sm bg-live px-1.5 py-0.5 text-[10px] text-white">
                    <span className="size-1.5 rounded-full bg-white live-dot" aria-hidden />
                    LIVE
                  </span>
                )}
                {user?.isSubscriber && channel.isLive && (
                  <Badge className="gap-1 bg-primary/15 text-primary hover:bg-primary/15">
                    <Crown className="size-3" /> Платный доступ
                  </Badge>
                )}
              </div>
              {channel.isLive ? (
                <>
                  <p className="card-title mt-1 text-sm sm:text-base">{channel.liveTitle}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {channel.liveCategory && (
                      <span className="font-medium text-primary/90 hover:underline cursor-pointer">
                        {channel.liveCategory}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Users className="size-3.5" aria-hidden />
                      {formatCount(Math.max(channel.viewers, 1))} смотрят
                    </span>
                    {uptime && <span>{uptime} в эфире</span>}
                    {channel.liveTags.map((t) => (
                      <span key={t} className="rounded-sm bg-secondary px-1.5 py-px">
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
                variant={followed ? "secondary" : "default"}
                onClick={toggle}
                className={cn("label-caps gap-2 text-[12px]", followed && "text-primary")}
                aria-pressed={followed}
              >
                <Heart className={cn("size-4", followed && "fill-primary")} />
                {followed ? "ВЫ ПОДПИСАНЫ" : "ПОДПИСАТЬСЯ"}
                {!followed && (
                  <span className="ml-1 hidden text-xs opacity-70 sm:inline">
                    {formatCount(channel.followers)}
                  </span>
                )}
              </Button>
              <Button variant="secondary" size="icon" aria-label="Поделиться" onClick={() => void share()}>
                <Share2 className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Записи канала (мобайл: под чатом, десктоп: ниже инфо) */}
        {channelRecordings.length > 0 && (
          <div className="px-2 pb-6 pt-2 sm:px-4 xl:hidden">
            <h2 className="label-caps mb-3 text-[12px] text-muted-foreground">
              ЗАПИСИ ЭФИРА
            </h2>
            <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              {channelRecordings.map((r) => (
                <RecordingCard key={r.id} recording={r} channel={channel} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Чат: справа на десктопе */}
      <aside className="hidden w-[340px] shrink-0 border-l border-border xl:flex xl:flex-col">
        <ChatPanel channelSlug={channel.slug} className="h-[calc(100vh-3.5rem)] sticky top-14" />
      </aside>

      {/* Чат: сворачиваемый на мобиле/планшете */}
      <div className="border-t border-border xl:hidden">
        <button
          onClick={() => setChatOpen((v) => !v)}
          aria-expanded={chatOpen}
          className="label-caps flex w-full items-center gap-2 px-4 py-2.5 text-[12px]"
        >
          <Users className="size-4 text-primary" aria-hidden />
          ЧАТ ЭФИРА
          {channel.isLive && (
            <span className="ml-1 rounded-sm bg-live/15 px-1.5 py-px text-[11px] font-bold text-[#ff6b6b]">
              {formatCount(Math.max(channel.viewers, 1))} зрителей
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            {chatOpen ? "Свернуть" : "Развернуть"}
            {chatOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </span>
        </button>
        {chatOpen && <ChatPanel channelSlug={channel.slug} className="h-[60vh] min-h-80" />}
      </div>
    </div>
  );
}
