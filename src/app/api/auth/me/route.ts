import { NextResponse } from "next/server";
import { getSessionUser, toPublicUser } from "@/lib/auth";
import {
  BOT_USERNAME,
  TELEGRAM_CHANNEL_LINK,
  botConfigured,
  subscriptionCheckConfigured,
} from "@/lib/env";

export const dynamic = "force-dynamic";

/** GET /api/auth/me — текущий пользователь + конфигурация авторизации */
export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({
    user: user ? toPublicUser(user) : null,
    config: {
      botUsername: BOT_USERNAME || null,
      botConfigured,
      subscriptionCheckConfigured,
      demoMode: !botConfigured,
      channelLink: TELEGRAM_CHANNEL_LINK || null,
    },
  });
}
