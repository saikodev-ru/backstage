"use client";

// Клипы — витрина-заглушка (контент появится с подключением медиа-хранилища).

import { Clapperboard, Film, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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
    <div className="space-y-6 px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
      <header className="fade-up flex flex-wrap items-center gap-3">
        <Clapperboard className="size-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Клипы</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Лучшие моменты эфиров Бэкстейджа
            {clips ? ` · ${formatCount(totalViews)} просмотров` : ""}
          </p>
        </div>
        <div className="ml-auto hidden items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs text-accent-foreground sm:flex">
          <Sparkles className="size-3.5 text-primary" />
          Витрина-заглушка: плеер клипов подключается к медиа-хранилищу
        </div>
      </header>

      <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {clips === null
          ? [0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-video w-full rounded-lg" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))
          : clips.map((clip) => <ClipCard key={clip.id} clip={clip} channel={bySlug(clip.channelSlug)} />)}
      </div>

      {clips !== null && clips.length === 0 && (
        <div className="grid place-items-center rounded-xl border border-dashed border-border py-16 text-center">
          <Film className="size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">Клипов пока нет</p>
        </div>
      )}

      {clips !== null && clips.length > 0 && (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Момент для клипа теперь фиксируется на лету: после интеграции объектного хранилища
          карточки станут играбельными, а ссылки — шерингом в Telegram.
          <Button
            variant="link"
            className="ml-1 h-auto p-0 text-xs text-primary"
            onClick={() => window.open("https://github.com/saikodev-ru/backstage", "_blank")}
          >
            roadmap в репозитории
          </Button>
        </p>
      )}
    </div>
  );
}
