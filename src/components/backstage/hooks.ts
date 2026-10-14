"use client";

// Центральный hook «Бэкстейдж»: каналы (polling), авторизация, контент.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { useBackstageStore } from "@/components/backstage/store";
import type {
  AuthConfigDto,
  ClipDto,
  CollabDto,
  PublicUser,
  RecordingDto,
  ScheduleDto,
} from "@/lib/types";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) {
    throw Object.assign(new Error(data.message ?? data.error ?? `HTTP ${res.status}`), { payload: data });
  }
  return data as T;
}

/** Каналы + конфиг авторизации: первичная загрузка и обновление раз в 20с */
export function useChannels() {
  const setChannels = useBackstageStore((s) => s.setChannels);
  const [authConfig, setAuthConfig] = useState<AuthConfigDto | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ch, me] = await Promise.all([
        jsonFetch<{ channels: import("@/lib/types").PublicChannel[] }>("/api/channels"),
        jsonFetch<{
          user: PublicUser | null;
          config: AuthConfigDto;
        }>("/api/auth/me"),
      ]);
      setChannels(ch.channels);
      setAuthConfig(me.config);
    } catch {
      // тишина: фоновый polling
    }
  }, [setChannels]);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), 10_000); // статус Owncast обновляется шустро
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return { refresh, authConfig };
}

/** Действия авторизации: Telegram widget / demo / logout / проверка подписки */
export function useAuthActions() {
  const setUser = useBackstageStore((s) => s.setUser);
  const setAuthOpen = useBackstageStore((s) => s.setAuthOpen);

  const loginTelegram = useCallback(
    async (widgetData: Record<string, string | number>) => {
      try {
        const data = await jsonFetch<{ user: PublicUser }>("/api/auth/telegram", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(widgetData),
        });
        setUser(data.user);
        setAuthOpen(false);
        toast({ title: "Вы вошли в Бэкстейдж", description: `Привет, ${data.user.firstName}!` });
        return data.user;
      } catch (e) {
        toast({ title: "Не удалось войти", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
        return null;
      }
    },
    [setUser, setAuthOpen]
  );

  const loginDemo = useCallback(
    async (name: string, subscriber: boolean, admin: boolean, mod = false) => {
      try {
        const data = await jsonFetch<{ user: PublicUser }>("/api/auth/demo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, subscriber, admin, mod }),
        });
        setUser(data.user);
        setAuthOpen(false);
        toast({
          title: "Демо-вход выполнен",
          description: data.user.isSubscriber ? "Статус: платный подписчик" : "Статус: бесплатный зритель",
        });
        return data.user;
      } catch (e) {
        toast({ title: "Ошибка демо-входа", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
        return null;
      }
    },
    [setUser, setAuthOpen]
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    toast({ title: "Вы вышли из аккаунта" });
  }, [setUser]);

  const verifySubscription = useCallback(async () => {
    try {
      const data = await jsonFetch<{ user?: PublicUser; isSubscriber: boolean; checked: boolean; message?: string }>(
        "/api/auth/verify-subscription",
        { method: "POST" }
      );
      if (data.user) setUser(data.user);
      if (data.checked) {
        if (data.isSubscriber) {
          toast({ title: "Подписка активна", description: "Доступ к приватным эфирам открыт" });
        } else {
          toast({
            title: "Подписка не найдена",
            description: "Оформите подписку на приватный канал и попробуйте снова",
            variant: "destructive",
          });
        }
      } else {
        toast({ title: "Проверка недоступна", description: data.message ?? "Бот не настроен" });
      }
    } catch (e) {
      toast({ title: "Ошибка проверки", description: e instanceof Error ? e.message : "Ошибка", variant: "destructive" });
    }
  }, [setUser]);

  return { loginTelegram, loginDemo, logout, verifySubscription };
}

/** Контент секций: клипы / записи / расписание / коллаборации */
export function useContent<T>(type: "clips" | "recordings" | "schedule" | "collabs") {
  const [items, setItems] = useState<T[] | null>(null);

  useEffect(() => {
    let alive = true;
    void jsonFetch<Record<string, T[]>>(`/api/content?type=${type}`)
      .then((data) => {
        if (!alive) return;
        const key = type === "clips" ? "clips" : type === "recordings" ? "recordings" : type === "schedule" ? "schedule" : "collabs";
        setItems((data as Record<string, T[]>)[key] ?? []);
      })
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [type]);

  return items;
}

/** Утилиты форматирования */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".0", "")} млн`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(".0", "")} тыс.`;
  return String(n);
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatUptime(startedAt: string | null): string {
  if (!startedAt) return "";
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function formatWhen(iso: string): { day: string; time: string; relative: string } {
  const d = new Date(iso);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
  const day =
    diffDays === 0
      ? "Сегодня"
      : diffDays === 1
        ? "Завтра"
        : `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const diffMs = new Date(iso).getTime() - Date.now();
  const relative =
    diffMs > 0
      ? diffMs > 86400000
        ? `через ${Math.floor(diffMs / 86400000)} дн.`
        : diffMs > 3600000
          ? `через ${Math.floor(diffMs / 3600000)} ч`
          : `через ${Math.max(1, Math.floor(diffMs / 60000))} мин`
      : "идёт сейчас";
  return { day, time, relative };
}

/** Сброс скролла к низу для списков (чат) */
export function useAutoScroll<T>(dep: T, tolerance = 120) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < tolerance;
      pinned.current = nearBottom;
      if (nearBottom) setPending(0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      if (pinned.current) {
        el.scrollTop = el.scrollHeight;
        setPending(0);
      } else {
        setPending((p) => p + 1);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [dep]);

  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    pinned.current = true;
    setPending(0);
  }, []);

  return { ref, pending, scrollToBottom };
}
