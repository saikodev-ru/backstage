"use client";

// Корневой клиентский компонент «Бэкстейдж»: провайдер стора + shell + view-роутинг.

import { useEffect } from "react";
import { BackstageProvider, useBackstageStore } from "@/components/backstage/store";
import { useChannels } from "@/components/backstage/hooks";
import { TopBar } from "@/components/backstage/top-bar";
import { LeftRail, MobileNav } from "@/components/backstage/left-rail";
import { HomeView } from "@/components/backstage/views/home-view";
import { LiveView } from "@/components/backstage/views/live-view";
import { ClipsView } from "@/components/backstage/views/clips-view";
import { RecordingsView } from "@/components/backstage/views/recordings-view";
import { ScheduleView } from "@/components/backstage/views/schedule-view";
import { CollabsView } from "@/components/backstage/views/collabs-view";
import { AuthDialog } from "@/components/backstage/auth-dialog";
import { AdminPanel } from "@/components/backstage/admin-panel";
import type { PublicChannel, PublicUser } from "@/lib/types";

function Shell() {
  const { view, activeChannel, openChannel, channels } = useBackstageStore();
  useChannels(); // polling каналов + конфиг авторизации

  // Hash-роутинг: #ch-<slug> (шаринг ссылки на канал)
  useEffect(() => {
    const applyHash = () => {
      const m = window.location.hash.match(/^#ch-([a-z0-9-]+)$/i);
      if (m) {
        const slug = m[1];
        if (channels.some((c) => c.slug === slug)) {
          openChannel(slug);
        }
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [channels, openChannel]);

  // Поддержка адресной строки при переключении каналов
  useEffect(() => {
    if (view === "live" && activeChannel) {
      const hash = `#ch-${activeChannel}`;
      if (window.location.hash !== hash) {
        window.history.replaceState(null, "", hash);
      }
    } else if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [view, activeChannel]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <TopBar />
      <div className="flex flex-1">
        <LeftRail />
        <main className="min-w-0 flex-1 pb-16 lg:pb-0" id="content">
          {view === "home" && <HomeView />}
          {view === "live" && <LiveView />}
          {view === "clips" && <ClipsView />}
          {view === "recordings" && <RecordingsView />}
          {view === "schedule" && <ScheduleView />}
          {view === "collabs" && <CollabsView />}
        </main>
      </div>
      <MobileNav />
      <AuthDialog />
      <AdminPanel />
    </div>
  );
}

export function BackstageApp({
  initialChannels,
  initialUser,
}: {
  initialChannels: PublicChannel[];
  initialUser: PublicUser | null;
}) {
  return (
    <BackstageProvider initialChannels={initialChannels} initialUser={initialUser}>
      <Shell />
    </BackstageProvider>
  );
}
