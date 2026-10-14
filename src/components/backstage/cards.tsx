"use client";

// Общие карточки витрины «Бэкстейдж»: каналы, клипы, записи, расписание.

import { useState } from "react";
import { Calendar, Clock, Play, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClipDto, PublicChannel, RecordingDto, ScheduleDto } from "@/lib/types";
import { formatCount, formatDuration, formatUptime, formatWhen } from "@/components/backstage/hooks";
import { useBackstageStore } from "@/components/backstage/store";

/** Живой бейдж LIVE */
export function LiveBadge({ viewers, uptime }: { viewers?: number; uptime?: string }) {
  return (
    <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-2">
      <span className="flex items-center gap-1.5 rounded-sm bg-live px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
        <span className="size-1.5 rounded-full bg-white live-dot" aria-hidden />
        Live
      </span>
      {typeof viewers === "number" && viewers > 0 && (
        <span className="rounded-sm bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
          {formatCount(viewers)}
        </span>
      )}
      {uptime && (
        <span className="hidden rounded-sm bg-black/75 px-1.5 py-0.5 text-[11px] text-white/90 backdrop-blur-sm sm:block">
          {uptime}
        </span>
      )}
    </span>
  );
}

/** Превью 16:9 с фолбэком на градиент + буква канала */
export function Thumb({
  src,
  alt,
  accent,
  label,
  className,
  children,
}: {
  src?: string | null;
  alt: string;
  accent: string;
  label: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-lg bg-[#15151b]",
        className
      )}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <div
          className="grid size-full place-items-center"
          style={{
            background: `radial-gradient(120% 120% at 30% 20%, ${accent}40 0%, #16161c 55%), linear-gradient(160deg, #1a1a22 0%, #121217 100%)`,
          }}
        >
          <span
            className="text-4xl font-black tracking-tight opacity-30"
            style={{ color: accent }}
          >
            {label.slice(0, 1).toUpperCase()}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

/** Большая карточка живого канала (герой витрины) */
export function LiveChannelCard({ channel, hero = false }: { channel: PublicChannel; hero?: boolean }) {
  const openChannel = useBackstageStore((s) => s.openChannel);
  const uptime = formatUptime(channel.liveStartedAt);
  const viewer = channel.viewers + 1; // + один «анонимный» зритель всегда есть, чтобы витрина выглядела живой

  return (
    <button
      onClick={() => openChannel(channel.slug)}
      className={cn(
        "group block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg",
        hero && "fade-up"
      )}
      aria-label={`${channel.name}: ${channel.liveTitle ?? "в эфире"}`}
    >
      <Thumb src={channel.livePreviewUrl} alt={channel.name} accent={channel.accentColor} label={channel.name}>
        <LiveBadge viewers={viewer} uptime={uptime} />
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-80" />
        <span className="pointer-events-none absolute inset-0 hidden place-items-center group-hover:grid">
          <span className="grid size-14 place-items-center rounded-full bg-primary/90 shadow-[0_0_30px_rgba(169,112,255,0.5)] transition-transform group-hover:scale-110">
            <Play className="size-6 translate-x-0.5 fill-white text-white" />
          </span>
        </span>
      </Thumb>
      <div className="mt-2.5 flex gap-3">
        <Avatar className="mt-0.5 size-9 rounded-full ring-1 ring-border">
          <AvatarImage src={channel.avatarUrl ?? undefined} alt={channel.name} />
          <AvatarFallback
            style={{ backgroundColor: `${channel.accentColor}26`, color: channel.accentColor }}
            className="rounded-full text-sm font-semibold"
          >
            {channel.name.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className={cn("truncate font-semibold", hero ? "text-base sm:text-lg" : "text-sm")}>
            {channel.liveTitle ?? `${channel.name} в эфире`}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{channel.name}</span>
            {channel.liveCategory && (
              <>
                <span aria-hidden>·</span>
                <span className="rounded-sm bg-secondary px-1.5 py-px text-[11px]">{channel.liveCategory}</span>
              </>
            )}
          </div>
          {hero && channel.liveTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {channel.liveTags.map((t) => (
                <span key={t} className="rounded-sm border border-border bg-secondary/50 px-1.5 py-px text-[11px] text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

/** Карточка офлайн-канала */
export function OfflineChannelCard({ channel }: { channel: PublicChannel }) {
  const openChannel = useBackstageStore((s) => s.openChannel);
  return (
    <button
      onClick={() => openChannel(channel.slug)}
      className="group block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-lg">
        <div className="relative size-full">
          <Thumb src={channel.bannerUrl} alt={channel.name} accent={channel.accentColor} label={channel.name} className="absolute inset-0 opacity-30 blur-[1px] saturate-50" />
        </div>
        <span className="absolute inset-0 grid place-items-center">
          <span className="rounded-sm bg-black/60 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/70">
            Оффлайн
          </span>
        </span>
      </div>
      <div className="mt-2.5 flex gap-3">
        <Avatar className="size-9 rounded-full opacity-80 ring-1 ring-border">
          <AvatarImage src={channel.avatarUrl ?? undefined} alt={channel.name} />
          <AvatarFallback
            style={{ backgroundColor: `${channel.accentColor}26`, color: channel.accentColor }}
            className="rounded-full text-sm font-semibold"
          >
            {channel.name.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{channel.name}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{channel.tagline ?? `@${channel.handle}`}</div>
          <div className="mt-1 text-xs text-muted-foreground/70">
            {formatCount(channel.followers)} подписчиков
          </div>
        </div>
      </div>
    </button>
  );
}

/** Карточка клипа */
export function ClipCard({ clip, channel }: { clip: ClipDto; channel?: PublicChannel }) {
  const accent = channel?.accentColor ?? "#a970ff";
  return (
    <div className="group w-full cursor-pointer">
      <Thumb src={clip.thumbnailUrl} alt={clip.title} accent={accent} label={channel?.name ?? clip.channelSlug}>
        <span className="absolute bottom-2 right-2 rounded-sm bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">
          {formatDuration(clip.durationSec)}
        </span>
        <span className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="grid size-11 place-items-center rounded-full bg-black/60 backdrop-blur-sm">
            <Play className="size-5 translate-x-px fill-white text-white" />
          </span>
        </span>
      </Thumb>
      <div className="mt-2 flex gap-2.5">
        <Avatar className="size-7 rounded-full ring-1 ring-border">
          <AvatarImage src={channel?.avatarUrl ?? undefined} alt={channel?.name ?? clip.channelSlug} />
          <AvatarFallback
            style={{ backgroundColor: `${accent}26`, color: accent }}
            className="rounded-full text-[10px] font-semibold"
          >
            {(channel?.name ?? clip.channelSlug).slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-medium leading-snug">{clip.title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {channel?.name ?? clip.channelSlug} · {formatCount(clip.views)} просмотров
          </div>
        </div>
      </div>
    </div>
  );
}

/** Карточка записи эфира */
export function RecordingCard({ recording, channel }: { recording: RecordingDto; channel?: PublicChannel }) {
  const accent = channel?.accentColor ?? "#a970ff";
  return (
    <div className="group w-full cursor-pointer">
      <Thumb src={recording.thumbnailUrl} alt={recording.title} accent={accent} label={channel?.name ?? recording.channelSlug}>
        <span className="absolute bottom-2 right-2 rounded-sm bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">
          {formatDuration(recording.durationSec)}
        </span>
        <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded-sm bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white/90">
          <Play className="size-3 fill-white text-white" /> Запись
        </span>
      </Thumb>
      <div className="mt-2">
        <div className="line-clamp-1 text-sm font-medium">{recording.title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {channel?.name ?? recording.channelSlug} · {formatCount(recording.views)} просмотров
        </div>
      </div>
    </div>
  );
}

/** Строка расписания */
export function ScheduleRow({ entry, channel }: { entry: ScheduleDto; channel?: PublicChannel }) {
  const openChannel = useBackstageStore((s) => s.openChannel);
  const when = formatWhen(entry.startsAt);
  const accent = channel?.accentColor ?? "#a970ff";
  return (
    <button
      onClick={() => channel && openChannel(channel.slug)}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/30 sm:gap-4 sm:p-4"
    >
      <div
        className="flex w-16 shrink-0 flex-col items-center rounded-md py-2"
        style={{ backgroundColor: `${accent}1a`, color: accent }}
      >
        <Calendar className="size-4" aria-hidden />
        <span className="mt-1 text-[11px] font-semibold leading-tight">{when.day}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold sm:text-base">{entry.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {when.time} · {Math.round(entry.durationMin / 60 * 10) / 10} ч
          </span>
          {channel && <span className="font-medium text-foreground/70">{channel.name}</span>}
          {entry.category && (
            <span className="rounded-sm bg-secondary px-1.5 py-px text-[11px]">{entry.category}</span>
          )}
        </div>
        {entry.note && (
          <div className="mt-1 line-clamp-1 text-xs text-muted-foreground/70">{entry.note}</div>
        )}
      </div>
      <Badge
        variant="secondary"
        className={cn(
          "shrink-0",
          when.relative === "идёт сейчас" && "bg-live/15 text-[#ff6b6b] hover:bg-live/15"
        )}
      >
        {when.relative}
      </Badge>
    </button>
  );
}
