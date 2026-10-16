// Публичная лестница качества транскодирования (для подписей в плеере)
// и уровень задержки движка (для тюнинга hls.js).
//
// Owncast не публикует FRAME-RATE в HLS-манифесте, поэтому fps берём из
// конфигурации движка (server-side, с админ-паролем) и отдаём витрине
// безопасную выжимку: только высота кадра и частота. latencyLevel (0–4)
// нужен плееру ДО создания hls.js — от него зависит агрессивность
// live-конфига (liveSync/liveMaxLatency/maxBufferLength). Кэш 30с.

import { NextResponse } from "next/server";
import { getOwncastVideoSettings } from "@/lib/owncast-admin";

export const dynamic = "force-dynamic";

type VariantInfo = { height: number | null; framerate: number };

let cache: { at: number; variants: VariantInfo[]; latencyLevel: number } | null = null;
const TTL_MS = 30_000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ variants: cache.variants, latencyLevel: cache.latencyLevel });
  }
  const settings = await getOwncastVideoSettings();
  const variants: VariantInfo[] = (settings?.videoQualityVariants ?? []).map((v) => ({
    height: v.scaledHeight ?? null, // null = «источник» (ингест без даунскейла)
    framerate: v.framerate ?? 0,
  }));
  const latencyLevel =
    typeof settings?.latencyLevel === "number" ? Math.max(0, Math.min(4, Math.round(settings.latencyLevel))) : 2;
  cache = { at: Date.now(), variants, latencyLevel };
  return NextResponse.json({ variants, latencyLevel });
}
