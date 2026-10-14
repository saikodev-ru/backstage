"use client";

// Записи эфиров — витрина в кино-стиле.

import { Video } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useBackstageStore } from "@/components/backstage/store";
import { useContent } from "@/components/backstage/hooks";
import { RecordingCard } from "@/components/backstage/cards";
import type { RecordingDto } from "@/lib/types";

export function RecordingsView() {
  const channels = useBackstageStore((s) => s.channels);
  const recordings = useContent<RecordingDto>("recordings");
  const bySlug = (slug: string) => channels.find((c) => c.slug === slug);
  const totalMinutes = recordings ? Math.round(recordings.reduce((s, r) => s + r.durationSec, 0) / 60) : 0;

  return (
    <div className="space-y-6 px-3 py-4 sm:px-5 sm:py-6 lg:px-7">
      <header className="fade-up flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="headline text-xl sm:text-3xl">ЗАПИСИ ЭФИРОВ</h1>
        <p className="label-caps text-[11px] text-muted-foreground">
          ПОЛНЫЙ АРХИВ ДЛЯ ПОДПИСЧИКОВ
          {recordings ? ` · ${totalMinutes > 0 ? Math.round(totalMinutes / 60) : 0} Ч ЭФИРОВ` : ""}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {recordings === null
          ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-video w-full rounded-2xl" />)
          : recordings.map((r) => (
              <RecordingCard key={r.id} recording={r} channel={bySlug(r.channelSlug)} />
            ))}
      </div>

      {recordings !== null && recordings.length === 0 && (
        <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 py-16 text-center">
          <Video className="size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">Архив пока пуст</p>
        </div>
      )}
    </div>
  );
}
