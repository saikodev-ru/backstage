"use client";

// Клипы — витрина в кино-стиле.

import { Clapperboard, Film } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useBackstageStore } from "@/components/backstage/store";
import { useContent, formatCount } from "@/components/backstage/hooks";
import { ClipCard } from "@/components/backstage/cards";
import type { ClipDto } from "@/lib/types";

export function ClipsView() {
  const channels = useBackstageStore((s) => s.channels);
  const clips = useContent<ClipDto>("clips");
  const bySlug = (slug: string) => channels.find((c) => c.slug === slug);
  const totalViews = clips?.reduce((sum, c) => sum + c.views, 0) ?? 0;

  return (
    <div className="space-y-6 px-3 py-4 sm:px-5 sm:py-6 lg:px-7">
      <header className="fade-up flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="headline text-xl sm:text-3xl">КЛИПЫ</h1>
        <p className="label-caps text-[11px] text-muted-foreground">
          ЛУЧШИЕ МОМЕНТЫ ЭФИРОВ
          {clips ? ` · ${formatCount(totalViews)} ПРОСМОТРОВ` : ""}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {clips === null
          ? [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="aspect-video w-full rounded-2xl" />)
          : clips.map((clip) => <ClipCard key={clip.id} clip={clip} channel={bySlug(clip.channelSlug)} />)}
      </div>

      {clips !== null && clips.length === 0 && (
        <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 py-16 text-center">
          <Film className="size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">Клипов пока нет</p>
        </div>
      )}
    </div>
  );
}
