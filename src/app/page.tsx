import { db } from "@/lib/db";
import { mapChannel } from "@/lib/channels";
import { getSessionUser, toPublicUser } from "@/lib/auth";
import { mergeChannelsWithOwncast } from "@/lib/owncast";
import { BackstageApp } from "@/components/backstage/backstage-app";
import { ChatOverlay } from "@/components/backstage/chat-overlay";

export const dynamic = "force-dynamic";

/** Число из query-параметра с clamp-ом (для оверлея: scale/limit) */
function clampNum(v: string | string[] | undefined, def: number, min: number, max: number): number {
  const n = typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // ?overlay=chat — оверлей чата для OBS (Browser Source): прозрачная
  // страница только с чатом. Параметры: channel (slug), scale (0.5–3),
  // limit (5–50). Основное приложение при этом НЕ рендерится.
  if (sp.overlay === "chat") {
    const channels = await db.channel.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { slug: true, isLive: true },
    });
    const wanted = typeof sp.channel === "string" ? sp.channel : null;
    const slug = channels.some((c) => c.slug === wanted)
      ? wanted
      : (channels.find((c) => c.isLive)?.slug ?? channels[0]?.slug ?? null);
    if (!slug) return null;
    return (
      <>
        {/* Прозрачный фон с первого кадра — OBS не должен увидеть «графит» */}
        <style
          dangerouslySetInnerHTML={{
            __html: "html,body{background:transparent !important;overflow:hidden !important}",
          }}
        />
        <ChatOverlay
          channelSlug={slug}
          scale={clampNum(sp.scale, 1, 0.5, 3)}
          limit={Math.round(clampNum(sp.limit, 20, 5, 50))}
        />
      </>
    );
  }

  const [channels, user] = await Promise.all([
    db.channel.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    getSessionUser(),
  ]);

  const isAdmin = user?.role === "ADMIN";
  const merged = await mergeChannelsWithOwncast(channels.map((c) => mapChannel(c, isAdmin)));

  return (
    <BackstageApp
      initialChannels={merged}
      initialUser={user ? toPublicUser(user) : null}
    />
  );
}
