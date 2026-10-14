"use client";

// Главная «Бэкстейдж» — витрина dypaGPT в стиле Twitch:
// герой эфира, клипы, записи и расписание. Толстая типографика, UPPERCASE.

import { Clapperboard, Radio, Sparkles, Video, Calendar, ArrowRight, Sparkles as SparklesIcon, Gamepad2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBackstageStore } from "@/components/backstage/store";
import { useContent } from "@/components/backstage/hooks";
import {
  ClipCard,
  LiveChannelCard,
  RecordingCard,
  ScheduleRow,
} from "@/components/backstage/cards";
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
      <header className="mb-3.5 flex items-center gap-2.5">
        <Icon className="size-5 text-primary" />
        <h2 className="headline text-base sm:text-lg">{title}</h2>
        {action && (
          <Button
            variant="ghost"
            size="sm"
            className="label-caps ml-auto gap-1 text-[11px] text-muted-foreground hover:text-foreground"
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
    <div className="space-y-9 px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
      {/* Герой: текущий эфир dypaGPT */}
      {hero ? (
        <section aria-label="Сейчас в эфире" className="fade-up">
          <header className="mb-3.5 flex items-center gap-2.5">
            <Radio className="size-5 text-live" />
            <h2 className="headline text-base sm:text-lg">Сейчас в эфире</h2>
            <span className="label-caps rounded-full bg-live/15 px-2 py-0.5 text-[11px] text-[#ff6b6b]">
              {liveChannels.length > 1 ? `${liveChannels.length} канала` : "1 канал"}
            </span>
          </header>
          <div className="grid gap-5 lg:grid-cols-[1.9fr_1fr] lg:gap-6">
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
        <section className="fade-up rounded-xl border border-border bg-gradient-to-br from-accent/40 via-card to-card p-6 sm:p-8">
          <div className="flex items-center gap-2.5">
            <Sparkles className="size-5 text-primary" />
            <h2 className="headline text-base sm:text-lg">dypaGPT сейчас отдыхает</h2>
          </div>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
            Эфира нет, но витрина живёт: расписание, клипы и архив на месте.
            Подписка на уведомления — и вы не пропустите старт.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="label-caps gap-2" onClick={() => setView("schedule")}>
              <Calendar className="size-4" />
              Расписание
            </Button>
            <Button variant="secondary" className="label-caps gap-2" onClick={() => setView("recordings")}>
              <Video className="size-4" />
              Записи эфиров
            </Button>
          </div>
        </section>
      )}

      {/* Полоса «что на канале» — карточка-визитка dypaGPT */}
      {main && !hero && (
        <Section icon={SparklesIcon} title="Канал платформы">
          <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {channels.map((c) => (
              <LiveChannelCard key={c.slug} channel={c} />
            ))}
          </div>
        </Section>
      )}

      {/* Клипы — витрина-заглушка */}
      <Section
        icon={Clapperboard}
        title="Популярные клипы"
        action={{ label: "ВСЕ КЛИПЫ", onClick: () => setView("clips") }}
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {clips === null
            ? [0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))
            : clips
                .slice(0, 4)
                .map((clip) => <ClipCard key={clip.id} clip={clip} channel={bySlug(clip.channelSlug)} />)}
        </div>
      </Section>

      {/* Записи — витрина-заглушка */}
      <Section
        icon={Video}
        title="Записи эфиров"
        action={{ label: "ВСЕ ЗАПИСИ", onClick: () => setView("recordings") }}
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {recordings === null
            ? [0, 1, 2].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))
            : recordings
                .slice(0, 4)
                .map((rec) => <RecordingCard key={rec.id} recording={rec} channel={bySlug(rec.channelSlug)} />)}
        </div>
      </Section>

      {/* Расписание — витрина-заглушка */}
      <Section
        icon={Calendar}
        title="Ближайшие эфиры"
        action={{ label: "ВСЁ РАСПИСАНИЕ", onClick: () => setView("schedule") }}
      >
        <div className="space-y-2.5">
          {schedule === null
            ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)
            : schedule
                .slice(0, 3)
                .map((entry) => <ScheduleRow key={entry.id} entry={entry} channel={bySlug(entry.channelSlug)} />)}
        </div>
      </Section>

      {/* Футер-подпись главной */}
      <footer className="border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground/60">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Gamepad2 className="size-4" aria-hidden />
          <span className="label-caps text-[10px]">BACKSTAGE — приватные трансляции для платных подписчиков.</span>
          <button
            className="label-caps text-[10px] underline-offset-2 hover:text-primary hover:underline"
            onClick={() => channels[0] && openChannel(channels[0].slug)}
          >
            ПЕРЕЙТИ К ЭФИРУ
          </button>
        </div>
      </footer>
    </div>
  );
}
