import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapChannel } from "@/lib/channels";
import type { ClipDto, PublicChannel, RecordingDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Кейс-инсенсивное вхождение (SQLite LIKE не ищет кириллицу без учёта регистра) */
function matches(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle);
}

/**
 * GET /api/search?q= — глобальный поиск по каналам, клипам и записям.
 * Фильтрация выполняется в JS (lowercase includes): корректно для кириллицы.
 * Группы: каналы (по name/handle, публичный маппинг без streamKey),
 * клипы и записи (по title), лимит 5 на группу, сортировка createdAt desc.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const empty = { channels: [] as PublicChannel[], clips: [] as ClipDto[], recordings: [] as RecordingDto[] };
  if (q.length < 2) return NextResponse.json(empty);

  const [channels, clips, recordings] = await Promise.all([
    db.channel.findMany(),
    db.clip.findMany(),
    db.recording.findMany(),
  ]);

  const matchedChannels = channels
    .filter((c) => matches(c.name, q) || matches(c.handle, q))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5)
    .map((c) => mapChannel(c, false));

  const matchedClips = clips
    .filter((c) => matches(c.title, q))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5)
    .map<ClipDto>((c) => ({
      id: c.id,
      channelSlug: c.channelSlug,
      title: c.title,
      thumbnailUrl: c.thumbnailUrl,
      durationSec: c.durationSec,
      views: c.views,
      createdAt: c.createdAt.toISOString(),
    }));

  const matchedRecordings = recordings
    .filter((r) => matches(r.title, q))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5)
    .map<RecordingDto>((r) => ({
      id: r.id,
      channelSlug: r.channelSlug,
      title: r.title,
      thumbnailUrl: r.thumbnailUrl,
      durationSec: r.durationSec,
      views: r.views,
      createdAt: r.createdAt.toISOString(),
    }));

  return NextResponse.json({
    channels: matchedChannels,
    clips: matchedClips,
    recordings: matchedRecordings,
  });
}
