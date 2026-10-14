// Админ-API Owncast: конфигурация транскодирования (варианты качества).
//
// Owncast режет входящий RTMP в несколько HLS-вариантов. Настройки живут в
// движке и меняются через Admin API (Basic-auth по паролю из env):
//   GET  /api/admin/serverconfig                        → videoSettings
//   POST /api/admin/config/video/streamoutputvariants   → { value: [...] }
// Изменения применяются к следующему эфиру (RTMP-пуш).

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
