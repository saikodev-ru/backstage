// Интеграция с Telegram:
// 1) валидация данных Telegram Login Widget по HMAC-подписи;
// 2) проверка подписки пользователя на приватный канал через Bot API.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { BOT_TOKEN, TELEGRAM_CHAT_ID, INTERNAL_SECRET } from "@/lib/env";

export type TelegramAuthData = {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number | string;
  hash: string;
};

/**
 * Валидация данных, пришедших от Telegram Login Widget.
 * Алгоритм: https://core.telegram.org/widgets/login#checking-authorization
 * secret_key = SHA256(bot_token), data-check-string = отсортированные "k=v" через \n без hash.
 */
export function validateTelegramHash(data: Record<string, string | number>): boolean {
  if (!BOT_TOKEN) return false;
  const { hash } = data as { hash: string };
  if (!hash) return false;

  const checkString = Object.entries(data)
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
  const hmac = createHmac("sha256", secretKey).update(checkString).digest("hex");

  const a = Buffer.from(hmac, "utf8");
  const b = Buffer.from(String(hash), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type SubscriptionCheckResult = {
  ok: boolean;
  isMember: boolean;
  status: string;
  error?: string;
};

/**
 * Проверка «платности» подписчика: состоит ли пользователь в приватном канале.
 * Статусы-члены: creator, administrator, member, restricted(is_member=true).
 * left / kicked → не подписан.
 * @param chatId конкретный канал (из реестра TelegramChannel) или основной из env
 */
export async function checkTelegramSubscription(
  telegramId: string,
  chatId?: string
): Promise<SubscriptionCheckResult> {
  const targetChat = chatId ?? TELEGRAM_CHAT_ID;
  if (!targetChat) {
    return { ok: false, isMember: false, status: "unknown", error: "subscription_check_not_configured" };
  }
  if (!/^-?\d+$/.test(telegramId) && !targetChat.startsWith("@")) {
    return { ok: false, isMember: false, status: "unknown", error: "invalid_telegram_id" };
  }
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(
      targetChat
    )}&user_id=${telegramId}`;
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json()) as {
      ok: boolean;
      result?: { status: string; is_member?: boolean };
      description?: string;
    };
    if (!json.ok || !json.result) {
      return { ok: false, isMember: false, status: "error", error: json.description ?? "bot_api_error" };
    }
    const st = json.result.status;
    const isMember =
      st === "creator" ||
      st === "administrator" ||
      st === "member" ||
      (st === "restricted" && Boolean(json.result.is_member));
    return { ok: true, isMember, status: st };
  } catch (e) {
    return { ok: false, isMember: false, status: "error", error: e instanceof Error ? e.message : "network_error" };
  }
}

/** Уведомление чат-сервиса о системном сообщении (начало/конец эфира и т.п.) */
export async function announceToChat(channelSlug: string, text: string) {
  try {
    await fetch("http://127.0.0.1:3003/announce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: INTERNAL_SECRET, channelSlug, text }),
    });
  } catch {
    // чат-сервис может быть недоступен — не критично
  }
}

/**
 * Синхронизация режима чата с доступом эфира: публичный эфир → чат открыт
 * всем вошедшим (subsonly off), приватный → только платным подписчикам.
 */
export async function setChatSubsOnly(channelSlug: string, subsOnly: boolean) {
  try {
    await fetch("http://127.0.0.1:3003/setsubsonly", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: INTERNAL_SECRET, channelSlug, enabled: subsOnly }),
    });
  } catch {
    // чат-сервис может быть недоступен — не критично
  }
}
