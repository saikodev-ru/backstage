// Стрим-ключ инжеста Owncast (админ).
//
// GET  /api/admin/stream-key              — текущий ключ движка
// POST /api/admin/stream-key              — регенерация (утечка ключа):
//      { action: "regenerate" }
// Новый ключ применяется в движке сразу — для НОВЫХ RTMP-подключений
// (активный эфир не рвётся; OBS переподключится только с новым ключом).

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { OWNCast_STREAM_KEY } from "@/lib/owncast";
import { getOwncastStreamKey, getOwncastStreamKeys, regenerateOwncastStreamKey } from "@/lib/owncast-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden", message: "Только администратор" }, { status: 403 });
  }
  const [key, keys] = await Promise.all([getOwncastStreamKey(), getOwncastStreamKeys()]);
  if (key === null) {
    return NextResponse.json(
      { error: "engine_unreachable", message: "Owncast не отвечает — ключ недоступен" },
      { status: 502 }
    );
  }
  return NextResponse.json({ key, entries: keys, fallbackEnv: OWNCast_STREAM_KEY });
}

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

  if (action !== "regenerate") {
    return NextResponse.json({ error: "bad_action", message: 'action = "regenerate"' }, { status: 400 });
  }

  const result = await regenerateOwncastStreamKey();
  if (!result.ok || !result.key) {
    return NextResponse.json({ error: "engine_error", message: result.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true, key: result.key, message: "Ключ регенерирован" });
}
