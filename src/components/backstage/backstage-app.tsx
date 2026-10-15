"use client";

// Корневой клиентский компонент «Бэкстейдж» v2 «GLASS ARENA»:
// провайдер стора + shell + view-роутинг + live-тикер.

import { useEffect, useRef } from "react";
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
import { HostOnboarding, DEMO_ONBOARDING_EVENT } from "@/components/backstage/host-onboarding";
import { cn } from "@/lib/utils";
import type { PublicChannel, PublicUser } from "@/lib/types";

// Консольная команда демо-режима (объявляем тип)
declare global {
  interface Window {
    demo?: (arg?: string) => void;
  }
}

const DEMO_AUTH_KEY = "bs-demo-auth";

/**
 * Консольная команда demo() — переключатель демо-режима авторизации:
 * кнопки входа работают без Telegram, у зрителя появляются чекбоксы
 * «подписчик»/«модератор» (отладка гейтов). demo("onboarding") —
 * принудительно открыть окно создания канала ведущего.
 */
function useDemoModeBridge() {
  const setDemoAuth = useBackstageStore((s) => s.setDemoAuth);
  useEffect(() => {
    const read = () => {
      try {
        return window.localStorage.getItem(DEMO_AUTH_KEY) === "1";
      } catch {
        return false;
      }
    };
    setDemoAuth(read());
    window.demo = (arg?: string) => {
      if (arg === "onboarding") {
        window.dispatchEvent(new CustomEvent(DEMO_ONBOARDING_EVENT));
        console.log('[backstage] окно создания канала открыто (отладка, demo("onboarding"))');
        return;
      }
      const next = !read();
      try {
        window.localStorage.setItem(DEMO_AUTH_KEY, next ? "1" : "0");
      } catch {
        /* приватный режим браузера */
      }
      setDemoAuth(next);
      console.log(
        `[backstage] демо-режим авторизации: ${next ? "ВКЛЮЧЁН" : "ВЫКЛЮЧЕН"}. ` +
          "В диалоге входа " +
          (next ? "появились демо-кнопки и чекбоксы ролей" : "снова только Telegram") +
          '. Подсказка: demo("onboarding") — окно создания канала.'
      );
    };
    return () => {
      delete window.demo;
    };
  }, [setDemoAuth]);
}

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
  const { view, activeChannel, openChannel, openChannelPage, setView, channels } = useBackstageStore();
  useChannels(); // polling каналов + конфиг авторизации
  useDemoModeBridge(); // консольная команда demo()

  // Хеш-роутинг + история: #ch-<slug> (эфир), #chp-<slug> (страница канала).
  // Пользовательская навигация ПУШИТ записи (store-экшены) — жест «назад»/
  // кнопка назад возвращает к предыдущему экрану; popstate/hashchange
  // восстанавливают состояние БЕЗ новой записи (fromHistory).
  const firstNavRun = useRef(true);
  useEffect(() => {
    const applyHash = (raw: string) => {
      const mLive = raw.match(/^#ch-([a-z0-9-]+)$/i);
      const mPage = raw.match(/^#chp-([a-z0-9-]+)$/i);
      if (mLive && channels.some((c) => c.slug === mLive[1])) {
        openChannel(mLive[1], { fromHistory: true });
      } else if (mPage && channels.some((c) => c.slug === mPage[1])) {
        openChannelPage(mPage[1], { fromHistory: true });
      } else if (!raw) {
        setView("home", { fromHistory: true });
      }
    };

    // глубокая ссылка на старте — применяем один раз (пустой хеш НЕ
    // трогаем: стартовый экран выбирает стрим-фёрст-логика стора)
    if (firstNavRun.current) {
      firstNavRun.current = false;
      if (window.location.hash) applyHash(window.location.hash);
    }

    const onNav = () => applyHash(window.location.hash);
    window.addEventListener("popstate", onNav);
    window.addEventListener("hashchange", onNav);
    return () => {
      window.removeEventListener("popstate", onNav);
      window.removeEventListener("hashchange", onNav);
    };
  }, [channels, openChannel, openChannelPage, setView]);

  // Стартовая нормализация записи истории: закрепляем URL за стартовым
  // экраном (стрим-фёрст без хеша → #ch-<slug>), чтобы «назад» из других
  // разделов возвращался на эфир, а не покидал сайт
  const didNormalize = useRef(false);
  useEffect(() => {
    if (didNormalize.current) return;
    didNormalize.current = true;
    if (window.location.hash) return; // глубокая ссылка — уже корректна
    if (view === "live" && activeChannel) {
      window.history.replaceState({ ...window.history.state, bs: "live", slug: activeChannel }, "", `#ch-${activeChannel}`);
    } else if (view === "channel" && activeChannel) {
      window.history.replaceState({ ...window.history.state, bs: "channel", slug: activeChannel }, "", `#chp-${activeChannel}`);
    } else {
      window.history.replaceState({ ...window.history.state, bs: view }, "", window.location.pathname);
    }
  }, []);

  const liveChannel = channels.find((c) => c.isLive);
  const showTicker = Boolean(liveChannel && view !== "live");

  // NB: bg у обёртки НЕ ставим (он на body) — эмбиент-канвасы плеера
  // (absolute, -z-10 в isolate-контексте контейнера плеера) светятся вокруг
  // плеера и сквозь полупрозрачные панели; фон body задаёт «глубину» графита.
  return (
    <div className="flex min-h-screen flex-col text-foreground">
      <TopBar />
      {showTicker && liveChannel && <LiveTicker channel={liveChannel} />}
      <div className="flex flex-1">
        <LeftRail />
        {/* На экране эфира (мобайл) нижний док скрыт — отступ под него не нужен */}
        <main
          key={view}
          id="content"
          className={cn("view-in min-w-0 flex-1 lg:pb-0", view === "live" ? "pb-0" : "pb-[92px]")}
        >
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
      <HostOnboarding />
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
