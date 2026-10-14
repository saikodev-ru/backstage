// Гейт доступа к эфиру: публичные и приватные трансляции.
//
// Логика (кор-изменение «стримы можно вещать публично и приватно»):
//  - public  → смотреть может кто угодно (авторизация не нужна);
//  - private → нужен статус платного подписчика:
//      · админ/владелец — всегда пускаем;
//      · если для эфира указан конкретный ТГК (requiredTelegramChatId) и он
//        отличается от основного (env) — проверяем членство живым запросом к
//        Bot API (getChatMember) с кэшем 60с;
//      · иначе доверяем флагу user.isSubscriber (его ставит вход через
//        Telegram и ручная проверка «Я уже подписан»).
// Демо-режим без настроенного бота: флаг isSubscriber решает всё.

import type { PublicChannel, PublicUser } from "@/lib/types";
import { TELEGRAM_CHAT_ID } from "@/lib/env";
import { checkTelegramSubscription } from "@/lib/telegram";

/** Каналы, для которых основной ТГК не задан (пустая строка) — считаем «основным из env» */
export function effectiveRequiredChat(channel: {
  requiredTelegramChatId?: string | null;
}): string | null {
  const id = (channel.requiredTelegramChatId ?? "").trim();
  return id.length > 0 ? id : null;
}

/** Основной ТГК из окружения (или null, если не настроен) */
export const MAIN_TELEGRAM_CHAT = TELEGRAM_CHAT_ID?.trim() || null;

const checkCache = new Map<string, { isMember: boolean; at: number }>();
const CHECK_TTL_MS = 60_000;

async function isMemberOf(telegramId: string, chatId: string): Promise<boolean> {
  const key = `${telegramId}:${chatId}`;
  const hit = checkCache.get(key);
  if (hit && Date.now() - hit.at < CHECK_TTL_MS) return hit.isMember;
  const res = await checkTelegramSubscription(telegramId, chatId);
  // ok=false → бот не настроен/ошибка сети: не пускаем (гейт по подписке)
  const isMember = res.ok && res.isMember;
  checkCache.set(key, { isMember, at: Date.now() });
  return isMember;
}

/** Может ли зритель смотреть эфир канала */
export async function viewerCanWatch(
  user: PublicUser | null,
  channel: Pick<PublicChannel, "access" | "requiredTelegramChatId">
): Promise<boolean> {
  if (channel.access === "public") return true;
  if (!user) return false;
  if (user.role === "ADMIN") return true;

  const required = effectiveRequiredChat(channel);
  // Нет реестра/настроек → флаг подписки из профиля (демо-режим совместим)
  if (!required) return user.isSubscriber;
  if (required === MAIN_TELEGRAM_CHAT) return user.isSubscriber;
  // Для конкретного ТГК — живая проверка членства (демо-пользователей тоже
  // пускаем по флагу, чтобы витрина оставалась живой без реального бота)
  if (!user.telegramId || user.telegramId.startsWith("demo:")) return user.isSubscriber;
  return isMemberOf(user.telegramId, required);
}
