"use client";

// Левый icon-rail (десктоп, Twitch-стиль) + плавающий мобильный док (Apple-стиль).
// Список «КАНАЛЫ» удалён: платформа живёт вокруг одного канала dypaGPT.

import {
  Calendar,
  Clapperboard,
  Home,
  Radio,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useBackstageStore, type View } from "@/components/backstage/store";
import { toast } from "@/hooks/use-toast";

type NavItem = {
  id: View;
  label: string;
  short: string;
  icon: LucideIcon;
};

const NAV: NavItem[] = [
  { id: "live", label: "В ЭФИРЕ", short: "ЭФИР", icon: Radio },
  { id: "home", label: "ГЛАВНАЯ", short: "ГЛАВ.", icon: Home },
  { id: "clips", label: "КЛИПЫ", short: "КЛИПЫ", icon: Clapperboard },
  { id: "recordings", label: "ЗАПИСИ", short: "ЗАПИСИ", icon: Video },
  { id: "collabs", label: "КОЛЛАБОРАЦИИ", short: "ЛАБЫ", icon: Users },
  { id: "schedule", label: "РАСПИСАНИЕ", short: "АЙСОН", icon: Calendar },
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
        // офлайн: всё равно открываем экран канала (расписание + напоминание)
        const fallback = channels[0];
        if (fallback) openChannel(fallback.slug);
        else {
          setView("home");
          toast({
            title: "Эфира сейчас нет",
            description: "Загляните в расписание — ближайший эфир уже отмечен",
          });
        }
      }
      return;
    }
    setView(id);
  };

  return { go, liveCount, active: view };
}

export function LeftRail() {
  const { go, liveCount } = useNavActions();
  const view = useBackstageStore((s) => s.view);

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        aria-label="Основная навигация"
        className="sticky top-16 hidden h-[calc(100vh-4rem)] w-[76px] shrink-0 flex-col items-center gap-1 border-r border-white/5 bg-sidebar/60 py-3 backdrop-blur-xl lg:flex"
      >
        {NAV.map((item) => {
          const isActive = view === item.id;
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => go(item.id)}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={item.label}
                  className={cn(
                    "group relative grid size-14 w-full place-items-center rounded-2xl transition-all duration-200",
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  )}
                >
                  {/* индикатор активного пункта — лавандовая полоса слева */}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all duration-200",
                      isActive ? "opacity-100 glow-soft" : "h-0 opacity-0"
                    )}
                  />
                  <span className="relative">
                    <item.icon className={cn("size-6 transition-transform duration-200 group-hover:scale-110", isActive && "drop-shadow-[0_0_8px_rgba(169,112,255,0.6)]")} />
                    {item.id === "live" && liveCount > 0 && (
                      <span className="live-dot absolute -right-1 -top-1 size-2.5 rounded-full bg-live ring-2 ring-sidebar" aria-hidden />
                    )}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8} className="label-caps glass-strong rounded-lg px-3 py-1.5 text-[11px]">
                {item.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}

export function MobileNav() {
  const { go, liveCount } = useNavActions();
  const view = useBackstageStore((s) => s.view);

  return (
    <nav
      aria-label="Мобильная навигация"
      className="fixed inset-x-3 bottom-3 z-40 lg:hidden"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      <div className="glass-strong flex items-stretch justify-around rounded-3xl p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]">
        {NAV.map((item) => {
          const isActive = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => go(item.id)}
              aria-current={isActive ? "page" : undefined}
              className="relative flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 py-1.5 transition-colors"
            >
              <span className="relative">
                <item.icon
                  className={cn(
                    "size-5.5 transition-all duration-200",
                    isActive ? "scale-110 text-primary drop-shadow-[0_0_8px_rgba(169,112,255,0.55)]" : "text-muted-foreground"
                  )}
                />
                {item.id === "live" && liveCount > 0 && (
                  <span className="live-dot absolute -right-1.5 -top-0.5 size-2 rounded-full bg-live" aria-hidden />
                )}
              </span>
              <span
                className={cn(
                  "label-caps text-[8.5px] leading-none",
                  isActive ? "text-primary" : "text-muted-foreground/80"
                )}
              >
                {item.short}
              </span>
              {isActive && (
                <span aria-hidden className="absolute -top-1 h-1 w-1 rounded-full bg-primary glow-soft" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
