"use client";

// Глобальное состояние «Бэкстейдж» (zustand, SSR-паттерн с провайдером):
// навигация, пользователь, каналы.

import { createContext, useContext, useState, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { PublicChannel, PublicUser } from "@/lib/types";

export type View =
  | "live"
  | "home"
  | "clips"
  | "recordings"
  | "collabs"
  | "schedule"
  | "settings"
  | "channel";

type AppState = {
  view: View;
  activeChannel: string | null;
  user: PublicUser | null;
  channels: PublicChannel[];
  authOpen: boolean;
  adminOpen: boolean;
  /** Демо-режим авторизации (консольная команда demo()): кнопки входа работают без Telegram + чекбоксы ролей */
  demoAuth: boolean;

  /** Навигация с записью в историю браузера: жест «назад»/кнопка назад
      возвращает к предыдущему экрану (Twitch-мобайл). fromHistory —
      восстановление при popstate/hashchange (без новой записи). */
  setView: (v: View, opts?: { fromHistory?: boolean }) => void;
  openChannel: (slug: string, opts?: { fromHistory?: boolean }) => void;
  /** Страница канала (баннер/аватар/описание) — как в Twitch */
  openChannelPage: (slug: string, opts?: { fromHistory?: boolean }) => void;
  setUser: (u: PublicUser | null) => void;
  setChannels: (c: PublicChannel[]) => void;
  patchChannel: (slug: string, patch: Partial<PublicChannel>) => void;
  setAuthOpen: (b: boolean) => void;
  setAdminOpen: (b: boolean) => void;
  setDemoAuth: (b: boolean) => void;
};

/** URL экрана: эфир — #ch-<slug>, страница канала — #chp-<slug>, прочее — путь */
function urlForView(view: View, slug: string | null): string {
  if (view === "live" && slug) return `#ch-${slug}`;
  if (view === "channel" && slug) return `#chp-${slug}`;
  if (typeof window === "undefined") return "/";
  return window.location.pathname;
}

function createBackstageStore(initial: { channels: PublicChannel[]; user: PublicUser | null }) {
  // STREAM-FIRST: при открытии сайта с активным эфиром сразу показываем трансляцию
  const liveSlug = initial.channels.find((c) => c.isLive)?.slug ?? null;
  return createStore<AppState>()((set, get) => ({
    view: liveSlug ? "live" : "home",
    activeChannel: liveSlug ?? initial.channels[0]?.slug ?? null,
    user: initial.user,
    channels: initial.channels,
    authOpen: false,
    adminOpen: false,
    demoAuth: false,

    setView: (view, opts) => {
      set({ view });
      if (!opts?.fromHistory && typeof window !== "undefined") {
        const { activeChannel } = get();
        const url = urlForView(view, activeChannel);
        if (url !== window.location.hash || !url.startsWith("#")) {
          // ...history.state — сохраняем приватные поля Next Router,
          // иначе popstate в эту запись уйдёт в hard-reload
          window.history.pushState({ ...window.history.state, bs: view, slug: activeChannel }, "", url);
        }
      }
    },
    openChannel: (slug, opts) => {
      set({ view: "live", activeChannel: slug });
      if (!opts?.fromHistory && typeof window !== "undefined") {
        window.history.pushState({ ...window.history.state, bs: "live", slug }, "", `#ch-${slug}`);
      }
    },
    openChannelPage: (slug, opts) => {
      set({ view: "channel", activeChannel: slug });
      if (!opts?.fromHistory && typeof window !== "undefined") {
        window.history.pushState({ ...window.history.state, bs: "channel", slug }, "", `#chp-${slug}`);
      }
    },
    setUser: (user) => set({ user }),
    setChannels: (channels) => set({ channels }),
    patchChannel: (slug, patch) =>
      set((s) => ({ channels: s.channels.map((c) => (c.slug === slug ? { ...c, ...patch } : c)) })),
    setAuthOpen: (authOpen) => set({ authOpen }),
    setAdminOpen: (adminOpen) => set({ adminOpen }),
    setDemoAuth: (demoAuth) => set({ demoAuth }),
  }));
}

const BackstageStoreContext = createContext<StoreApi<AppState> | null>(null);

export function BackstageProvider({
  initialChannels,
  initialUser,
  children,
}: {
  initialChannels: PublicChannel[];
  initialUser: PublicUser | null;
  children: ReactNode;
}) {
  const [store] = useState(() => createBackstageStore({ channels: initialChannels, user: initialUser }));
  return <BackstageStoreContext.Provider value={store}>{children}</BackstageStoreContext.Provider>;
}

/** Хук доступа к стору (внутри BackstageProvider) */
export function useBackstageStore<S = AppState>(selector?: (state: AppState) => S): S {
  const api = useContext(BackstageStoreContext);
  if (!api) {
    // вызов вне провайдера (например, в тесте) — селектор по умолчанию не нужен
    throw new Error("useBackstageStore должен использоваться внутри <BackstageProvider>");
  }
  return useStore(api, (selector ?? ((s: AppState) => s)) as (state: AppState) => S);
}
