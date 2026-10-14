"use client";

// Коллаборации: совместные эфиры нескольких авторов Бэкстейджа.

import { GitBranch, Sparkles, Users2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useBackstageStore } from "@/components/backstage/store";
import { useContent, formatWhen } from "@/components/backstage/hooks";
import type { CollabDto } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_META: Record<CollabDto["status"], { label: string; className: string }> = {
  confirmed: { label: "Подтверждено", className: "bg-[#5ad1a4]/15 text-[#5ad1a4] hover:bg-[#5ad1a4]/15" },
  planning: { label: "В планировании", className: "bg-primary/15 text-primary hover:bg-primary/15" },
  idea: { label: "Идея", className: "bg-secondary text-muted-foreground hover:bg-secondary" },
};

export function CollabsView() {
  const channels = useBackstageStore((s) => s.channels);
  const collabs = useContent<CollabDto>("collabs");
  const bySlug = (slug: string) => channels.find((c) => c.slug === slug);

  return (
    <div className="space-y-6 px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
      <header className="fade-up flex flex-wrap items-center gap-3">
        <Users2 className="size-6 text-primary" />
        <div>
          <h1 className="headline text-xl sm:text-2xl">Коллаборации</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Совместные эфиры с гостями канала
          </p>
        </div>
        <div className="label-caps ml-auto hidden items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-[11px] text-accent-foreground sm:flex">
          <GitBranch className="size-3.5 text-primary" />
          Несколько авторов — один эфир
        </div>
      </header>

      {collabs === null ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : collabs.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-border py-16 text-center">
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
                className="fade-up rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/35 sm:p-5"
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
                  <Badge className={cn("shrink-0", meta.className)}>{meta.label}</Badge>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="flex -space-x-2.5">
                    {collab.members.map((m) => (
                      <span key={m.slug} className="relative" title={`${m.name} — ${m.role}`}>
                        <Avatar className="size-8 rounded-full ring-2 ring-card">
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
                    <span className="ml-auto text-xs font-medium text-primary">
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
