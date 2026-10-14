// Реестр категорий эфира (Twitch-подобный): slug — стабильный идентификатор
// для БД/API, name — человекочитаемое название, emoji — плитка выбора.

export type Category = { slug: string; name: string; emoji: string };

export const CATEGORIES: Category[] = [
  { slug: "just-chatting", name: "Общение", emoji: "💬" },
  { slug: "games", name: "Игры", emoji: "🎮" },
  { slug: "music", name: "Музыка", emoji: "🎵" },
  { slug: "irl", name: "IRL", emoji: "🚶" },
  { slug: "sleep", name: "Сон", emoji: "😴" },
  { slug: "art", name: "Рисование", emoji: "🎨" },
  { slug: "dev", name: "Разработка", emoji: "💻" },
  { slug: "cooking", name: "Кулинария", emoji: "🍳" },
  { slug: "dance", name: "Танцы", emoji: "💃" },
  { slug: "anime", name: "Аниме", emoji: "🌸" },
  { slug: "asmr", name: "ASMR", emoji: "🎧" },
  { slug: "science", name: "Наука", emoji: "🔬" },
];

/** Нормализация: нижний регистр + выкидываем всё, кроме букв (кириллицу оставляем). */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-zа-яё]/g, "");
}

/**
 * Поиск категории по slug ИЛИ имени (регистр и разделители не важны).
 * Легаси-значение «Just Chatting» → категория «Общение» (just-chatting).
 * Вернёт null, если ничего не подошло (в т.ч. для пустой строки).
 */
export function findCategory(value: string | null | undefined): Category | null {
  if (!value) return null;
  const q = normalize(value);
  if (!q) return null;
  return CATEGORIES.find((c) => normalize(c.slug) === q || normalize(c.name) === q) ?? null;
}
