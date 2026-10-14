// Централизованный доступ к конфигурации окружения «Бэкстейдж».
// Все значения имеют безопасные дефолты для локальной разработки.

export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
export const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "";
// ID приватного канала (например -1001234567890) или @username
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
// Ссылка-приглашение в приватный канал (для CTA «Как подписаться»)
export const TELEGRAM_CHANNEL_LINK = process.env.TELEGRAM_CHANNEL_LINK ?? "";

// Секрет для подписи токенов чата (совпадает с mini-services/chat-service)
export const CHAT_SECRET = process.env.CHAT_SECRET ?? "backstage-dev-chat-secret-2024";
// Секрет внутренних вызовов между сервисами
export const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? "backstage-internal-2024";

// Telegram ID / username администраторов через запятую
export const ADMIN_IDS = (process.env.ADMIN_IDS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const botConfigured = Boolean(BOT_TOKEN && BOT_USERNAME);
export const subscriptionCheckConfigured = Boolean(BOT_TOKEN && TELEGRAM_CHAT_ID);

/** Длительность сессии — 30 дней */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "bs_session";
