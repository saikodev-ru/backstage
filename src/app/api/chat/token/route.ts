import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { issueChatToken } from "@/lib/chat-token";

export const dynamic = "force-dynamic";

/** GET /api/chat/token — HMAC-токен для подключения к чат-сервису (порт 3003) */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ token: issueChatToken(user) });
}
