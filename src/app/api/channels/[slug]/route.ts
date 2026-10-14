import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { mapChannel } from "@/lib/channels";
import { announceToChat, setChatSubsOnly } from "@/lib/telegram";
import { channelOwncastBase, getOwncastState, mergeChannelWithOwncast } from "@/lib/owncast";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/channels/[slug] — один канал (с реальным состоянием Owncast) */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const user = await getSessionUser();
  const isAdmin = user?.role === "ADMIN";
  const channel = await db.channel.findUnique({ where: { slug } });
  if (!channel) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const merged = await mergeChannelWithOwncast(mapChannel(channel, isAdmin));
  return NextResponse.json({ channel: merged });
}

/**
 * PATCH /api/channels/[slug] — управление каналом (админ):
 * вкл/выкл эфир, заголовок, категория, теги, HLS URL, инфо о канале.
 * Переключение эфира шлёт системное сообщение в чат.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden", message: "Только администратор" }, { status: 403 });
  }

  const { slug } = await ctx.params;
  const channel = await db.channel.findUnique({ where: { slug } });
  if (!channel) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: {
    isLive?: boolean;
    access?: "public" | "private";
    requiredTelegramChatId?: string | null;
    liveTitle?: string | null;
    liveCategory?: string | null;
    liveTags?: string[];
    livePreviewUrl?: string | null;
    hlsUrl?: string | null;
    owncastBaseUrl?: string | null;
    name?: string;
    tagline?: string | null;
    description?: string | null;
    avatarUrl?: string | null;
    bannerUrl?: string | null;
    telegramChatId?: string | null;
    telegramLink?: string | null;
    accentColor?: string;
    followers?: number;
    resetStreamKey?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  // Если движок Owncast доступен — эфир и HLS управляются движком (RTMP-пуш).
  // Ручные isLive/hlsUrl из запроса применяются только в fallback-режиме.
  const engineState = await getOwncastState(channelOwncastBase(channel));
  const engineLive = engineState.reachable;
  if (typeof body.isLive === "boolean" && !engineLive) data.isLive = body.isLive;
  // Доступ к эфиру: публичный или приватный (гейт по платной подписке)
  let accessChanged = false;
  if (body.access === "public" || body.access === "private") {
    if (channel.access !== body.access) accessChanged = true;
    data.access = body.access;
  }
  if (body.requiredTelegramChatId !== undefined) {
    data.requiredTelegramChatId = body.requiredTelegramChatId?.trim() || null;
  }
  if (body.liveTitle !== undefined) data.liveTitle = body.liveTitle?.slice(0, 140) ?? null;
  if (body.liveCategory !== undefined) data.liveCategory = body.liveCategory?.slice(0, 40) ?? null;
  if (body.liveTags !== undefined) {
    data.liveTags = JSON.stringify(
      (Array.isArray(body.liveTags) ? body.liveTags : []).filter((t) => typeof t === "string" && t.trim()).slice(0, 6)
    );
  }
  if (body.livePreviewUrl !== undefined) data.livePreviewUrl = body.livePreviewUrl || null;
  if (body.hlsUrl !== undefined && !engineLive) data.hlsUrl = body.hlsUrl || null;
  if (body.owncastBaseUrl !== undefined) data.owncastBaseUrl = body.owncastBaseUrl || null;
  if (body.name !== undefined) data.name = body.name.slice(0, 40);
  if (body.tagline !== undefined) data.tagline = body.tagline?.slice(0, 80) ?? null;
  if (body.description !== undefined) data.description = body.description?.slice(0, 500) ?? null;
  if (body.avatarUrl !== undefined) data.avatarUrl = body.avatarUrl || null;
  if (body.bannerUrl !== undefined) data.bannerUrl = body.bannerUrl || null;
  if (body.telegramChatId !== undefined) data.telegramChatId = body.telegramChatId || null;
  if (body.telegramLink !== undefined) data.telegramLink = body.telegramLink || null;
  if (body.accentColor !== undefined) data.accentColor = body.accentColor.slice(0, 9);
  if (typeof body.followers === "number") data.followers = Math.max(0, Math.floor(body.followers));
  if (body.resetStreamKey) data.streamKey = undefined; // cuid() через update ниже

  const wasLive = channel.isLive;
  const willBeLive = typeof data.isLive === "boolean" ? (data.isLive as boolean) : wasLive;
  if (!engineLive) {
    if (!wasLive && willBeLive) {
      data.liveStartedAt = new Date();
      data.viewers = 0;
    }
    if (wasLive && !willBeLive) {
      data.liveStartedAt = null;
      data.viewers = 0;
    }
  }
  if (body.resetStreamKey) {
    // генерируем новый ключ через cuid-подобную строку
    data.streamKey = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
  }

  const updated = await db.channel.update({ where: { slug }, data });

  // Смена режима доступа синхронизирует чат: публичный эфир → чат открыт всем
  if (accessChanged) {
    const isPublic = updated.access === "public";
    await setChatSubsOnly(slug, !isPublic);
    await announceToChat(
      slug,
      isPublic
        ? "Эфир теперь публичный — чат открыт для всех зрителей"
        : "Эфир стал приватным — чат доступен платным подписчикам"
    );
  }

  if (!engineLive) {
    if (!wasLive && willBeLive) {
      announceToChat(slug, `Эфир начался: ${updated.liveTitle ?? updated.name}`);
    } else if (wasLive && !willBeLive) {
      announceToChat(slug, "Эфир завершён. Спасибо, что были с нами!");
    }
  }

  const merged = await mergeChannelWithOwncast(mapChannel(updated, true));
  return NextResponse.json({ channel: merged });
}
