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

// Кэш slug → база Owncast (60с, чтобы не дёргать БД на каждый сегмент)
const baseCache = new Map<string, { base: string; at: number }>();
const BASE_TTL_MS = 60_000;

async function resolveBase(slug: string): Promise<string> {
  const hit = baseCache.get(slug);
  if (hit && Date.now() - hit.at < BASE_TTL_MS) return hit.base;
  const channel = await db.channel.findUnique({ where: { slug }, select: { owncastBaseUrl: true } });
  const base = channel ? channelOwncastBase(channel) : OWNCast_BASE_URL;
  baseCache.set(slug, { base, at: Date.now() });
  return base;
}

async function proxy(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const rel = validatePath(path);
  if (!rel) {
    return NextResponse.json({ error: "bad_path", message: "Недопустимый путь HLS" }, { status: 400 });
  }

  // ── Гейт: поток открыт только подписчикам приватного канала и админам ──
  const user = await getSessionUser();
  if (!user || (!user.isSubscriber && user.role !== "ADMIN")) {
    return NextResponse.json(
      { error: "subscription_required", message: "Трансляция доступна платным подписчикам" },
      { status: 403 }
    );
  }

  const ch = req.nextUrl.searchParams.get("ch");
  const base = ch ? await resolveBase(ch) : OWNCast_BASE_URL;
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
