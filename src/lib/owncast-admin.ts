// Админ-API Owncast: конфигурация транскодирования (варианты качества)
// и стрим-ключи инжеста.
//
// Owncast режет входящий RTMP в несколько HLS-вариантов. Настройки живут в
// движке и меняются через Admin API (Basic-auth по паролю из env):
//   GET  /api/admin/serverconfig                        → videoSettings + streamKeys
//   POST /api/admin/config/video/streamoutputvariants   → { value: [...] }
//   POST /api/admin/config/video/streamlatencylevel     → { value: 0..4 } (задержка)
//   GET  /api/admin/status                              → broadcaster.streamDetails (живой ингест)
//   POST /api/admin/config/streamkeys                   → { value: [{comment,key}] }
// Изменения применяются к следующему эфиру (RTMP-пуш); смена стрим-ключа —
// к новым RTMP-подключениям (активный эфир не рвётся).
// NB: ключ задаётся БЕЗ флага -streamkey в run.ts, иначе флаг
// перекрывает список из конфига и регенерация не действует.

import { randomBytes } from "node:crypto";
import { OWNCast_BASE_URL } from "@/lib/owncast";

const ADMIN_PASSWORD = process.env.OWNCAST_ADMIN_PASSWORD ?? "backstage-admin-2024";

function adminHeaders(): HeadersInit {
  const basic = Buffer.from(`admin:${ADMIN_PASSWORD}`).toString("base64");
  return {
    authorization: `Basic ${basic}`,
    "content-type": "application/json",
    accept: "application/json",
  };
}

export type OwncastVariant = {
  name: string;
  videoPassthrough: boolean;
  audioPassthrough: boolean;
  videoBitrate: number;
  audioBitrate: number;
  scaledWidth: number | null;
  scaledHeight: number | null;
  cpuUsageLevel: number;
  framerate: number;
};

export type OwncastVideoSettings = {
  videoQualityVariants: OwncastVariant[];
  latencyLevel: number;
};

/** Пресет «Twitch-лестница»: источник + 720p60 + 480p + 360p */
export function presetVariants(): OwncastVariant[] {
  return [
    {
      name: "Источник 1080p60",
      videoPassthrough: false,
      audioPassthrough: false,
      videoBitrate: 6000,
      audioBitrate: 128,
      scaledWidth: null,
      scaledHeight: null,
      cpuUsageLevel: 2,
      framerate: 60,
    },
    {
      name: "720p60",
      videoPassthrough: false,
      audioPassthrough: false,
      videoBitrate: 2800,
      audioBitrate: 128,
      scaledWidth: 1280,
      scaledHeight: 720,
      cpuUsageLevel: 2,
      framerate: 60,
    },
    {
      name: "480p",
      videoPassthrough: false,
      audioPassthrough: false,
      videoBitrate: 1100,
      audioBitrate: 128,
      scaledWidth: 854,
      scaledHeight: 480,
      cpuUsageLevel: 2,
      framerate: 30,
    },
    {
      name: "360p",
      videoPassthrough: false,
      audioPassthrough: false,
      videoBitrate: 550,
      audioBitrate: 96,
      scaledWidth: 640,
      scaledHeight: 360,
      cpuUsageLevel: 2,
      framerate: 30,
    },
  ];
}

export async function getOwncastVideoSettings(baseUrl: string = OWNCast_BASE_URL): Promise<OwncastVideoSettings | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(`${baseUrl}/api/admin/serverconfig`, {
      headers: adminHeaders(),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { videoSettings?: OwncastVideoSettings };
    return json.videoSettings ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Стрим-ключи инжеста (Owncast ≥ 0.3.0) ─────────────────────────────── */

export type OwncastStreamKeyEntry = { comment: string; key: string };

const streamKeysCache = new Map<string, { at: number; keys: OwncastStreamKeyEntry[] }>();
const STREAM_KEYS_TTL_MS = 15_000;

/** Список стрим-ключей движка (GET serverconfig, кэш 15с) */
export async function getOwncastStreamKeys(
  baseUrl: string = OWNCast_BASE_URL
): Promise<OwncastStreamKeyEntry[] | null> {
  const hit = streamKeysCache.get(baseUrl);
  if (hit && Date.now() - hit.at < STREAM_KEYS_TTL_MS) return hit.keys;
  try {
    const res = await fetch(`${baseUrl}/api/admin/serverconfig`, {
      headers: adminHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { streamKeys?: OwncastStreamKeyEntry[] };
    const keys = Array.isArray(json.streamKeys) ? json.streamKeys : [];
    streamKeysCache.set(baseUrl, { at: Date.now(), keys });
    return keys;
  } catch {
    return null;
  }
}

/** Записать список ключей в движок (действует для новых RTMP-сессий) */
export async function setOwncastStreamKeys(
  entries: OwncastStreamKeyEntry[],
  baseUrl: string = OWNCast_BASE_URL
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${baseUrl}/api/admin/config/streamkeys`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ value: entries }),
      signal: AbortSignal.timeout(4000),
    });
    const json = (await res.json().catch(() => ({}))) as { message?: string; success?: boolean };
    const ok = res.ok && json.success !== false;
    if (ok) streamKeysCache.set(baseUrl, { at: Date.now(), keys: entries });
    return { ok, message: json.message ?? (res.ok ? "готово" : `HTTP ${res.status}`) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "owncast недоступен" };
  }
}

/** Текущий ключ инжеста (первый из списка; null — движок недоступен) */
export async function getOwncastStreamKey(baseUrl: string = OWNCast_BASE_URL): Promise<string | null> {
  const keys = await getOwncastStreamKeys(baseUrl);
  return keys?.[0]?.key ?? null;
}

/** Регенерация ключа: новый случайный ключ применяется в движке сразу */
export async function regenerateOwncastStreamKey(
  baseUrl: string = OWNCast_BASE_URL
): Promise<{ ok: boolean; message: string; key: string | null }> {
  const key = `bs-${randomBytes(18).toString("hex")}`;
  const res = await setOwncastStreamKeys([{ comment: "backstage", key }], baseUrl);
  return { ok: res.ok, message: res.message, key: res.ok ? key : null };
}

export async function setOwncastVariants(
  variants: OwncastVariant[],
  baseUrl: string = OWNCast_BASE_URL
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${baseUrl}/api/admin/config/video/streamoutputvariants`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ value: variants }),
      signal: AbortSignal.timeout(4000),
    });
    const json = (await res.json().catch(() => ({}))) as { message?: string; success?: boolean };
    return { ok: res.ok && json.success !== false, message: json.message ?? (res.ok ? "готово" : `HTTP ${res.status}`) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "owncast недоступен" };
  }
}

/* ── Задержка эфира (latencyLevel 0–4) + живой ингест ─────────────────── */

/** Параметры входящего потока (чем OBS кормит движок прямо сейчас) */
export type OwncastIngest = {
  width: number | null;
  height: number | null;
  framerate: number | null;
  videoBitrate: number | null;
  videoCodec: string | null;
  encoder: string | null;
};

/**
 * Уровень задержки движка (0 — минимальная … 4 — максимальная надёжность).
 * Управляет длиной HLS-сегментов (1–5 с) и размером окна плейлиста;
 * применяется к СЛЕДУЮЩЕМУ эфиру — текущая трансляция не прерывается.
 */
export async function setOwncastLatencyLevel(
  level: number,
  baseUrl: string = OWNCast_BASE_URL
): Promise<{ ok: boolean; message: string }> {
  const value = Math.max(0, Math.min(4, Math.round(level)));
  try {
    const res = await fetch(`${baseUrl}/api/admin/config/video/streamlatencylevel`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ value }),
      signal: AbortSignal.timeout(4000),
    });
    const json = (await res.json().catch(() => ({}))) as { message?: string; success?: boolean };
    return {
      ok: res.ok && json.success !== false,
      message: json.message ?? (res.ok ? "готово" : `HTTP ${res.status}`),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "owncast недоступен" };
  }
}

/** Текущий входящий поток (null — эфир не идёт / движок недоступен) */
export async function getOwncastIngest(baseUrl: string = OWNCast_BASE_URL): Promise<OwncastIngest | null> {
  try {
    const res = await fetch(`${baseUrl}/api/admin/status`, {
      headers: adminHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      broadcaster?: { streamDetails?: Record<string, unknown> } | null;
    };
    const d = json.broadcaster?.streamDetails;
    if (!d) return null;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    return {
      width: num(d.width),
      height: num(d.height),
      framerate: num(d.framerate),
      videoBitrate: num(d.videoBitrate),
      videoCodec: str(d.videoCodec),
      encoder: str(d.encoder),
    };
  } catch {
    return null;
  }
}
