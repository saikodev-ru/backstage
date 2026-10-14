// Сессии на базе httpOnly-cookie + записи в БД.

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/env";
import type { PublicUser, Role } from "@/lib/types";

export type { PublicUser };

export function toPublicUser(u: {
  id: string;
  telegramId: string | null;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  role: string;
  isSubscriber: boolean;
  subCheckedAt: Date | null;
  authProvider: string;
}): PublicUser {
  const role: Role = u.role === "ADMIN" || u.role === "STREAMER" ? u.role : "VIEWER";
  return {
    id: u.id,
    telegramId: u.telegramId,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    photoUrl: u.photoUrl,
    role,
    isSubscriber: u.isSubscriber,
    subCheckedAt: u.subCheckedAt ? u.subCheckedAt.toISOString() : null,
    authProvider: u.authProvider,
  };
}

/** Создать сессию и установить cookie */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({ data: { token, userId, expiresAt } });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    secure: false, // в продакшене за HTTPS-прокси выставить true
  });
  return token;
}

/** Текущий пользователь по cookie или null */
export async function getSessionUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
}

/** Разлогинить текущую сессию */
export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { token } }).catch(() => {});
  }
  store.delete(SESSION_COOKIE);
}
