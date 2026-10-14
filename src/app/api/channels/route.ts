import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { mapChannel } from "@/lib/channels";

export const dynamic = "force-dynamic";

/** GET /api/channels — список каналов (админам — с streamKey) */
export async function GET() {
  const user = await getSessionUser();
  const isAdmin = user?.role === "ADMIN";
  const channels = await db.channel.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json({ channels: channels.map((c) => mapChannel(c, isAdmin)) });
}

/** POST /api/channels — создание канала (только админ): поддержка нескольких авторов */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden", message: "Только администратор" }, { status: 403 });
  }

  let body: {
    name?: string;
    handle?: string;
    slug?: string;
    tagline?: string;
    description?: string;
    avatarUrl?: string;
    telegramChatId?: string;
    telegramLink?: string;
    accentColor?: string;
    hlsUrl?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (name.length < 2) {
    return NextResponse.json({ error: "bad_name", message: "Название канала слишком короткое" }, { status: 400 });
  }

  const slug =
    (body.slug ?? body.handle ?? name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || `ch-${Date.now()}`;

  const exists = await db.channel.findFirst({ where: { OR: [{ slug }, { handle: slug }] } });
  if (exists) {
    return NextResponse.json({ error: "exists", message: "Канал с таким slug уже существует" }, { status: 409 });
  }

  const max = await db.channel.findFirst({ orderBy: { sortOrder: "desc" } });
  const channel = await db.channel.create({
    data: {
      slug,
      name,
      handle: (body.handle ?? slug).replace(/^@/, "").slice(0, 32),
      tagline: body.tagline?.slice(0, 80) ?? null,
      description: body.description?.slice(0, 500) ?? null,
      avatarUrl: body.avatarUrl ?? null,
      telegramChatId: body.telegramChatId ?? null,
      telegramLink: body.telegramLink ?? null,
      accentColor: body.accentColor ?? "#a970ff",
      hlsUrl: body.hlsUrl ?? null,
      sortOrder: (max?.sortOrder ?? 0) + 1,
    },
  });

  return NextResponse.json({ channel: mapChannel(channel, true) }, { status: 201 });
}
