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
  getOwncastIngest,
  getOwncastVideoSettings,
  presetVariants,
  setOwncastLatencyLevel,
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
  const [engine, video, ingest] = await Promise.all([
    getOwncastSummary(),
    getOwncastVideoSettings(),
    getOwncastIngest(),
  ]);
  return NextResponse.json({
    engine,
    videoSettings: video,
    // живой вход (реальное разрешение/fps/bitrate от OBS) — null вне эфира
    ingest,
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
  let latencyValue = NaN;
  try {
    const body = (await req.json()) as { action?: string; variants?: OwncastVariant[]; value?: unknown };
    action = body.action ?? "";
    if (Array.isArray(body.variants)) variants = body.variants;
    if (body.value !== undefined) latencyValue = Number(body.value);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  // ── Режим задержки эфира: latencyLevel 0–4, применяется к следующему эфиру ──
  if (action === "latency") {
    if (!Number.isInteger(latencyValue) || latencyValue < 0 || latencyValue > 4) {
      return NextResponse.json(
        { error: "bad_value", message: "value = целое 0–4 (0 — минимальная задержка)" },
        { status: 400 }
      );
    }
    const result = await setOwncastLatencyLevel(latencyValue);
    if (!result.ok) {
      return NextResponse.json({ error: "engine_error", message: result.message }, { status: 502 });
    }
    // Owncast применяет уровень к следующей трансляции; если эфир не идёт —
    // мягко перезапускаем движок (раннер поднимет его сам), чтобы режим
    // гарантированно вступил в силу. При живом эфире процесс не трогаем.
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
      // true — эфир идёт: уровень подхватится при следующем подключении OBS
      needsEngineRestart: state.online && !restarted,
    });
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
