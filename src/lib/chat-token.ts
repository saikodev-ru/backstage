// Выдача и проверка HMAC-токенов для чат-сервиса (socket.io, порт 3003).
// Формат: base64url(payloadJson).base64url(hmacSHA256(payloadJson, CHAT_SECRET))
// Такой же алгоритм использует mini-services/chat-service.

import { createHmac, timingSafeEqual } from "node:crypto";
import { CHAT_SECRET, INTERNAL_SECRET } from "@/lib/env";
import type { PublicUser } from "@/lib/auth";

export type ChatTokenPayload = {
  uid: string;
  name: string;
  color: string;
  avatar: string | null;
  slug: string;
  sub: boolean;
  adm: boolean;
  exp: number;
};

const PALETTE = [
  "#a970ff", "#ff7bac", "#5ad1a4", "#ffb86b", "#7bd3ff", "#f97ac0",
  "#c3e88d", "#ff9d5c", "#8be9fd", "#ff8080", "#d6bcff", "#78e0a1",
];

/** Стабильный цвет имени пользователя в чате */
export function userColor(uid: string): string {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payloadJson: string): string {
  return createHmac("sha256", CHAT_SECRET).update(payloadJson).digest("base64url");
}

export function issueChatToken(user: PublicUser): string {
  const payload: ChatTokenPayload = {
    uid: user.id,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "Гость",
    color: userColor(user.id),
    avatar: user.photoUrl,
    slug: user.username ?? user.telegramId ?? user.id,
    sub: user.isSubscriber,
    adm: user.role === "ADMIN",
    exp: Date.now() + 24 * 60 * 60 * 1000,
  };
  const json = JSON.stringify(payload);
  return `${b64url(json)}.${sign(json)}`;
}

export function verifyChatToken(token: string): ChatTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const json = Buffer.from(parts[0], "base64url").toString("utf8");
    const expected = Buffer.from(sign(json));
    const got = Buffer.from(parts[1], "base64url");
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    const payload = JSON.parse(json) as ChatTokenPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Проверка секрета внутренних вызовов (чат-сервис → основное приложение) */
export function internalSecretOk(header: string | null, bodySecret?: string): boolean {
  const candidate = header ?? bodySecret ?? "";
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(INTERNAL_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}
