// Пульт демо-эфира (админ): ffmpeg пушит тестовый RTMP-поток в Owncast —
// ровно то же звено, что OBS стримера. Полный конвейер проверяется вживую:
// OBS/ffmpeg → RTMP → Owncast → HLS → /api/stream/hls → плеер GLASS ARENA.
//
// GET  /api/admin/demo-stream — статус + данные движка (RTMP-адрес, ключ)
// POST /api/admin/demo-stream { action: "start" | "stop" } — вкл/выкл демо-эфир

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { getSessionUser } from "@/lib/auth";
import {
  OWNCast_BASE_URL,
  OWNCast_RTMP_URL,
  OWNCast_STREAM_KEY,
  getOwncastSummary,
} from "@/lib/owncast";
import { getOwncastStreamKey } from "@/lib/owncast-admin";
import { announceToChat } from "@/lib/telegram";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const PID_FILE = "/tmp/bs-demo-ffmpeg.pid";
const RTMP_HOST = (() => {
  try {
    return new URL(OWNCast_BASE_URL).hostname;
  } catch {
    return "127.0.0.1";
  }
})();

/** Цель демо-пуша: текущий ключ движка (может быть отрегенерирован из UI) */
async function rtmpTarget(): Promise<string> {
  const key = (await getOwncastStreamKey()) ?? OWNCast_STREAM_KEY;
  return `rtmp://${RTMP_HOST}:1935/live/${key}`;
}

/** Жив ли процесс демо-эфира (pid-файл переживает hot-reload) */
function demoRunning(): number | null {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
    if (!Number.isFinite(pid) || pid <= 0) return null;
    process.kill(pid, 0); // бросает, если процесса нет
    return pid;
  } catch {
    return null;
  }
}

function clearPid(): void {
  try {
    fs.rmSync(PID_FILE, { force: true });
  } catch {
    /* noop */
  }
}

async function startDemo(): Promise<{ ok: boolean; message: string }> {
  if (demoRunning()) return { ok: true, message: "уже работает" };

  const target = await rtmpTarget();

  // 1080p60 — источник для лестницы транскодирования
  const child = spawn(
    "ffmpeg",
    [
      "-loglevel", "error",
      "-re",
      "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=60",
      "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100",
      "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
      "-pix_fmt", "yuv420p", "-b:v", "6000k", "-maxrate", "6400k", "-bufsize", "9000k",
      "-c:a", "aac", "-b:a", "128k",
      "-f", "flv", target,
    ],
    { detached: true, stdio: "ignore" }
  );
  child.unref();
  if (child.pid) fs.writeFileSync(PID_FILE, String(child.pid));
  return { ok: Boolean(child.pid), message: child.pid ? "запущен" : "ffmpeg не стартовал" };
}

function stopDemo(): { ok: boolean } {
  const pid = demoRunning();
  if (pid === null) {
    clearPid();
    return { ok: true };
  }
  try {
    process.kill(-pid, "SIGTERM"); // всю группу (spawn detached)
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* уже мёртв */
    }
  }
  clearPid();
  return { ok: true };
}

/** GET — статус демо-эфира + данные движка для пульта */
export async function GET() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden", message: "Только администратор" }, { status: 403 });
  }
  const [engine, key] = await Promise.all([getOwncastSummary(), getOwncastStreamKey()]);
  return NextResponse.json({
    running: demoRunning() !== null,
    engine,
    rtmp: { url: OWNCast_RTMP_URL, key: key ?? OWNCast_STREAM_KEY },
    hls: { url: "/api/stream/hls/stream.m3u8" },
  });
}

/** POST — start/stop демо-эфира; системные сообщения в чат как при реальном эфире */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden", message: "Только администратор" }, { status: 403 });
  }

  let action = "";
  try {
    const body = (await req.json()) as { action?: string };
    action = body.action ?? "";
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  if (action !== "start" && action !== "stop") {
    return NextResponse.json({ error: "bad_action", message: "action = start | stop" }, { status: 400 });
  }

  const result = action === "start" ? await startDemo() : stopDemo();
  if (!result.ok) {
    return NextResponse.json({ error: "ffmpeg_failed", message: result.message ?? "Не удалось запустить ffmpeg" }, { status: 500 });
  }

  // Сообщение в чат: эфир стартовал/завершился (как при реальном OBS-эфире)
  const channel = await db.channel.findFirst({ orderBy: { sortOrder: "asc" } });
  if (channel) {
    if (action === "start") {
      announceToChat(channel.slug, `Демо-эфир запущен: ${channel.liveTitle ?? channel.name}`);
    } else {
      announceToChat(channel.slug, "Демо-эфир завершён. Спасибо, что были с нами!", { clearPin: true });
    }
  }

  return NextResponse.json({ ok: true, running: action === "start" });
}
