// Реестр Telegram-каналов платных подписок (админ).
// Пул, из которого в пульте эфира выбирается «какой ТГК должен быть
// в подписках у зрителя» для приватного эфира.
//
// GET    /api/admin/telegram-channels          — список
// POST   /api/admin/telegram-channels          — добавить { title, chatId, link }
// DELETE /api/admin/telegram-channels?id=…     — удалить

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function mapRow(r: { id: string; title: string; chatId: string; link: string | null; note: string | null }) {
  return { id: r.id, title: r.title, chatId: r.chatId, link: r.link, note: r.note };
}

export async function GET() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden", message: "Только администратор" }, { status: 403 });
  }
  const rows = await db.telegramChannel.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json({ telegramChannels: rows.map(mapRow) });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden", message: "Только администратор" }, { status: 403 });
  }
  let body: { title?: string; chatId?: string; link?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const title = (body.title ?? "").trim().slice(0, 60);
  if (title.length < 2) {
    return NextResponse.json({ error: "bad_title", message: "Укажите название канала" }, { status: 400 });
  }
  const chatId = (body.chatId ?? "").trim().slice(0, 60);
  if (chatId && !/^-?\d+$/.test(chatId) && !chatId.startsWith("@")) {
    return NextResponse.json(
      { error: "bad_chat_id", message: "chatId: числовой id канала или @username" },
      { status: 400 }
    );
  }
  const link = (body.link ?? "").trim().slice(0, 120) || null;
  if (link && !/^https?:\/\//.test(link)) {
    return NextResponse.json({ error: "bad_link", message: "Ссылка должна начинаться с http(s)://" }, { status: 400 });
  }
  const row = await db.telegramChannel.create({ data: { title, chatId, link } });
  return NextResponse.json({ telegramChannel: mapRow(row) });
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden", message: "Только администратор" }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  try {
    await db.telegramChannel.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
