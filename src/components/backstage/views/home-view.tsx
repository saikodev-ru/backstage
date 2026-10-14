"use client";

// Главная «GLASS ARENA»: герой (эфир или канвас канала) + секции.
// Толстая типографика, кино-карточки, минимум лишнего.

import { ArrowRight, Clapperboard, Radio, Sparkles, Video, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useBackstageStore } from "@/components/backstage/store";
import { useContent, formatCount } from "@/components/backstage/hooks";
import {
  ClipCard,
  LiveChannelCard,
  RecordingCard,
  ScheduleRow,
} from "@/components/backstage/cards";
import { SmartImage } from "@/components/backstage/smart-image";
import type { ClipDto, RecordingDto, ScheduleDto } from "@/lib/types";

function Section({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="fade-up">
      <header className="mb-4 flex items-center gap-3">
        <Icon className="size-5 text-primary" />
        <h2 className="headline text-base sm:text-lg">{title}</h2>
        {action && (
          <Button
            variant="ghost"
            size="sm"
            className="label-caps ml-auto gap-1.5 rounded-full text-[11px] text-muted-foreground hover:bg-white/5 hover:text-foreground"
            onClick={action.onClick}
          >
            {action.label}
            <ArrowRight className="size-4" />
          </Button>
        )}
      </header>
      {children}
    </section>
  );
}

export function HomeView() {
  const { channels, setView, openChannel } = useBackstageStore();
  const clips = useContent<ClipDto>("clips");
  const recordings = useContent<RecordingDto>("recordings");
  const schedule = useContent<ScheduleDto>("schedule");

  const liveChannels = channels.filter((c) => c.isLive);
  const hero = liveChannels[0];
  const main = hero ?? channels[0];
  const bySlug = (slug: string) => channels.find((c) => c.slug === slug);

  return (
    <div className="space-y-10 px-3 py-4 sm:px-5 sm:py-6 lg:px-7">
      {/* Герой: текущий эфир dypaGPT */}
      {hero ? (
        <section aria-label="Сейчас в эфире">
          <header className="mb-4 flex items-center gap-3">
            <Radio className="size-5 text-live" />
            <h2 className="headline text-base sm:text-lg">СЕЙЧАС В ЭФИРЕ</h2>
          </header>
          <div className="grid gap-5 lg:grid-cols-[2.1fr_1fr] lg:gap-6">
            <LiveChannelCard channel={hero} hero />
            {liveChannels.length > 1 && (
              <div className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-1">
                {liveChannels.slice(1, 3).map((c) => (
                  <LiveChannelCard key={c.slug} channel={c} />
                ))}
              </div>
            )}
          </div>
        </section>
      ) : (
        /* Офлайн-герой: канвас канала dypaGPT */
        main && (
          <section aria-label="Канал dypaGPT" className="fade-up">
            <div className="group relative overflow-hidden rounded-3xl ring-1 ring-white/10">
              <div className="relative aspect-[21/10] max-h-[520px] w-full">
                <SmartImage
                  src={main.bannerUrl}
                  alt={main.name}
                  accent={main.accentColor}
                  label={main.name}
                  eager
                  className="absolute inset-0"
                  imgClassName="opacity-80"
                />
                <span className="scrim pointer-events-none absolute inset-0" />
                <span
                  aria-hidden
                  className="absolute inset-0"
                  style={{ background: `radial-gradient(90% 120% at 15% 100%, ${main.accentColor}30 0%, transparent 60%)` }}
                />
                <span className="absolute inset-x-0 bottom-0 flex items-end gap-4 p-5 sm:p-7">
                  <Avatar className="size-16 shrink-0 rounded-3xl ring-2 ring-white/25 sm:size-20">
                    <AvatarImage src={main.avatarUrl ?? undefined} alt={main.name} />
                    <AvatarFallback
                      style={{ backgroundColor: `${main.accentColor}33`, color: main.accentColor }}
                      className="rounded-3xl text-2xl font-black sm:text-3xl"
                    >
                      {main.name.slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="display-hero block truncate">{main.name}</span>
                    <span className="label-caps mt-1.5 block text-[11px] text-white/70 sm:text-xs">
                      {main.tagline ?? `@${main.handle}`} · {formatCount(main.followers)} подписчиков
                    </span>
                    <span className="mt-4 flex flex-wrap gap-2.5">
                      <Button
                        className="btn-gradient glow-primary label-caps gap-2 rounded-full px-5"
                        onClick={() => openChannel(main.slug)}
                      >
                        <Radio className="size-4" />
                        ПЕРЕЙТИ НА КАНАЛ
                      </Button>
                      <Button
                        variant="secondary"
                        className="glass label-caps gap-2 rounded-full px-5"
                        onClick={() => setView("schedule")}
                      >
                        <Calendar className="size-4" />
                        РАСПИСАНИЕ
                      </Button>
                    </span>
                  </span>
                </span>
              </div>
            </div>
          </section>
        )
      )}

      {/* Клипы */}
      <Section
        icon={Clapperboard}
        title="КЛИПЫ"
        action={{ label: "ВСЕ КЛИПЫ", onClick: () => setView("clips") }}
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {clips === null
            ? [0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="aspect-video w-full rounded-2xl" />
                </div>
              ))
            : clips
                .slice(0, 4)
                .map((clip) => <ClipCard key={clip.id} clip={clip} channel={bySlug(clip.channelSlug)} />)}
        </div>
      </Section>

      {/* Записи */}
      <Section
        icon={Video}
        title="ЗАПИСИ ЭФИРОВ"
        action={{ label: "ВСЕ ЗАПИСИ", onClick: () => setView("recordings") }}
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {recordings === null
            ? [0, 1, 2].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="aspect-video w-full rounded-2xl" />
                </div>
              ))
            : recordings
                .slice(0, 4)
                .map((rec) => <RecordingCard key={rec.id} recording={rec} channel={bySlug(rec.channelSlug)} />)}
        </div>
      </Section>

      {/* Расписание */}
      <Section
        icon={Calendar}
        title="БЛИЖАЙШИЕ ЭФИРЫ"
        action={{ label: "ВСЁ РАСПИСАНИЕ", onClick: () => setView("schedule") }}
      >
        <div className="space-y-2.5">
          {schedule === null
            ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)
            : schedule
                .slice(0, 3)
                .map((entry) => <ScheduleRow key={entry.id} entry={entry} channel={bySlug(entry.channelSlug)} />)}
        </div>
      </Section>

      {/* Футер главной */}
      <footer className="border-t border-white/5 pt-5 text-xs leading-relaxed text-muted-foreground/60">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Sparkles className="size-4 text-primary/60" aria-hidden />
          <span className="label-caps text-[10px]">BACKSTAGE — ПРИВАТНЫЕ ТРАНСЛЯЦИИ ДЛЯ ПЛАТНЫХ ПОДПИСЧИКОВ</span>
        </div>
      </footer>
    </div>
  );
}
