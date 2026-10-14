"use client";

// Карточки витрины «GLASS ARENA»: кино-стиль Apple TV —
// заголовок на скриме поверх превью, rounded-2xl, glow при ховере.
// Все превью — SmartImage с blur-up low-res плейсхолдерами.

import { Calendar, Clock, Play } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { findCategory } from "@/lib/categories";
import { SmartImage } from "@/components/backstage/smart-image";
import type { ClipDto, PublicChannel, RecordingDto, ScheduleDto } from "@/lib/types";
import { formatCount, formatDuration, formatUptime, formatWhen } from "@/components/backstage/hooks";
import { useBackstageStore } from "@/components/backstage/store";

/** Пилюля LIVE с дыханием */
export function LiveBadge({ viewers, uptime, large = false }: { viewers?: number; uptime?: string; large?: boolean }) {
  return (
    <span className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2">
      <span
        className={cn(
          "live-breathe label-caps flex items-center gap-1.5 rounded-full bg-live px-2.5 py-1 text-white",
          large ? "text-[12px]" : "text-[11px]"
        )}
      >
        <span className={cn("rounded-full bg-white live-dot", large ? "size-2" : "size-1.5")} aria-hidden />
        LIVE
      </span>
      {typeof viewers === "number" && viewers > 0 && (
        <span className="label-caps rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white backdrop-blur-md">
          {formatCount(viewers)}
        </span>
      )}
      {uptime && (
        <span className="label-caps hidden rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white/90 backdrop-blur-md sm:block">
          {uptime}
        </span>
      )}
    </span>
  );
}

/** Превью 16:9 с blur-up и кино-скримом */
export function Thumb({
  src,
  alt,
  accent,
  label,
  className,
  children,
  eager = false,
}: {
  src?: string | null;
  alt: string;
  accent: string;
  label: string;
  className?: string;
  children?: React.ReactNode;
  eager?: boolean;
}) {
  return (
    <div
      className={cn(
        "group/thumb relative aspect-video w-full overflow-hidden rounded-2xl bg-[#121218] ring-1 ring-white/10",
        "transition-all duration-300 group-hover:ring-primary/40 group-hover:glow-soft",
        className
      )}
    >
      <SmartImage
        src={src}
        alt={alt}
        accent={accent}
        label={label}
        eager={eager}
        className="absolute inset-0"
        imgClassName="transition-transform duration-700 ease-out group-hover/thumb:scale-[1.06]"
      />
      {children}
    </div>
  );
}

/** Кнопка-плей по центру (появляется на ховере) */
function PlayOverlay({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <span
        className={cn(
          "grid place-items-center rounded-full bg-[#101014]/85 text-white opacity-0 backdrop-blur-md transition-all duration-300 group-hover:scale-105 group-hover:opacity-100",
          "shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)] ring-1 ring-white/15",
          size === "lg" ? "size-18" : "size-12"
        )}
      >
        <Play className={cn("fill-white", size === "lg" ? "size-8 translate-x-1" : "size-5.5 translate-x-0.5")} />
      </span>
    </span>
  );
}

/** Кинематографичный герой живого канала */
export function LiveChannelCard({ channel, hero = false }: { channel: PublicChannel; hero?: boolean }) {
  const openChannel = useBackstageStore((s) => s.openChannel);
  const uptime = formatUptime(channel.liveStartedAt);
  const viewer = channel.viewers + 1; // + один «анонимный» зритель, чтобы витрина выглядела живой

  return (
    <button
      onClick={() => openChannel(channel.slug)}
      className={cn(
        "group relative block w-full overflow-hidden rounded-3xl text-left ring-1 ring-white/10 transition-all duration-300 hover:ring-white/20 hover:shadow-[0_20px_60px_-20px_rgba(0,0,0,0.75)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        hero && "fade-up"
      )}
      aria-label={`${channel.name}: ${channel.liveTitle ?? "в эфире"}`}
    >
      <div className={cn("relative", hero ? "aspect-[21/10] max-h-[560px] w-full" : "aspect-video w-full")}>
        <SmartImage
          src={channel.livePreviewUrl}
          alt={channel.name}
          accent={channel.accentColor}
          label={channel.name}
          eager={hero}
          className="absolute inset-0"
          imgClassName="transition-transform duration-700 ease-out group-hover:scale-[1.04]"
        />
        <span className="scrim pointer-events-none absolute inset-0" />
        <LiveBadge viewers={viewer} uptime={uptime} large={hero} />
        <PlayOverlay size={hero ? "lg" : "md"} />
        {/* инфо-блок поверх скрима */}
        <span className="absolute inset-x-0 bottom-0 flex items-end gap-3.5 p-4 sm:p-5">
          <Avatar className={cn("shrink-0 rounded-2xl ring-2 ring-white/20", hero ? "size-12 sm:size-14" : "size-10")}>
            <AvatarImage src={channel.avatarUrl ?? undefined} alt={channel.name} />
            <AvatarFallback
              className="rounded-2xl bg-[#1c1c21] text-lg font-black text-[#d6d6de]"
            >
              {channel.name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "headline block truncate",
                hero ? "text-base sm:text-xl lg:text-2xl" : "text-sm sm:text-base"
              )}
            >
              {channel.liveTitle ?? `${channel.name} в эфире`}
            </span>
            <span className="label-caps mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/70">
              <span className="text-white/90">{channel.name}</span>
              {channel.liveCategory && (
                <span className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-px backdrop-blur-sm">
                  {(() => {
                    const cat = findCategory(channel.liveCategory);
                    return cat ? `${cat.emoji} ${cat.name}` : channel.liveCategory;
                  })()}
                </span>
              )}
            </span>
          </span>
        </span>
      </div>
    </button>
  );
}

/** Карточка клипа — кино-стиль: всё на превью */
export function ClipCard({ clip, channel }: { clip: ClipDto; channel?: PublicChannel }) {
  const accent = channel?.accentColor ?? "#a970ff";
  return (
    <div className="group relative w-full cursor-pointer">
      <Thumb src={clip.thumbnailUrl} alt={clip.title} accent={accent} label={channel?.name ?? clip.channelSlug}>
        <PlayOverlay />
        <span className="scrim pointer-events-none absolute inset-0" />
        <span className="label-caps absolute right-2.5 top-2.5 z-10 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white backdrop-blur-md">
          {formatDuration(clip.durationSec)}
        </span>
        <span className="absolute inset-x-0 bottom-0 z-10 p-3.5">
          <span className="card-title line-clamp-2 block text-[13px] leading-snug text-white">{clip.title}</span>
          <span className="label-caps mt-1 block truncate text-[10px] text-white/60">
            {channel?.name ?? clip.channelSlug} · {formatCount(clip.views)} просмотров
          </span>
        </span>
      </Thumb>
    </div>
  );
}

/** Карточка записи эфира — кино-стиль */
export function RecordingCard({ recording, channel }: { recording: RecordingDto; channel?: PublicChannel }) {
  const accent = channel?.accentColor ?? "#a970ff";
  return (
    <div className="group relative w-full cursor-pointer">
      <Thumb src={recording.thumbnailUrl} alt={recording.title} accent={accent} label={channel?.name ?? recording.channelSlug}>
        <PlayOverlay />
        <span className="scrim pointer-events-none absolute inset-0" />
        <span className="label-caps absolute left-2.5 top-2.5 z-10 flex items-center gap-1.5 rounded-full bg-white/12 px-2 py-0.5 text-[10px] text-white/90 backdrop-blur-md">
          <Play className="size-3 fill-white text-white" /> ЗАПИСЬ
        </span>
        <span className="label-caps absolute right-2.5 top-2.5 z-10 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white backdrop-blur-md">
          {formatDuration(recording.durationSec)}
        </span>
        <span className="absolute inset-x-0 bottom-0 z-10 p-3.5">
          <span className="card-title line-clamp-1 block text-[13px] text-white">{recording.title}</span>
          <span className="label-caps mt-1 block truncate text-[10px] text-white/60">
            {channel?.name ?? recording.channelSlug} · {formatCount(recording.views)} просмотров
          </span>
        </span>
      </Thumb>
    </div>
  );
}

/** Строка расписания — стеклянная карточка */
export function ScheduleRow({ entry, channel }: { entry: ScheduleDto; channel?: PublicChannel }) {
  const openChannel = useBackstageStore((s) => s.openChannel);
  const when = formatWhen(entry.startsAt);
  const accent = channel?.accentColor ?? "#a970ff";
  return (
    <button
      onClick={() => channel && openChannel(channel.slug)}
      className="flex w-full items-center gap-3.5 rounded-2xl border border-white/5 bg-white/[.03] p-3.5 text-left backdrop-blur-md transition-all duration-200 hover:border-primary/40 hover:bg-white/[.05] sm:gap-4 sm:p-4"
    >
      <div
        className="label-caps flex w-16 shrink-0 flex-col items-center rounded-xl py-2.5"
        style={{ backgroundColor: `${accent}1c`, color: accent }}
      >
        <Calendar className="size-4" aria-hidden />
        <span className="mt-1 text-[11px] leading-tight">{when.day}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="card-title truncate text-sm sm:text-base">{entry.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {when.time} · {Math.round((entry.durationMin / 60) * 10) / 10} ч
          </span>
          {entry.category && (
            <span className="rounded-full bg-secondary px-2 py-px text-[11px]">{entry.category}</span>
          )}
        </div>
      </div>
      <Badge
        variant="secondary"
        className={cn(
          "label-caps shrink-0 rounded-full text-[11px]",
          when.relative === "идёт сейчас" && "live-breathe bg-live text-white hover:bg-live"
        )}
      >
        {when.relative}
      </Badge>
    </button>
  );
}
