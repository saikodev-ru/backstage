"use client";

// Глобальное состояние «Бэкстейдж» (zustand, SSR-паттерн с провайдером):
// навигация, пользователь, каналы.

import { createContext, useContext, useState, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { PublicChannel, PublicUser } from "@/lib/types";

export type View = "live" | "home" | "clips" | "recordings" | "collabs" | "schedule";

type AppState = {
  view: View;
  activeChannel: string | null;
  user: PublicUser | null;
  channels: PublicChannel[];
  authOpen: boolean;
  adminOpen: boolean;
  searchQuery: string;

  setView: (v: View) => void;
  openChannel: (slug: string) => void;
  setUser: (u: PublicUser | null) => void;
  setChannels: (c: PublicChannel[]) => void;
  patchChannel: (slug: string, patch: Partial<PublicChannel>) => void;
  setAuthOpen: (b: boolean) => void;
  setAdminOpen: (b: boolean) => void;
  setSearchQuery: (q: string) => void;
};

function createBackstageStore(initial: { channels: PublicChannel[]; user: PublicUser | null }) {
  return createStore<AppState>()((set) => ({
    view: "home",
    activeChannel: initial.channels.find((c) => c.isLive)?.slug ?? null,
    user: initial.user,
    channels: initial.channels,
    authOpen: false,
    adminOpen: false,
    searchQuery: "",

    setView: (view) => set({ view }),
    openChannel: (slug) => set({ view: "live", activeChannel: slug }),
    setUser: (user) => set({ user }),
    setChannels: (channels) => set({ channels }),
    patchChannel: (slug, patch) =>
      set((s) => ({ channels: s.channels.map((c) => (c.slug === slug ? { ...c, ...patch } : c)) })),
    setAuthOpen: (authOpen) => set({ authOpen }),
    setAdminOpen: (adminOpen) => set({ adminOpen }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),
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
