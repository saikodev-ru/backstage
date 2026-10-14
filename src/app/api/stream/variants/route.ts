// Публичная лестница качества транскодирования (для подписей в плеере).
//
// Owncast не публикует FRAME-RATE в HLS-манифесте, поэтому fps берём из
// конфигурации движка (server-side, с админ-паролем) и отдаём витрине
// безопасную выжимку: только высота кадра и частота. Кэш 30с.

import { NextResponse } from "next/server";
import { getOwncastVideoSettings } from "@/lib/owncast-admin";

export const dynamic = "force-dynamic";

type VariantInfo = { height: number | null; framerate: number };

let cache: { at: number; data: VariantInfo[] } | null = null;
const TTL_MS = 30_000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ variants: cache.data });
  }
  const settings = await getOwncastVideoSettings();
  const variants: VariantInfo[] = (settings?.videoQualityVariants ?? []).map((v) => ({
    height: v.scaledHeight ?? null, // null = «источник» (ингест без даунскейла)
    framerate: v.framerate ?? 0,
  }));
  cache = { at: Date.now(), data: variants };
  return NextResponse.json({ variants });
}
