// Маппинг канала в публичную форму (без streamKey для не-админов).

import type { PublicChannel } from "@/lib/types";

export type { PublicChannel };

type ChannelRow = {
  id: string;
  slug: string;
  name: string;
  handle: string;
  tagline: string | null;
  description: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  accentColor: string;
  telegramChatId: string | null;
  telegramLink: string | null;
  isLive: boolean;
  liveTitle: string | null;
  liveCategory: string | null;
  liveTags: string;
  liveStartedAt: Date | null;
  livePreviewUrl: string | null;
  hlsUrl: string | null;
  owncastBaseUrl: string | null;
  streamKey: string;
  followers: number;
  viewers: number;
  sortOrder: number;
};

function parseTags(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function mapChannel(c: ChannelRow, isAdmin: boolean): PublicChannel {
  const base: PublicChannel = {
    id: c.id,
    slug: c.slug,
    name: c.name,
    handle: c.handle,
    tagline: c.tagline,
    description: c.description,
    avatarUrl: c.avatarUrl,
    bannerUrl: c.bannerUrl,
    accentColor: c.accentColor,
    telegramLink: c.telegramLink,
    isLive: c.isLive,
    liveTitle: c.liveTitle,
    liveCategory: c.liveCategory,
    liveTags: parseTags(c.liveTags),
    liveStartedAt: c.liveStartedAt ? c.liveStartedAt.toISOString() : null,
    livePreviewUrl: c.livePreviewUrl,
    hlsUrl: c.hlsUrl,
    owncastBaseUrl: c.owncastBaseUrl,
    followers: c.followers,
    viewers: c.viewers,
    sortOrder: c.sortOrder,
  };
  if (isAdmin) {
    base.streamKey = c.streamKey;
    base.telegramChatId = c.telegramChatId;
  }
  return base;
}
