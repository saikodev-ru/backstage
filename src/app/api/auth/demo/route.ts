import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, toPublicUser } from "@/lib/auth";
import { botConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/demo — демо-вход (когда Telegram-бот ещё не настроен).
 * Позволяет протестировать весь функционал: роли, гейтинг по подписке.
 */
export async function POST(req: NextRequest) {
  if (botConfigured) {
    return NextResponse.json(
      { error: "demo_disabled", message: "Демо-вход отключён: настроен Telegram-бот" },
      { status: 403 }
    );
  }

  let body: { name?: string; subscriber?: boolean; admin?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const name = (body.name ?? "").trim().slice(0, 32);
  if (name.length < 2) {
    return NextResponse.json({ error: "bad_name", message: "Имя должно быть не короче 2 символов" }, { status: 400 });
  }

  const telegramId = `demo:${name.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-")}`;
  const isSubscriber = Boolean(body.subscriber);
  const role = body.admin ? "ADMIN" : "VIEWER";

  const user = await db.user.upsert({
    where: { telegramId },
    create: {
      telegramId,
      username: name.toLowerCase().replace(/\s+/g, "_"),
      firstName: name,
      role,
      isSubscriber,
      subCheckedAt: new Date(),
      authProvider: "demo",
    },
    update: { firstName: name, role, isSubscriber, subCheckedAt: new Date() },
  });

  await createSession(user.id);
  return NextResponse.json({ user: toPublicUser(user) });
}
