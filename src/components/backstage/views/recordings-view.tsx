"use client";

// Записи эфиров — витрина-заглушка.

import { Library, Video } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useBackstageStore } from "@/components/backstage/store";
import { useContent, formatDuration } from "@/components/backstage/hooks";
import { RecordingCard } from "@/components/backstage/cards";
import type { RecordingDto } from "@/lib/types";

export function RecordingsView() {
  const channels = useBackstageStore((s) => s.channels);
  const recordings = useContent<RecordingDto>("recordings");
  const bySlug = (slug: string) => channels.find((c) => c.slug === slug);
  const totalMinutes = recordings ? Math.round(recordings.reduce((s, r) => s + r.durationSec, 0) / 60) : 0;

  return (
    <div className="space-y-6 px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
      <header className="fade-up flex flex-wrap items-center gap-3">
        <Library className="size-6 text-primary" />
        <div>
          <h1 className="headline text-xl sm:text-2xl">Записи эфиров</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Полный архив для подписчиков
            {recordings ? ` · ${totalMinutes > 0 ? Math.round(totalMinutes / 60) : 0} ч эфиров` : ""}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {recordings === null
          ? [0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-video w-full rounded-lg" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))
          : recordings.map((r) => (
              <RecordingCard key={r.id} recording={r} channel={bySlug(r.channelSlug)} />
            ))}
      </div>

      {recordings !== null && recordings.length === 0 && (
        <div className="grid place-items-center rounded-xl border border-dashed border-border py-16 text-center">
          <Video className="size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">Архив пока пуст</p>
        </div>
      )}

      {recordings !== null && recordings.length > 0 && (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Доступ к записям будет закрыт тем же гейтом, что и эфиры: платные подписчики смотрят
          полностью, остальные — превью до {formatDuration(Math.round(recordings[0].durationSec / 12))}.
        </p>
      )}
    </div>
  );
}
