"use client";

// Расписание эфиров на неделю.

import { CalendarDays } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useBackstageStore } from "@/components/backstage/store";
import { useContent, formatWhen } from "@/components/backstage/hooks";
import { ScheduleRow } from "@/components/backstage/cards";
import type { ScheduleDto } from "@/lib/types";

export function ScheduleView() {
  const channels = useBackstageStore((s) => s.channels);
  const schedule = useContent<ScheduleDto>("schedule");
  const bySlug = (slug: string) => channels.find((c) => c.slug === slug);

  // группировка по дням
  const days = (schedule ?? []).reduce<Record<string, ScheduleDto[]>>((acc, entry) => {
    const key = formatWhen(entry.startsAt).day;
    (acc[key] ??= []).push(entry);
    return acc;
  }, {});

  return (
    <div className="space-y-6 px-3 py-4 sm:px-5 sm:py-6 lg:px-7">
      <header className="fade-up flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="headline text-xl sm:text-3xl">РАСПИСАНИЕ</h1>
        <p className="label-caps text-[11px] text-muted-foreground">НЕДЕЛЯ ЭФИРОВ dypaGPT</p>
      </header>

      {schedule === null ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : Object.entries(days).length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 py-16 text-center">
          <CalendarDays className="size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">Эфиры не запланированы</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(days).map(([day, entries]) => (
            <section key={day} aria-label={day} className="fade-up">
              <h2 className="label-caps mb-2.5 text-[12px] text-primary/90">{day}</h2>
              <div className="space-y-2.5">
                {entries.map((entry) => (
                  <ScheduleRow key={entry.id} entry={entry} channel={bySlug(entry.channelSlug)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
