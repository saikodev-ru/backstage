// Сид «Бэкстейдж»: каналы, расписание, клипы, записи, коллаборации.
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
  console.log("🗄  Seeding Backstage…");

  // ── Каналы ──────────────────────────────────────────────────────────────
  const channels = [
    {
      slug: "saiko",
      name: "SaikoDev",
      handle: "saikodev",
      tagline: "Код, музыка и ночные эфиры",
      description:
        "Приватный канал Saiko: ночные код-сессии, разборы архитектуры и живое общение с подписчиками. Доступ к эфирам — только для платных подписчиков приватного Telegram-канала.",
      avatarUrl: "/img/avatars/saiko.png",
      bannerUrl: "/img/banners/main.png",
      accentColor: "#a970ff",
      telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "-1001234567890",
      telegramLink: process.env.TELEGRAM_CHANNEL_LINK ?? "https://t.me/+example_private",
      isLive: true,
      liveTitle: "Ночная смена: собираем Бэкстейдж с нуля",
      liveCategory: "Разработка",
      liveTags: JSON.stringify(["код", "next.js", "typescript", "ночной эфир"]),
      liveStartedAt: new Date(Date.now() - 47 * 60 * 1000),
      livePreviewUrl: "/img/previews/saiko-live.png",
      hlsUrl: MUX_TEST_STREAM,
      followers: 12480,
      viewers: 0,
      sortOrder: 0,
    },
    {
      slug: "lina",
      name: "Lina Loops",
      handle: "linaloops",
      tagline: "Лайв-кодинг и модульные синтезаторы",
      description:
        "Еженедельные эфиры: генеративная музыка, Eurorack, суперколлайдер и лайв-кодинг на Sonic Pi.",
      avatarUrl: "/img/avatars/lina.png",
      bannerUrl: "/img/banners/lina.png",
      accentColor: "#5ad1a4",
      isLive: false,
      followers: 5321,
      sortOrder: 1,
    },
    {
      slug: "lex",
      name: "Lex Frames",
      handle: "lexframes",
      tagline: "Кинематографичные скетчи и моушн",
      description: "Рисуем кадры в реальном времени: композиция, свет, цвет и сторителлинг.",
      avatarUrl: "/img/avatars/lex.png",
      bannerUrl: "/img/banners/lex.png",
      accentColor: "#ffb86b",
      isLive: false,
      followers: 2870,
      sortOrder: 2,
    },
  ];

  for (const c of channels) {
    await db.channel.upsert({ where: { slug: c.slug }, create: c, update: c });
  }

  // ── Расписание (ближайшие 7 дней) ───────────────────────────────────────
  await db.scheduleEntry.deleteMany({});
  const schedule = [
    { channelSlug: "saiko", title: "Ночная смена: финальный спринт Бэкстейджа", category: "Разработка", startsAt: at(1, 19), durationMin: 180, note: "Разбор чата, Q&A с подписчиками" },
    { channelSlug: "lina", title: "Генеративный джем: Sonic Pi × Eurorack", category: "Музыка", startsAt: at(2, 20), durationMin: 120, note: null },
    { channelSlug: "lex", title: "Скетч-марафон: 10 кадров за 2 часа", category: "Творчество", startsAt: at(3, 15), durationMin: 120, note: "Голосование за лучший кадр" },
    { channelSlug: "saiko", title: "Код-ревью подписчиков", category: "Разработка", startsAt: at(4, 19), durationMin: 120, note: "Присылайте проекты в приватный чат" },
    { channelSlug: "lina", title: "Альфа-тест аудио-движка Бэкстейджа", category: "Музыка", startsAt: at(5, 20), durationMin: 90, note: null },
    { channelSlug: "saiko", title: "Субботний стрим: давно обещанный Q&A", category: "Общение", startsAt: at(6, 16), durationMin: 150, note: null },
  ];
  for (const s of schedule) {
    await db.scheduleEntry.create({ data: s });
  }

  // ── Клипы (витрина-заглушки) ────────────────────────────────────────────
  await db.clip.deleteMany({});
  const clips = [
    { channelSlug: "saiko", title: "«У нас же тестовая ссылка!» — первый эфир Бэкстейджа", thumbnailUrl: "/img/clips/clip-1.png", durationSec: 42, views: 1834, createdAt: new Date(Date.now() - 2 * 864e5) },
    { channelSlug: "saiko", title: "Момент, когда Prisma наконец смигрировал", thumbnailUrl: "/img/clips/clip-2.png", durationSec: 28, views: 952, createdAt: new Date(Date.now() - 3 * 864e5) },
    { channelSlug: "lina", title: "Лайв-луп, который сломал интернет (почти)", thumbnailUrl: "/img/clips/clip-3.png", durationSec: 65, views: 4210, createdAt: new Date(Date.now() - 4 * 864e5) },
    { channelSlug: "saiko", title: "Socket.io против Caddy: битва титанов", thumbnailUrl: "/img/clips/clip-4.png", durationSec: 51, views: 1187, createdAt: new Date(Date.now() - 5 * 864e5) },
    { channelSlug: "lex", title: "Кадр «Лавандовая ночь» — от пустого холста до финала", thumbnailUrl: "/img/clips/clip-5.png", durationSec: 87, views: 763, createdAt: new Date(Date.now() - 6 * 864e5) },
    { channelSlug: "saiko", title: "Топ-5 вопросов о приватных трансляциях", thumbnailUrl: "/img/clips/clip-6.png", durationSec: 74, views: 2311, createdAt: new Date(Date.now() - 7 * 864e5) },
  ];
  for (const c of clips) {
    await db.clip.create({ data: c });
  }

  // ── Записи эфиров (витрина-заглушки) ────────────────────────────────────
  await db.recording.deleteMany({});
  const recordings = [
    { channelSlug: "saiko", title: "Эфир #12: Архитектура стриминговой платформы", thumbnailUrl: "/img/recordings/rec-1.png", durationSec: 9240, views: 3120, createdAt: new Date(Date.now() - 6 * 864e5) },
    { channelSlug: "saiko", title: "Эфир #11: Telegram Login Widget от А до Я", thumbnailUrl: "/img/recordings/rec-2.png", durationSec: 7680, views: 2480, createdAt: new Date(Date.now() - 13 * 864e5) },
    { channelSlug: "lina", title: "Сессия #8: Модульный джем в прямом эфире", thumbnailUrl: "/img/recordings/rec-3.png", durationSec: 6840, views: 1890, createdAt: new Date(Date.now() - 9 * 864e5) },
    { channelSlug: "lex", title: "Скетч-вечер: свет и тень", thumbnailUrl: "/img/recordings/rec-4.png", durationSec: 5400, views: 1210, createdAt: new Date(Date.now() - 11 * 864e5) },
  ];
  for (const r of recordings) {
    await db.recording.create({ data: r });
  }

  // ── Коллаборации ────────────────────────────────────────────────────────
  await db.collab.deleteMany({});
  const collabs = [
    {
      title: "Бэкстейдж: строим вместе",
      description: "Совместный эфир Saiko и Lina: полный цикл — от верстки витрины до подключения медиа-сервера и проверки подписок.",
      members: JSON.stringify([
        { slug: "saiko", name: "SaikoDev", avatarUrl: "/img/avatars/saiko.png", role: "Ведущий" },
        { slug: "lina", name: "Lina Loops", avatarUrl: "/img/avatars/lina.png", role: "Со-ведущая" },
      ]),
      status: "confirmed",
      plannedAt: at(1, 19),
    },
    {
      title: "Лайв-джем: код × музыка",
      description: "Lex рисует визуал в реальном времени под генеративные лупы Lina. Зрители голосуют за развитие композиции.",
      members: JSON.stringify([
        { slug: "lina", name: "Lina Loops", avatarUrl: "/img/avatars/lina.png", role: "Звук" },
        { slug: "lex", name: "Lex Frames", avatarUrl: "/img/avatars/lex.png", role: "Визуал" },
      ]),
      status: "planning",
      plannedAt: at(3, 20),
    },
    {
      title: "Марафон закрытия сезона",
      description: "Все авторы Бэкстейджа в одном эфире: итоги, розыгрыш среди подписчиков и анонс следующего сезона.",
      members: JSON.stringify([
        { slug: "saiko", name: "SaikoDev", avatarUrl: "/img/avatars/saiko.png", role: "Организатор" },
        { slug: "lina", name: "Lina Loops", avatarUrl: "/img/avatars/lina.png", role: "Участница" },
        { slug: "lex", name: "Lex Frames", avatarUrl: "/img/avatars/lex.png", role: "Участник" },
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
