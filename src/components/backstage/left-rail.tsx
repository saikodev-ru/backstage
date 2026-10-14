"use client";

// Левый рейл (десктоп) + нижняя навигация (мобайл).

import {
  Calendar,
  Clapperboard,
  Home,
  Radio,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useBackstageStore, type View } from "@/components/backstage/store";
import { formatCount } from "@/components/backstage/hooks";
import { toast } from "@/hooks/use-toast";

type NavItem = {
  id: View;
  label: string;
  icon: LucideIcon;
};

const NAV: NavItem[] = [
  { id: "live", label: "В ЭФИРЕ", icon: Radio },
  { id: "home", label: "ГЛАВНАЯ", icon: Home },
  { id: "clips", label: "КЛИПЫ", icon: Clapperboard },
  { id: "recordings", label: "ЗАПИСИ", icon: Video },
  { id: "collabs", label: "КОЛЛАБОРАЦИИ", icon: Users },
  { id: "schedule", label: "РАСПИСАНИЕ", icon: Calendar },
];

function useNavActions() {
  const { channels, view, openChannel, setView } = useBackstageStore();
  const liveChannels = channels.filter((c) => c.isLive);
  const liveCount = liveChannels.length;

  const go = (id: View) => {
    if (id === "live") {
      if (liveChannels.length > 0) {
        openChannel(liveChannels[0].slug);
      } else {
        setView("home");
        toast({
          title: "Сейчас все каналы офлайн",
          description: "Загляните в расписание — ближайший эфир уже отмечен",
        });
      }
      return;
    }
    setView(id);
  };

  return { go, liveCount, active: view };
}

export function LeftRail() {
  const { channels, view, activeChannel, openChannel } = useBackstageStore();
  const { go, liveCount } = useNavActions();

  return (
    <nav
      aria-label="Основная навигация"
      className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar lg:flex"
    >
      <div className="p-2">
        {NAV.map((item) => {
          const isActive = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "label-caps group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[13px] transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <item.icon className={cn("size-5", isActive && "text-primary")} />
              <span className="flex-1 text-left">{item.label}</span>
              {item.id === "live" && liveCount > 0 && (
                <span className="flex items-center gap-1.5 rounded-sm bg-live px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
                  <span className="size-1.5 rounded-full bg-white live-dot" aria-hidden />
                  LIVE
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="label-caps mt-2 px-4 pb-1 pt-3 text-[11px] text-muted-foreground/70">
        КАНАЛЫ
      </div>
      <div className="p-2 pt-0">
        {channels.map((c) => {
          const isActive = view === "live" && activeChannel === c.slug;
          return (
            <button
              key={c.slug}
              onClick={() => openChannel(c.slug)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors",
                isActive ? "bg-secondary" : "hover:bg-secondary/70"
              )}
            >
              <span className="relative shrink-0">
                <Avatar className="size-8 rounded-full ring-1 ring-border">
                  <AvatarImage src={c.avatarUrl ?? undefined} alt={c.name} />
                  <AvatarFallback
                    style={{ backgroundColor: `${c.accentColor}26`, color: c.accentColor }}
                    className="rounded-full text-xs font-semibold"
                  >
                    {c.name.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {c.isLive && (
                  <span
                    className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-sidebar bg-live live-dot"
                    aria-label="В эфире"
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.name}</span>
                {c.isLive ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-live" aria-hidden />
                    {formatCount(c.viewers)} смотрят
                  </span>
                ) : (
                  <span className="block truncate text-xs text-muted-foreground/60">Оффлайн</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="label-caps mt-auto p-4 text-[10px] leading-relaxed text-muted-foreground/50">
        BACKSTAGE v0.2 · ПРИВАТНЫЕ ТРАНСЛЯЦИИ
      </div>
    </nav>
  );
}

export function MobileNav() {
  const { go, liveCount } = useNavActions();
  const view = useBackstageStore((s) => s.view);

  return (
    <nav
      aria-label="Мобильная навигация"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-[#0d0d11]/95 backdrop-blur-md lg:hidden"
    >
      <div
        className="grid grid-cols-6 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5"
        style={{ WebkitTapHighlightColor: "transparent" }}
      >
        {NAV.map((item) => {
          const isActive = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              aria-current={isActive ? "page" : undefined}
              className="relative flex min-h-[44px] flex-col items-center gap-0.5 px-1 py-1"
            >
              <span className="relative">
                <item.icon className={cn("size-5", isActive ? "text-primary" : "text-muted-foreground")} />
                {item.id === "live" && liveCount > 0 && (
                  <span className="absolute -right-1.5 -top-0.5 size-2 rounded-full bg-live live-dot" aria-hidden />
                )}
              </span>
              <span
                className={cn(
                  "label-caps text-[9px]",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                {item.label === "В ЭФИРЕ" ? "ЭФИР" : item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
