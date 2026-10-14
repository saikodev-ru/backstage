import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/content?type=clips|recordings|schedule|collabs[&channel=slug]
 * Контент-секции: клипы, записи, расписание, коллаборации (пока — витрина-заглушки).
 */
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") ?? "";
  const channel = req.nextUrl.searchParams.get("channel") ?? undefined;

  switch (type) {
    case "clips": {
      const items = await db.clip.findMany({
        where: channel ? { channelSlug: channel } : undefined,
        orderBy: { createdAt: "desc" },
        take: 24,
      });
      return NextResponse.json({ clips: items });
    }
    case "recordings": {
      const items = await db.recording.findMany({
        where: channel ? { channelSlug: channel } : undefined,
        orderBy: { createdAt: "desc" },
        take: 24,
      });
      return NextResponse.json({ recordings: items });
    }
    case "schedule": {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const items = await db.scheduleEntry.findMany({
        where: {
          ...(channel ? { channelSlug: channel } : {}),
          startsAt: { gte: from },
        },
        orderBy: { startsAt: "asc" },
        take: 30,
      });
      return NextResponse.json({ schedule: items });
    }
    case "collabs": {
      const rows = await db.collab.findMany({ orderBy: { createdAt: "desc" }, take: 12 });
      const items = rows.map((c) => {
        let members: Array<{ slug: string; name: string; avatarUrl: string | null; role: string }> = [];
        try {
          const parsed = JSON.parse(c.members);
          if (Array.isArray(parsed)) members = parsed;
        } catch {
          members = [];
        }
        return {
          id: c.id,
          title: c.title,
          description: c.description,
          members,
          status: (c.status === "confirmed" || c.status === "planning" ? c.status : "idea") as
            | "idea"
            | "planning"
            | "confirmed",
          plannedAt: c.plannedAt ? c.plannedAt.toISOString() : null,
        };
      });
      return NextResponse.json({ collabs: items });
    }
    default:
      return NextResponse.json({ error: "unknown_type" }, { status: 400 });
  }
}
