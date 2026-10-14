import { NextResponse } from "next/server";
import {
  BOT_USERNAME,
  DEMO_LOGIN,
  TELEGRAM_CHANNEL_LINK,
  botConfigured,
  subscriptionCheckConfigured,
} from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    botUsername: BOT_USERNAME || null,
    botConfigured,
    subscriptionCheckConfigured,
    demoMode: DEMO_LOGIN || !botConfigured,
    channelLink: TELEGRAM_CHANNEL_LINK || null,
  });
}
