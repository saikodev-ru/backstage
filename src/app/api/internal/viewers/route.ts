import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { internalSecretOk } from "@/lib/chat-token";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/viewers — внутренний вызов от чат-сервиса (раз в 10с).
 * Обновляет счётчики зрителей каналов.
 */
export async function POST(req: NextRequest) {
  if (!internalSecretOk(req.headers.get("x-internal-secret"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: { counts?: Record<string, number> };
  try {
    body = (await req.json()) as { counts?: Record<string, number> };
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const counts = body.counts ?? {};

  await Promise.all(
    Object.entries(counts).map(([slug, n]) =>
      db.channel
        .update({
          where: { slug },
          data: { viewers: Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0 },
        })
        .catch(() => {})
    )
  );

  return NextResponse.json({ ok: true });
}
