import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, toPublicUser } from "@/lib/auth";
import { checkTelegramSubscription } from "@/lib/telegram";
import { subscriptionCheckConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/verify-subscription
 * Ручная перепроверка «платности» подписчика через Bot API getChatMember.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!subscriptionCheckConfigured || !user.telegramId || user.telegramId.startsWith("demo:")) {
    return NextResponse.json(
      {
        isSubscriber: user.isSubscriber,
        checked: false,
        message: "Проверка подписки не настроена (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID) либо это демо-аккаунт",
      },
      { status: 200 }
    );
  }

  const check = await checkTelegramSubscription(user.telegramId);
  if (!check.ok) {
    return NextResponse.json(
      { isSubscriber: user.isSubscriber, checked: false, error: check.error, status: check.status },
      { status: 502 }
    );
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: { isSubscriber: check.isMember, subCheckedAt: new Date() },
  });

  return NextResponse.json({ user: toPublicUser(updated), isSubscriber: check.isMember, checked: true, status: check.status });
}
