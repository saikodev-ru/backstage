// Адаптер движка Owncast для BACKSTAGE.
//
// Технический стенд (переработка): вместо «велосипеда» стриминг-движком
// платформы выступает Owncast — OBS пушит RTMP в Owncast, Owncast режет HLS,
// а Next.js берёт на себя витрину, авторизацию Telegram, гейт подписки и чат.
//
// Адаптер умеет работать с несколькими инстансами Owncast (один канал = один
// инстанс, поле Channel.owncastBaseUrl) — фундамент под мультиканал.

import type { PublicChannel } from "@/lib/types";

// Дефолтный инстанс Owncast (задаётся в .env). Канал без собственного
// owncastBaseUrl привязывается к нему.
export const OWNCast_BASE_URL = (process.env.OWNCAST_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");

// Публичный RTMP-адрес для OBS (то, что видит стример; в проде — домен сервера)
export const OWNCast_RTMP_URL = process.env.OWNCAST_RTMP_URL ?? "rtmp://127.0.0.1:1935/live";

// Стрим-ключ инстанса Owncast (задаётся флагом -streamkey в mini-services/owncast/run.ts)
export const OWNCast_STREAM_KEY = process.env.OWNCAST_STREAM_KEY ?? "bs-dypaGPT";

// Путь HLS-прокси внутри Next.js (гейт подписки + один внешний порт)
export const HLS_PROXY_MASTER = "/api/stream/hls/stream.m3u8";

/** Живое состояние инстанса Owncast */
export type OwncastState = {
  reachable: boolean;
  online: boolean;
  viewerCount: number | null;
  streamTitle: string;
  lastConnectTime: string | null;
  lastDisconnectTime: string | null;
  version: string;
  fetchedAt: number;
};

const stateCache = new Map<string, { state: OwncastState; at: number }>();
const STATUS_TTL_MS = 5_000;

async function fetchJson<T>(url: string, timeoutMs = 2000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Состояние инстанса Owncast с 5-секундным кэшем в памяти.
 * unreachable-инстанс ≠ ошибка: платформа деградирует в ручной режим.
 */
export async function getOwncastState(baseUrl: string = OWNCast_BASE_URL): Promise<OwncastState> {
  const now = Date.now();
  const hit = stateCache.get(baseUrl);
  if (hit && now - hit.at < STATUS_TTL_MS) return hit.state;

  const raw = await fetchJson<{
    online?: boolean;
    viewerCount?: number;
    streamTitle?: string;
    lastConnectTime?: string | null;
    lastDisconnectTime?: string | null;
    versionNumber?: string;
  }>(`${baseUrl}/api/status`);

  const state: OwncastState = raw
    ? {
        reachable: true,
        online: Boolean(raw.online),
        viewerCount: typeof raw.viewerCount === "number" ? raw.viewerCount : null,
        streamTitle: raw.streamTitle ?? "",
        lastConnectTime: raw.lastConnectTime ?? null,
        lastDisconnectTime: raw.lastDisconnectTime ?? null,
        version: raw.versionNumber ?? "",
        fetchedAt: now,
      }
    : {
        reachable: false,
        online: false,
        viewerCount: null,
        streamTitle: "",
        lastConnectTime: null,
        lastDisconnectTime: null,
        version: "",
        fetchedAt: now,
      };

  stateCache.set(baseUrl, { state, at: now });
  return state;
}

/** База инстанса Owncast для конкретного канала (или дефолт) */
export function channelOwncastBase(channel: { owncastBaseUrl?: string | null }): string {
  return (channel.owncastBaseUrl ?? OWNCast_BASE_URL).replace(/\/+$/, "");
}

/**
 * Мерж канала с состоянием его инстанса Owncast.
 * Если инстанс доступен — эфир, зрители, старт и HLS-адрес берутся из движка
 * (ручные значения из БД игнорируются). Если недоступен — канал остаётся
 * в ручном режиме (старое поведение витрины).
 */
export async function mergeChannelWithOwncast(channel: PublicChannel): Promise<PublicChannel> {
  const base = channelOwncastBase(channel);
  const state = await getOwncastState(base);
  if (!state.reachable) return channel; // движок недоступен → ручной режим БД

  const merged: PublicChannel = {
    ...channel,
    isLive: state.online,
    // HLS идёт через наш прокси; для канала с личным инстансом — с ?ch=slug
    hlsUrl: channel.owncastBaseUrl ? `${HLS_PROXY_MASTER}?ch=${channel.slug}` : HLS_PROXY_MASTER,
    // зрители = максимум из движка (HLS-сессии) и счётчика чат-присутствия:
    // с включённым демо-чатом чат-сервис репортит «скачущий» онлайн в БД —
    // он важнее голого числа HLS-сессий (плеер + оверлеи + демо)
    viewers: Math.max(state.viewerCount ?? 0, channel.viewers),
    liveStartedAt: state.online ? state.lastConnectTime : null,
    liveTitle: channel.liveTitle || state.streamTitle || null,
  };
  return merged;
}

/** Мерж списка каналов (запросы к разным инстансам дедуплицируются кэшем) */
export async function mergeChannelsWithOwncast(channels: PublicChannel[]): Promise<PublicChannel[]> {
  return Promise.all(channels.map((c) => mergeChannelWithOwncast(c)));
}

/** Публичная сводка движка для витрины/админки (без стрим-ключа) */
export async function getOwncastSummary(): Promise<{
  engine: "owncast";
  reachable: boolean;
  online: boolean;
  version: string;
  baseUrl: string;
}> {
  const state = await getOwncastState();
  return {
    engine: "owncast",
    reachable: state.reachable,
    online: state.online,
    version: state.version,
    baseUrl: OWNCast_BASE_URL,
  };
}
