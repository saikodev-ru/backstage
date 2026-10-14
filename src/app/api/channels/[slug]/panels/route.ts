import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import type { ChannelPanelDto } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/** Маппинг строки БД в DTO (null-поля проходят как есть) */
function toPanelDto(p: {
  id: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  link: string | null;
  linkLabel: string | null;
  sortOrder: number;
}): ChannelPanelDto {
  return {
    id: p.id,
    title: p.title,
    body: p.body,
    imageUrl: p.imageUrl,
    link: p.link,
    linkLabel: p.linkLabel,
    sortOrder: p.sortOrder,
  };
}

/** GET /api/channels/[slug]/panels — публичные панели «О канале» */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  const channel = await db.channel.findUnique({ where: { slug } });
  if (!channel) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const rows = await db.channelPanel.findMany({
    where: { channelSlug: slug },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ panels: rows.map(toPanelDto) });
}

/**
 * PUT /api/channels/[slug]/panels — редактор панелей автора (админ).
 * Полная замена: старые панели удаляются, новые создаются с sortOrder = индекс.
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden", message: "Только администратор" }, { status: 403 });
  }

  const { slug } = await ctx.params;
  const channel = await db.channel.findUnique({ where: { slug } });
  if (!channel) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: { panels?: Array<{ title?: string; body?: string | null; imageUrl?: string | null; link?: string | null; linkLabel?: string | null }> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const items = Array.isArray(body.panels) ? body.panels : [];
  if (items.length > 20) {
    return NextResponse.json({ error: "too_many", message: "Не больше 20 панелей" }, { status: 400 });
  }

  // Валидация и нормализация
  const data: Array<{
    title: string;
    body: string | null;
    imageUrl: string | null;
    link: string | null;
    linkLabel: string | null;
  }> = [];
  for (const p of items) {
    const title = typeof p?.title === "string" ? p.title.trim() : "";
    if (title.length < 1 || title.length > 60) {
      return NextResponse.json({ error: "bad_title", message: "Название панели: 1–60 символов" }, { status: 400 });
    }
    const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
    const panelBody = text(p?.body);
    const imageUrl = text(p?.imageUrl);
    const link = text(p?.link);
    const linkLabel = text(p?.linkLabel);
    if (panelBody && panelBody.length > 1000) {
      return NextResponse.json({ error: "bad_body", message: "Текст панели: не больше 1000 символов" }, { status: 400 });
    }
    if (imageUrl && imageUrl.length > 500) {
      return NextResponse.json({ error: "bad_image", message: "Ссылка на картинку: не больше 500 символов" }, { status: 400 });
    }
    if (link && link.length > 500) {
      return NextResponse.json({ error: "bad_link", message: "Ссылка: не больше 500 символов" }, { status: 400 });
    }
    if (linkLabel && linkLabel.length > 40) {
      return NextResponse.json({ error: "bad_link_label", message: "Подпись ссылки: не больше 40 символов" }, { status: 400 });
    }
    data.push({ title, body: panelBody, imageUrl, link, linkLabel });
  }

  // Полная замена: удаляем и создаём заново (sortOrder = индекс в массиве)
  await db.channelPanel.deleteMany({ where: { channelSlug: slug } });
  for (let i = 0; i < data.length; i++) {
    await db.channelPanel.create({ data: { ...data[i], channelSlug: slug, sortOrder: i } });
  }

  const rows = await db.channelPanel.findMany({
    where: { channelSlug: slug },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ panels: rows.map(toPanelDto) });
}
