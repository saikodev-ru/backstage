"use client";

// Коллаборации: совместные эфиры с гостями канала.

import { Sparkles, Users2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useBackstageStore } from "@/components/backstage/store";
import { useContent, formatWhen } from "@/components/backstage/hooks";
import type { CollabDto } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_META: Record<CollabDto["status"], { label: string; className: string }> = {
  confirmed: { label: "Подтверждено", className: "rounded-full bg-[#5ad1a4]/15 text-[#5ad1a4] hover:bg-[#5ad1a4]/15" },
  planning: { label: "В планировании", className: "rounded-full bg-primary/15 text-primary hover:bg-primary/15" },
  idea: { label: "Идея", className: "rounded-full bg-secondary text-muted-foreground hover:bg-secondary" },
};

export function CollabsView() {
  const channels = useBackstageStore((s) => s.channels);
  const collabs = useContent<CollabDto>("collabs");
  const bySlug = (slug: string) => channels.find((c) => c.slug === slug);

  return (
    <div className="space-y-6 px-3 py-4 sm:px-5 sm:py-6 lg:px-7">
      <header className="fade-up flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="headline text-xl sm:text-3xl">КОЛЛАБОРАЦИИ</h1>
        <p className="label-caps text-[11px] text-muted-foreground">СОВМЕСТНЫЕ ЭФИРЫ С ГОСТЯМИ</p>
      </header>

      {collabs === null ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-44 w-full rounded-2xl" />
          ))}
        </div>
      ) : collabs.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 py-16 text-center">
          <Users2 className="size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">Коллабораций пока нет</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {collabs.map((collab) => {
            const meta = STATUS_META[collab.status];
            const when = collab.plannedAt ? formatWhen(collab.plannedAt) : null;
            return (
              <article
                key={collab.id}
                className="fade-up rounded-2xl border border-white/5 bg-white/[.03] p-4 backdrop-blur-md transition-all duration-200 hover:border-primary/40 hover:bg-white/[.05] sm:p-5"
              >
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <h2 className="card-title text-base leading-snug sm:text-lg">{collab.title}</h2>
                    {collab.description && (
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        {collab.description}
                      </p>
                    )}
                  </div>
                  <Badge className={cn("label-caps shrink-0", meta.className)}>{meta.label}</Badge>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="flex -space-x-2.5">
                    {collab.members.map((m) => (
                      <span key={m.slug} className="relative" title={`${m.name} — ${m.role}`}>
                        <Avatar className="size-8 rounded-full ring-2 ring-[#111116]">
                          <AvatarImage src={m.avatarUrl ?? undefined} alt={m.name} />
                          <AvatarFallback
                            style={{
                              backgroundColor: `${bySlug(m.slug)?.accentColor ?? "#a970ff"}33`,
                              color: bySlug(m.slug)?.accentColor ?? "#a970ff",
                            }}
                            className="rounded-full text-xs font-semibold"
                          >
                            {m.name.slice(0, 1).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </span>
                    ))}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {collab.members.map((m) => `${m.name} (${m.role})`).join(" · ")}
                  </span>
                  {when && (
                    <span className="label-caps ml-auto text-[11px] text-primary">
                      {when.day} · {when.time}
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
