"use client";

// Страница канала (1:1 Twitch): баннер-шапка, аватар с толстым кольцом
// (live — красным), имя/подписчики, кнопки подписки, CTA «Смотреть эфир»
// (обратно к трансляции), клипы канала и «О канале» с панелями.
// Попадание: клик по аватару/нику/категории в баре под трансляцией.

import { useMemo, useState } from "react";
import {
  ChevronLeft,
  Share2,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { findCategory } from "@/lib/categories";
import { ViewersIcon } from "@/components/backstage/icons";
import { useBackstageStore } from "@/components/backstage/store";
import { useContent, formatCount, formatWhen } from "@/components/backstage/hooks";
import { AboutSection, SubscribeDialog } from "@/components/backstage/views/live-view";
import { ClipCard } from "@/components/backstage/cards";
import { toast } from "@/hooks/use-toast";
import type { ClipDto, ScheduleDto } from "@/lib/types";

export function ChannelView() {
  const { user, channels, activeChannel, openChannel, setView } = useBackstageStore();
  const channel = channels.find((c) => c.slug === activeChannel) ?? channels[0];

  const clips = useContent<ClipDto>("clips");
  const schedule = useContent<ScheduleDto>("schedule");
  const [subOpen, setSubOpen] = useState(false);

  const channelClips = useMemo(
    () => (clips ?? []).filter((c) => c.channelSlug === channel?.slug).slice(0, 6),
    [clips, channel?.slug]
  );
  const nextStream = useMemo(
    () =>
      schedule
        ?.filter((s) => s.channelSlug === channel?.slug && new Date(s.startsAt).getTime() > Date.now())
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null,
    [schedule, channel?.slug]
  );

  if (!channel) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Skeleton className="h-44 w-full rounded-xl sm:h-56" />
        <Skeleton className="h-10 w-56 rounded-lg" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const category = findCategory(channel.liveCategory);

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#chp-${channel.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Ссылка скопирована", description: `backstage · ${channel.name}` });
    } catch {
      toast({ title: "Не удалось скопировать ссылку", variant: "destructive" });
    }
  };

  return (
    <div className="mx-auto max-w-5xl pb-16">
      {/* ── Баннер-шапка ── */}
      <div className="relative h-40 w-full overflow-hidden sm:h-56">
        {channel.bannerUrl ? (
          <img
            src={channel.bannerUrl}
            alt={`Баннер ${channel.name}`}
            className="size-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(110%_140%_at_30%_0%,#232329_0%,#121215_65%),linear-gradient(160deg,#17171b_0%,#0c0c0f_100%)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
        <button
          onClick={() => setView(channel.isLive ? "live" : "home")}
          aria-label="Назад"
          className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 text-[12px] font-semibold text-white/90 backdrop-blur transition-colors hover:bg-black/70"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {channel.isLive ? "К трансляции" : "Назад"}
        </button>
      </div>

      {/* ── Шапка канала: аватар + имя + кнопки ── */}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-4 px-4 pt-0 sm:px-6">
        <div className="relative -mt-10 shrink-0 self-end sm:-mt-14">
          <span
            className={cn(
              "grid place-items-center rounded-full p-1",
              channel.isLive ? "bg-live" : "bg-white/25"
            )}
          >
            <Avatar className="size-20 rounded-full sm:size-28">
              <AvatarImage src={channel.avatarUrl ?? undefined} alt={channel.name} />
              <AvatarFallback className="rounded-full bg-[#1c1c21] text-3xl font-black text-[#d6d6de] sm:text-4xl">
                {channel.name.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </span>
          {channel.isLive && (
            <span
              className="label-caps absolute bottom-0 left-1/2 h-4 w-14 -translate-x-1/2 rounded-[5px] text-center text-[10px] font-bold leading-4 tracking-[0.1em] text-white"
              style={{ backgroundColor: "#eb0400" }}
              title="В эфире"
            >
              LIVE
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 pb-1">
          <h1 className="headline truncate text-xl sm:text-3xl">{channel.name}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            @{channel.handle}
            {channel.isLive && (
              <>
                {" · "}
                <span className="inline-flex items-center gap-1 font-bold text-live">
                  <ViewersIcon className="size-3.5" />
                  {formatCount(Math.max(channel.viewers, 1))} смотрят
                </span>
              </>
            )}
            {" · "}
            <span className="font-semibold text-foreground/80">{formatCount(channel.followers)}</span>{" "}
            отслеживают
          </p>
          {channel.tagline && (
            <p className="mt-1.5 max-w-2xl text-[13px] leading-snug text-foreground/70">{channel.tagline}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pb-1">
          {/* Единственная CTA — подписка (фоллоу-кнопки больше нет):
              подписчик/автор видят активное состояние «ПОДПИСАН» */}
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
          <Button
            variant="ghost"
            size="icon"
            aria-label="Поделиться"
            className="rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground"
            onClick={() => void share()}
          >
            <Share2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* ── CTA: смотреть эфир / офлайн ── */}
      <div className="px-4 pt-6 sm:px-6">
        {channel.isLive ? (
          <button
            onClick={() => openChannel(channel.slug)}
            className="group flex w-full items-center gap-4 rounded-xl border border-white/[.06] bg-white/[.02] p-4 text-left transition-colors hover:bg-white/[.05]"
            aria-label={`Смотреть эфир: ${channel.liveTitle ?? channel.name}`}
          >
            <span className="btn-gradient glow-primary label-caps grid size-11 shrink-0 place-items-center rounded-full text-[11px] text-white group-hover:scale-105">
              <ViewersIcon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="label-caps flex items-center gap-1.5 text-[10px] text-live">
                <span className="live-dot size-1.5 rounded-full bg-live" aria-hidden />
                В ЭФИРЕ СЕЙЧАС
              </span>
              <span className="card-title mt-1 block truncate text-sm sm:text-base">
                {channel.liveTitle ?? channel.name}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {channel.liveCategory && (
                  <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 font-semibold text-foreground/80">
                    {category && <span aria-hidden>{category.emoji}</span>}
                    {category?.name ?? channel.liveCategory}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 font-bold text-live">
                  <ViewersIcon className="size-3.5" />
                  {formatCount(Math.max(channel.viewers, 1))}
                </span>
              </span>
            </span>
            <span className="label-caps hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground group-hover:text-foreground sm:flex">
              СМОТРЕТЬ
            </span>
          </button>
        ) : (
          <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-4">
            <p className="label-caps text-[11px] text-muted-foreground">КАНАЛ ОФЛАЙН</p>
            {nextStream ? (
              <p className="mt-2 text-[13px] text-foreground/80">
                Следующий эфир:{" "}
                <span className="card-title text-foreground">{nextStream.title}</span>
                {" · "}
                {(() => {
                  const w = formatWhen(nextStream.startsAt);
                  return `${w.day} в ${w.time} (${w.relative})`;
                })()}
              </p>
            ) : (
              <p className="mt-2 text-[13px] text-muted-foreground">
                Расписание уточняется — отслеживайте канал, чтобы не пропустить старт
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Клипы канала ── */}
      {channelClips.length > 0 && (
        <section className="px-4 pt-8 sm:px-6" aria-label="Клипы канала">
          <h2 className="label-caps mb-4 text-[13px]">
            КЛИПЫ <span className="text-muted-foreground">· {channel.name}</span>
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {channelClips.map((c) => (
              <ClipCard key={c.id} clip={c} channel={channel} />
            ))}
          </div>
        </section>
      )}

      {/* ── О канале (описание + панели, редактор для автора) ── */}
      <div className="pt-8">
        <AboutSection key={channel.slug} channel={channel} />
      </div>

      {/* Диалог платной подписки */}
      <SubscribeDialog channel={channel} open={subOpen} onOpenChange={setSubOpen} />
    </div>
  );
}
