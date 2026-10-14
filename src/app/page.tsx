import { db } from "@/lib/db";
import { mapChannel } from "@/lib/channels";
import { getSessionUser, toPublicUser } from "@/lib/auth";
import { mergeChannelsWithOwncast } from "@/lib/owncast";
import { BackstageApp } from "@/components/backstage/backstage-app";

export const dynamic = "force-dynamic";

export default async function Page() {
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
