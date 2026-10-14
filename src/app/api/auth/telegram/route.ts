import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, toPublicUser } from "@/lib/auth";
import { validateTelegramHash, checkTelegramSubscription } from "@/lib/telegram";
import { ADMIN_IDS, botConfigured, subscriptionCheckConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/telegram
 * Приём данных Telegram Login Widget (data-onauth → JSONP callback).
 * 1. Проверяем HMAC-подпись Telegram.
 * 2. Создаём/обновляем пользователя.
 * 3. Проверяем подписку на приватный канал через Bot API (если настроено).
 * 4. Выдаём сессию (httpOnly cookie).
 */
export async function POST(req: NextRequest) {
  if (!botConfigured) {
    return NextResponse.json(
      { error: "telegram_not_configured", message: "Бот Telegram не настроен (TELEGRAM_BOT_USERNAME / TELEGRAM_BOT_TOKEN)" },
      { status: 503 }
    );
  }

  let body: Record<string, string | number>;
  try {
    body = (await req.json()) as Record<string, string | number>;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const telegramId = String(body.id ?? "");
  if (!telegramId || !/^\d+$/.test(telegramId) || !body.hash || !body.auth_date) {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }

  // Защита от устаревших данных авторизации
  const authDate = Number(body.auth_date);
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > 86400) {
    return NextResponse.json({ error: "auth_data_expired", message: "Данные авторизации устарели, попробуйте снова" }, { status: 401 });
  }

  if (!validateTelegramHash(body)) {
    return NextResponse.json({ error: "invalid_hash", message: "Подпись Telegram не прошла проверку" }, { status: 401 });
  }

  const key = ADMIN_IDS.find((a) => a === telegramId || a === String(body.username ?? "").toLowerCase());
  const role = key ? "ADMIN" : "VIEWER";

  // Проверка подписки на приватный канал
  let isSubscriber = false;
  let subStatus = "unchecked";
  if (subscriptionCheckConfigured) {
    const check = await checkTelegramSubscription(telegramId);
    if (check.ok) {
      isSubscriber = check.isMember;
      subStatus = check.status;
    } else {
      subStatus = check.error ?? "error";
    }
  }

  const user = await db.user.upsert({
    where: { telegramId },
    create: {
      telegramId,
      username: body.username ? String(body.username) : null,
      firstName: String(body.first_name ?? "Зритель"),
      lastName: body.last_name ? String(body.last_name) : null,
      photoUrl: body.photo_url ? String(body.photo_url) : null,
      role,
      isSubscriber,
      subCheckedAt: new Date(),
      authProvider: "telegram",
    },
    update: {
      username: body.username ? String(body.username) : null,
      firstName: String(body.first_name ?? "Зритель"),
      lastName: body.last_name ? String(body.last_name) : null,
      photoUrl: body.photo_url ? String(body.photo_url) : null,
      role,
      isSubscriber,
      subCheckedAt: new Date(),
    },
  });

  await createSession(user.id);

  return NextResponse.json({
    user: toPublicUser(user),
    subStatus,
    subscriptionChecked: subscriptionCheckConfigured,
  });
}
