"use client";

// Корневой клиентский компонент «Бэкстейдж» v2 «GLASS ARENA»:
// провайдер стора + shell + view-роутинг + live-тикер.

import { useEffect } from "react";
import { BackstageProvider, useBackstageStore } from "@/components/backstage/store";
import { useChannels, formatCount } from "@/components/backstage/hooks";
import { TopBar } from "@/components/backstage/top-bar";
import { LeftRail, MobileNav } from "@/components/backstage/left-rail";
import { HomeView } from "@/components/backstage/views/home-view";
import { LiveView } from "@/components/backstage/views/live-view";
import { ClipsView } from "@/components/backstage/views/clips-view";
import { RecordingsView } from "@/components/backstage/views/recordings-view";
import { ScheduleView } from "@/components/backstage/views/schedule-view";
import { CollabsView } from "@/components/backstage/views/collabs-view";
import { SettingsView } from "@/components/backstage/views/settings-view";
import { ChannelView } from "@/components/backstage/views/channel-view";
import { AuthDialog } from "@/components/backstage/auth-dialog";
import { AdminPanel } from "@/components/backstage/admin-panel";
import type { PublicChannel, PublicUser } from "@/lib/types";

/** Бегущая строка: эфир идёт, а пользователь смотрит другой раздел */
function LiveTicker({ channel }: { channel: PublicChannel }) {
  const openChannel = useBackstageStore((s) => s.openChannel);
  const segment = [
    `В ЭФИРЕ — ${channel.liveTitle ?? channel.name}`,
    channel.liveCategory,
    `${formatCount(Math.max(channel.viewers, 1))} ЗРИТЕЛЕЙ`,
    channel.name,
  ]
    .filter(Boolean)
    .join("   ·   ");

  return (
    <button
      onClick={() => openChannel(channel.slug)}
      aria-label="Перейти к живому эфиру"
      className="ticker relative flex h-9 w-full shrink-0 items-center overflow-hidden border-b border-white/5 bg-primary/10 text-left"
    >
      <span className="live-breathe label-caps z-10 ml-3 flex shrink-0 items-center gap-1.5 rounded-full bg-live px-2.5 py-0.5 text-[10px] text-white">
        <span className="size-1.5 rounded-full bg-white live-dot" aria-hidden />
        LIVE
      </span>
      <span className="relative flex min-w-0 flex-1 overflow-hidden pl-4" aria-hidden>
        <span className="ticker-track">
          {[0, 1].map((half) => (
            <span key={half} className="flex shrink-0 items-center">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="label-caps flex items-center whitespace-nowrap px-5 text-[11px] text-accent-foreground"
                >
                  {segment}
                  <span className="ml-5 size-1.5 rounded-full bg-primary/70" aria-hidden />
                </span>
              ))}
            </span>
          ))}
        </span>
      </span>
      <span className="label-caps z-10 mr-3 hidden shrink-0 items-center gap-1 text-[11px] text-primary sm:flex">
        ПЕРЕЙТИ
        <span aria-hidden>→</span>
      </span>
    </button>
  );
}

function Shell() {
  const { view, activeChannel, openChannel, openChannelPage, channels } = useBackstageStore();
  useChannels(); // polling каналов + конфиг авторизации

  // Hash-роутинг: #ch-<slug> (эфир), #chp-<slug> (страница канала) — шаринг ссылок
  useEffect(() => {
    const applyHash = () => {
      const mLive = window.location.hash.match(/^#ch-([a-z0-9-]+)$/i);
      const mPage = window.location.hash.match(/^#chp-([a-z0-9-]+)$/i);
      if (mLive) {
        const slug = mLive[1];
        if (channels.some((c) => c.slug === slug)) openChannel(slug);
      } else if (mPage) {
        const slug = mPage[1];
        if (channels.some((c) => c.slug === slug)) openChannelPage(slug);
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [channels, openChannel, openChannelPage]);

  // Поддержка адресной строки при переключении каналов
  useEffect(() => {
    if (view === "live" && activeChannel) {
      const hash = `#ch-${activeChannel}`;
      if (window.location.hash !== hash) {
        window.history.replaceState(null, "", hash);
      }
    } else if (view === "channel" && activeChannel) {
      const hash = `#chp-${activeChannel}`;
      if (window.location.hash !== hash) {
        window.history.replaceState(null, "", hash);
      }
    } else if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [view, activeChannel]);

  const liveChannel = channels.find((c) => c.isLive);
  const showTicker = Boolean(liveChannel && view !== "live");

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <TopBar />
      {showTicker && liveChannel && <LiveTicker channel={liveChannel} />}
      <div className="flex flex-1">
        <LeftRail />
        <main className="view-in min-w-0 flex-1 pb-[92px] lg:pb-0" id="content" key={view}>
          {view === "home" && <HomeView />}
          {view === "live" && <LiveView />}
          {view === "clips" && <ClipsView />}
          {view === "recordings" && <RecordingsView />}
          {view === "schedule" && <ScheduleView />}
          {view === "collabs" && <CollabsView />}
          {view === "settings" && <SettingsView />}
          {view === "channel" && <ChannelView />}
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
