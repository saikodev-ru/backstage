// HLS-прокси «Бэкстейдж»: браузер тянет поток через Next.js (единый внешний
// порт, без CORS), а доступ — только у платных подписчиков.
//
//   hls.js → /api/stream/hls/stream.m3u8 [?ch=slug]
//            → http://<owncast>/hls/stream.m3u8
//            → варианты 0/stream.m3u8, сегменты .ts — те же относительные пути
//
// Owncast отдаёт относительные ссылки в плейлистах, поэтому прозрачный прокси
// сохраняет структуру путей и сегменты резолвятся в этот же роут.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { OWNCast_BASE_URL, channelOwncastBase } from "@/lib/owncast";
import { viewerCanWatch } from "@/lib/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

// Разрешённые части пути: каталог варианта ("0", "1"…) и файлы .m3u8/.ts/.m4s
const ALLOWED_EXT = new Set([".m3u8", ".ts", ".m4s"]);

function validPart(p: string): boolean {
  if (!p || p.length > 64) return false;
  const dot = p.lastIndexOf(".");
  if (dot === -1) return /^[a-zA-Z0-9_-]+$/.test(p); // каталог варианта
  const name = p.slice(0, dot);
  const ext = p.slice(dot);
  return name.length > 0 && /^[a-zA-Z0-9_-]+$/.test(name) && ALLOWED_EXT.has(ext);
}

function validatePath(parts: string[]): string | null {
  if (parts.length === 0 || parts.length > 2) return null;
  if (parts.some((p) => !validPart(p))) return null;
  const last = parts[parts.length - 1];
  if (!ALLOWED_EXT.has(last.slice(last.lastIndexOf(".")))) return null;
  return parts.join("/");
}

// Кэш slug → { base, access, requiredChat, at } (60с, чтобы не дёргать БД на каждый сегмент)
const baseCache = new Map<
  string,
  { base: string; access: "public" | "private"; requiredTelegramChatId: string | null; at: number }
>();
const BASE_TTL_MS = 60_000;

type ChannelGate = {
  base: string;
  access: "public" | "private";
  requiredTelegramChatId: string | null;
};

async function resolveChannel(slug: string): Promise<ChannelGate> {
  const hit = baseCache.get(slug);
  if (hit && Date.now() - hit.at < BASE_TTL_MS) return hit;
  const channel = await db.channel.findUnique({
    where: { slug },
    select: { owncastBaseUrl: true, access: true, requiredTelegramChatId: true },
  });
  const resolved: ChannelGate = channel
    ? {
        base: channelOwncastBase(channel),
        access: channel.access === "public" ? "public" : "private",
        requiredTelegramChatId: channel.requiredTelegramChatId ?? null,
      }
    : { base: OWNCast_BASE_URL, access: "private", requiredTelegramChatId: null };
  baseCache.set(slug, { ...resolved, at: Date.now() });
  return resolved;
}

async function defaultChannel(): Promise<ChannelGate> {
  const channel = await db.channel.findFirst({
    orderBy: { sortOrder: "asc" },
    select: { slug: true, owncastBaseUrl: true, access: true, requiredTelegramChatId: true },
  });
  if (!channel) return { base: OWNCast_BASE_URL, access: "private", requiredTelegramChatId: null };
  return resolveChannel(channel.slug);
}

async function proxy(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const rel = validatePath(path);
  if (!rel) {
    return NextResponse.json({ error: "bad_path", message: "Недопустимый путь HLS" }, { status: 400 });
  }

  // ── Гейт: public-эфир открыт всем; private — только платным подписчикам ──
  const ch = req.nextUrl.searchParams.get("ch");
  const gate = ch ? await resolveChannel(ch) : await defaultChannel();

  if (gate.access === "private") {
    const user = await getSessionUser();
    const allowed = await viewerCanWatch(user, gate);
    if (!user || !allowed) {
      return NextResponse.json(
        { error: "subscription_required", message: "Трансляция доступна платным подписчикам" },
        { status: 403 }
      );
    }
  }

  const base = gate.base;
  const upstream = `${base}/hls/${rel}`;

  try {
    const res = await fetch(upstream, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      cache: "no-store",
      headers: { accept: "*/*" },
      signal: AbortSignal.timeout(15_000),
    });

    const headers = new Headers();
    const ct = res.headers.get("content-type");
    // Owncast отдаёт .ts с неверным MIME (Qt Linguist) — чиним для плееров
    if (ct) headers.set("content-type", rel.endsWith(".ts") ? "video/mp2t" : ct);
    // Плейлисты — всегда свежие; сегменты пусть браузер кэширует недолго
    headers.set("cache-control", rel.endsWith(".m3u8") ? "no-store" : "public, max-age=6");
    const len = res.headers.get("content-length");
    if (len) headers.set("content-length", len);
    if (res.headers.get("accept-ranges")) headers.set("accept-ranges", res.headers.get("accept-ranges")!);

    return new Response(res.status === 204 || req.method === "HEAD" ? null : res.body, {
      status: res.status,
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: "engine_unreachable", message: "Стриминг-движок недоступен" },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx);
}

export async function HEAD(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx);
}
