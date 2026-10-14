"use client";

// Главная «Бэкстейдж» — витрина в стиле Twitch: герой эфира, живые каналы,
// клипы, записи и расписание (заглушки-витрины для будущего контента).

import { Clapperboard, Radio, Sparkles, Video, Calendar, ArrowRight, Clapperboard as ClapperIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBackstageStore } from "@/components/backstage/store";
import { useContent } from "@/components/backstage/hooks";
import {
  ClipCard,
  LiveChannelCard,
  OfflineChannelCard,
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
      <header className="mb-3 flex items-center gap-2.5">
        <Icon className="size-5 text-primary" />
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {action && (
          <Button variant="ghost" size="sm" className="ml-auto gap-1 text-muted-foreground" onClick={action.onClick}>
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
  const offlineChannels = channels.filter((c) => !c.isLive);
  const hero = liveChannels[0];
  const bySlug = (slug: string) => channels.find((c) => c.slug === slug);

  return (
    <div className="space-y-8 px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
      {/* Герой: текущий эфир */}
      {hero ? (
        <section aria-label="Сейчас в эфире" className="fade-up">
          <header className="mb-3 flex items-center gap-2.5">
            <Radio className="size-5 text-live" />
            <h2 className="text-lg font-bold tracking-tight">Сейчас в эфире</h2>
            <span className="rounded-full bg-live/15 px-2 py-0.5 text-xs font-semibold text-[#ff6b6b]">
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
            <h2 className="text-lg font-bold">Сейчас все авторы отдыхают</h2>
          </div>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
            Эфиров нет, но витрина уже живёт: каналы, расписание и архив на месте.
            Подпишитесь на уведомления, чтобы не пропустить старт.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setView("schedule")}>
              <Calendar className="size-4" />
              Смотреть расписание
            </Button>
            <Button variant="secondary" onClick={() => setView("recordings")}>
              <Video className="size-4" />
              Записи эфиров
            </Button>
          </div>
        </section>
      )}

      {/* Каналы платформы */}
      {offlineChannels.length > 0 && (
        <Section icon={Radio} title="Каналы Бэкстейджа">
          <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {offlineChannels.map((c) => (
              <OfflineChannelCard key={c.slug} channel={c} />
            ))}
          </div>
        </Section>
      )}

      {/* Клипы — витрина-заглушка */}
      <Section
        icon={Clapperboard}
        title="Популярные клипы"
        action={{ label: "Все клипы", onClick: () => setView("clips") }}
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
        action={{ label: "Все записи", onClick: () => setView("recordings") }}
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
        action={{ label: "Всё расписание", onClick: () => setView("schedule") }}
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
          <ClapperIcon className="size-4" aria-hidden />
          <span>Бэкстейдж — приватные трансляции для платных подписчиков.</span>
          <button className="underline-offset-2 hover:text-primary hover:underline" onClick={() => channels[0] && openChannel(channels[0].slug)}>
            Перейти к каналу
          </button>
        </div>
      </footer>
    </div>
  );
}
