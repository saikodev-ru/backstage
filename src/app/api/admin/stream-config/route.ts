// Конфигурация транскодирования (админ): варианты качества HLS-потока Owncast.
//
// GET  /api/admin/stream-config            — текущие варианты качества движка
// POST /api/admin/stream-config            — применить варианты
//      { action: "preset" }                      → лестница 1080p60/720p60/480p/360p
//      { action: "source" }                      → один вариант «источник»
//      { action: "variants", variants: [...] }   — ручной список

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { getSessionUser } from "@/lib/auth";
import { getOwncastState, getOwncastSummary } from "@/lib/owncast";
import {
  getOwncastVideoSettings,
  presetVariants,
  setOwncastVariants,
  type OwncastVariant,
} from "@/lib/owncast-admin";

export const dynamic = "force-dynamic";

const SOURCE_VARIANT: OwncastVariant = {
  name: "Источник",
  videoPassthrough: false,
  audioPassthrough: true,
  videoBitrate: 1200,
  audioBitrate: 0,
  scaledWidth: null,
  scaledHeight: null,
  cpuUsageLevel: 2,
  framerate: 24,
};

export async function GET() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden", message: "Только администратор" }, { status: 403 });
  }
  const [engine, video] = await Promise.all([getOwncastSummary(), getOwncastVideoSettings()]);
  return NextResponse.json({
    engine,
    videoSettings: video,
    isPreset: Boolean(
      video &&
        video.videoQualityVariants.length === presetVariants().length
    ),
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden", message: "Только администратор" }, { status: 403 });
  }

  let action = "";
  let variants: OwncastVariant[] | null = null;
  try {
    const body = (await req.json()) as { action?: string; variants?: OwncastVariant[] };
    action = body.action ?? "";
    if (Array.isArray(body.variants)) variants = body.variants;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const target =
    action === "preset" ? presetVariants() : action === "source" ? [SOURCE_VARIANT] : variants;
  if (!target || target.length === 0 || target.length > 6) {
    return NextResponse.json(
      { error: "bad_action", message: "action = preset | source | variants (1–6 вариантов)" },
      { status: 400 }
    );
  }

  const result = await setOwncastVariants(target);
  if (!result.ok) {
    return NextResponse.json({ error: "engine_error", message: result.message }, { status: 502 });
  }

  // Owncast применяет варианты транскодера при старте процесса: если эфир
  // не идёт — мягко перезапускаем движок (раннер поднимет его сам), чтобы
  // лестница вступила в силу сразу. При живом эфире не трогаем процесс.
  const state = await getOwncastState();
  let restarted = false;
  if (!state.online) {
    try {
      const killer = spawn("pkill", ["-9", "-f", "./owncast"], {
        detached: true,
        stdio: "ignore",
      });
      killer.unref();
      // ждём подъёма движка (раннер перезапускает через ~2с)
      for (let i = 0; i < 10 && !restarted; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        restarted = (await getOwncastVideoSettings()) !== null;
      }
    } catch {
      /* перезапуск не удался — конфиг всё равно сохранён */
    }
  }

  const video = await getOwncastVideoSettings();
  return NextResponse.json({
    ok: true,
    message: result.message,
    videoSettings: video,
    restarted,
    // true — эфир идёт, движок не перезапускали: перезапустить при остановке
    needsEngineRestart: state.online && !restarted,
  });
}
