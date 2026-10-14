// Общие типы «Бэкстейдж» — используются и на сервере, и на клиенте.

export type Role = "VIEWER" | "MOD" | "STREAMER" | "ADMIN";

/** Роль в чате: владелец канала / модератор / зритель */
export type ChatRole = "OWNER" | "MOD" | "VIEWER";

export type PublicUser = {
  id: string;
  telegramId: string | null;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  role: Role;
  isSubscriber: boolean;
  subCheckedAt: string | null;
  authProvider: string;
};

export type PublicChannel = {
  id: string;
  slug: string;
  name: string;
  handle: string;
  tagline: string | null;
  description: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  accentColor: string;
  telegramLink: string | null;
  isLive: boolean;
  liveTitle: string | null;
  liveCategory: string | null;
  liveTags: string[];
  liveStartedAt: string | null;
  livePreviewUrl: string | null;
  hlsUrl: string | null;
  followers: number;
  viewers: number;
  sortOrder: number;
  streamKey?: string;
  telegramChatId?: string | null;
};

export type ChatMessageDto = {
  id: string;
  channelSlug: string;
  uid: string | null;
  name: string;
  color: string;
  avatar: string | null;
  text: string;
  ts: number;
  system: boolean;
  /** Бейдж отправителя (для UI) */
  role?: ChatRole;
  /** Сообщение удалено модератором */
  deleted?: boolean;
};

export type AuthConfigDto = {
  botUsername: string | null;
  botConfigured: boolean;
  subscriptionCheckConfigured: boolean;
  demoMode: boolean;
  channelLink: string | null;
};

export type ClipDto = {
  id: string;
  channelSlug: string;
  title: string;
  thumbnailUrl: string | null;
  durationSec: number;
  views: number;
  createdAt: string;
};

export type RecordingDto = {
  id: string;
  channelSlug: string;
  title: string;
  thumbnailUrl: string | null;
  durationSec: number;
  views: number;
  createdAt: string;
};

export type ScheduleDto = {
  id: string;
  channelSlug: string;
  title: string;
  category: string | null;
  startsAt: string;
  durationMin: number;
  note: string | null;
};

export type CollabMemberDto = {
  slug: string;
  name: string;
  avatarUrl: string | null;
  role: string;
};

export type CollabDto = {
  id: string;
  title: string;
  description: string | null;
  members: CollabMemberDto[];
  status: "idea" | "planning" | "confirmed";
  plannedAt: string | null;
};

export type EmoteDto = {
  name: string;
  provider: "7tv" | "bttv" | "ffz";
  url: string;
  zeroUrl?: string;
};
