import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { internalSecretOk } from "@/lib/chat-token";

export const dynamic = "force-dynamic";

type IngestBody = {
  channelSlug?: string;
  secret?: string;
  message?: {
    id?: string;
    uid?: string | null;
    name?: string;
    color?: string;
    avatar?: string | null;
    text?: string;
    system?: boolean;
    ts?: number;
  };
};

/**
 * POST /api/chat/ingest — внутренний вызов от чат-сервиса.
 * Сохраняет сообщение в БД (архив чата).
 */
export async function POST(req: NextRequest) {
  if (!internalSecretOk(req.headers.get("x-internal-secret"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const { channelSlug, message } = body;
  if (!channelSlug || !message || typeof message.text !== "string" || !message.text.trim()) {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }

  // Игнорируем дубли по id чат-сервиса
  if (message.id) {
    const existing = await db.chatMessage.findFirst({ where: { id: message.id } });
    if (existing) return NextResponse.json({ ok: true, duplicate: true });
  }

  await db.chatMessage.create({
    data: {
      id: message.id,
      channelSlug,
      uid: message.uid ?? null,
      name: (message.name ?? "Гость").slice(0, 64),
      color: message.color ?? "#9a9aa6",
      avatar: message.avatar ?? null,
      text: message.text.slice(0, 500),
      system: Boolean(message.system),
      ts: message.ts ? new Date(message.ts) : new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
