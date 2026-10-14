// Сид «Бэкстейдж»: ОДИН канал dypaGPT (VTuber) + витрина-контент.
// Фундамент мультиканала сохранён: модель Channel поддерживает сколько угодно авторов.
// Запуск: bun scripts/seed.ts

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const MUX_TEST_STREAM = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

function at(dayOffset: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  console.log("🗄  Seeding BACKSTAGE · dypaGPT…");

  // ── Каналы: один dypaGPT, старые демо-каналы убираем ────────────────────
  await db.channel.deleteMany({
    where: { slug: { in: ["saiko", "lina", "lex"] } },
  });

  const channel = {
    slug: "dypagpt",
    name: "dypaGPT",
    handle: "dypagpt",
    tagline: "ВТубер · нейро-девочка · игры, караоке и уютный вайб",
    description:
      "Приватный канал dypaGPT: хоррор-марафоны, караоке-ночи, рисование с чатом и Q&A. Аниме-аватар, живые эмоции и максимально тёплое комьюнити. Доступ к эфирам — только для платных подписчиков приватного Telegram-канала.",
    avatarUrl: "/img/dypagpt/avatar.png",
    bannerUrl: "/img/dypagpt/banner.png",
    accentColor: "#a970ff",
    telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
    telegramLink: process.env.TELEGRAM_CHANNEL_LINK ?? "https://t.me/dypaGPT",
    isLive: true,
    liveTitle: "ХОРРОР-МАРАФОН #17: до последнего скримера 😱",
    liveCategory: "VTuber · Хорроры",
    liveTags: JSON.stringify(["vtuber", "хоррор", "нейро-девочка", "караоке после"]),
    liveStartedAt: new Date(Date.now() - 63 * 60 * 1000),
    livePreviewUrl: "/img/dypagpt/live.png",
    hlsUrl: MUX_TEST_STREAM,
    followers: 24813,
    viewers: 0,
    sortOrder: 0,
  };

  await db.channel.upsert({ where: { slug: channel.slug }, create: channel, update: channel });

  // ── Расписание (неделя VTuber-эфиров) ──────────────────────────────────
  await db.scheduleEntry.deleteMany({});
  const schedule = [
    { channelSlug: "dypagpt", title: "ХОРРОР-МАРАФОН #18: вторая часть", category: "Хорроры", startsAt: at(1, 19), durationMin: 180, note: "Продолжение игры со вчерашнего сейва" },
    { channelSlug: "dypagpt", title: "КАРАОKE-НОЧЬ: поём ваши заявки", category: "Музыка", startsAt: at(2, 20), durationMin: 120, note: "Заявки в чате, сабы — приоритет" },
    { channelSlug: "dypagpt", title: "РИСУЕМ ЭМОЦИИ: аватарки для чата", category: "Творчество", startsAt: at(3, 16), durationMin: 120, note: "Разыгрываем 3 аватарки среди подписчиков" },
    { channelSlug: "dypagpt", title: "ИНДИ-ПОДПОЛКА: 3 игры за вечер", category: "Инди", startsAt: at(4, 19), durationMin: 150, note: null },
    { channelSlug: "dypagpt", title: "Q&A С ПОДПИСЧИКАМИ + кружки чая", category: "Общение", startsAt: at(5, 20), durationMin: 90, note: "Собирайте вопросы в приватном чате" },
    { channelSlug: "dypagpt", title: "СУББОТНИЙ МАРАФОН: всё сразу", category: "Микс", startsAt: at(6, 14), durationMin: 300, note: "Хоррор → караоке → рисование" },
  ];
  for (const s of schedule) {
    await db.scheduleEntry.create({ data: s });
  }

  // ── Клипы (VTuber-моменты) ──────────────────────────────────────────────
  await db.clip.deleteMany({});
  const clips = [
    { channelSlug: "dypagpt", title: "КАРАОКЕ-КРЕЩЕНДО: чат в слезах", thumbnailUrl: "/img/dypagpt/clip-1.png", durationSec: 42, views: 18340, createdAt: new Date(Date.now() - 1 * 864e5) },
    { channelSlug: "dypagpt", title: "СКРИМ ГОДА: она не ожидала", thumbnailUrl: "/img/dypagpt/clip-2.png", durationSec: 28, views: 9252, createdAt: new Date(Date.now() - 2 * 864e5) },
    { channelSlug: "dypagpt", title: "КЛАТЧ НА 1 ХП: чат сошёл с ума", thumbnailUrl: "/img/dypagpt/clip-3.png", durationSec: 65, views: 43210, createdAt: new Date(Date.now() - 3 * 864e5) },
    { channelSlug: "dypagpt", title: "КОГДА ИГРА СЛОМАЛАСЬ: ржака 5 минут", thumbnailUrl: "/img/dypagpt/clip-4.png", durationSec: 51, views: 12187, createdAt: new Date(Date.now() - 4 * 864e5) },
    { channelSlug: "dypagpt", title: "РИСУЮ ВАШУ АВАТАРКУ В ПРЯМОМ ЭФИРЕ", thumbnailUrl: "/img/dypagpt/clip-5.png", durationSec: 87, views: 7763, createdAt: new Date(Date.now() - 5 * 864e5) },
    { channelSlug: "dypagpt", title: "ДОНАТ-СЮРПРИЗ: реакция 10/10", thumbnailUrl: "/img/dypagpt/clip-6.png", durationSec: 74, views: 23311, createdAt: new Date(Date.now() - 7 * 864e5) },
  ];
  for (const c of clips) {
    await db.clip.create({ data: c });
  }

  // ── Записи эфиров ──────────────────────────────────────────────────────
  await db.recording.deleteMany({});
  const recordings = [
    { channelSlug: "dypagpt", title: "ЭФИР #17: ХОРРОР-МАРАФОН (первая половина)", thumbnailUrl: "/img/dypagpt/rec-1.png", durationSec: 9240, views: 3150, createdAt: new Date(Date.now() - 2 * 864e5) },
    { channelSlug: "dypagpt", title: "КАРАОКЕ-НОЧЬ #9: 40 песен подряд", thumbnailUrl: "/img/dypagpt/rec-2.png", durationSec: 7680, views: 2480, createdAt: new Date(Date.now() - 6 * 864e5) },
    { channelSlug: "dypagpt", title: "Q&A #4: ОТВЕТЫ ПОДПИСЧИКАМ", thumbnailUrl: "/img/dypagpt/rec-3.png", durationSec: 6840, views: 1890, createdAt: new Date(Date.now() - 9 * 864e5) },
    { channelSlug: "dypagpt", title: "ПРАЗДНИЧНЫЙ ЭФИР: 25 000 ПОДПИСЧИКОВ", thumbnailUrl: "/img/dypagpt/rec-4.png", durationSec: 5400, views: 1210, createdAt: new Date(Date.now() - 12 * 864e5) },
  ];
  for (const r of recordings) {
    await db.recording.create({ data: r });
  }

  // ── Коллаборации ──────────────────────────────────────────────────────
  await db.collab.deleteMany({});
  const collabs = [
    {
      title: "ДУЭТ-КАРАОКЕ: dypaGPT × Милка",
      description: "Совместная караоке-ночь: поём попурри, чат выбирает порядок песен, между блоками — мини-игры.",
      members: JSON.stringify([
        { slug: "dypagpt", name: "dypaGPT", avatarUrl: "/img/dypagpt/avatar.png", role: "Ведущая" },
        { slug: "milka", name: "Милка", avatarUrl: "/img/dypagpt/guest-1.png", role: "Со-ведущая" },
      ]),
      status: "confirmed",
      plannedAt: at(2, 20),
    },
    {
      title: "НЕЙРО-БАТТЛ: dypaGPT vs Кайто",
      description: "Соревновательный эфир: инди-игры на скорость, проигравший поёт песню по заказу победителя.",
      members: JSON.stringify([
        { slug: "dypagpt", name: "dypaGPT", avatarUrl: "/img/dypagpt/avatar.png", role: "Капитан 1" },
        { slug: "kaito", name: "Кайто", avatarUrl: "/img/dypagpt/guest-2.png", role: "Капитан 2" },
      ]),
      status: "planning",
      plannedAt: at(4, 19),
    },
    {
      title: "ИДЕЯ: ВСЕ ВТУБЕРЫ В ОДНОМ ЭФИРЕ",
      description: "Большой кроссовер: каждому гостю — свой блок, общие мини-игры и финальное караоке-попурри.",
      members: JSON.stringify([
        { slug: "dypagpt", name: "dypaGPT", avatarUrl: "/img/dypagpt/avatar.png", role: "Организатор" },
        { slug: "milka", name: "Милка", avatarUrl: "/img/dypagpt/guest-1.png", role: "Гость" },
        { slug: "kaito", name: "Кайто", avatarUrl: "/img/dypagpt/guest-2.png", role: "Гость" },
      ]),
      status: "idea",
      plannedAt: null,
    },
  ];
  for (const c of collabs) {
    await db.collab.create({ data: c });
  }

  const counts = {
    channels: await db.channel.count(),
    schedule: await db.scheduleEntry.count(),
    clips: await db.clip.count(),
    recordings: await db.recording.count(),
    collabs: await db.collab.count(),
  };
  console.log("✅ Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
