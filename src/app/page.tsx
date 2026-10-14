import { db } from "@/lib/db";
import { mapChannel } from "@/lib/channels";
import { getSessionUser, toPublicUser } from "@/lib/auth";
import { BackstageApp } from "@/components/backstage/backstage-app";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [channels, user] = await Promise.all([
    db.channel.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    getSessionUser(),
  ]);

  const isAdmin = user?.role === "ADMIN";

  return (
    <BackstageApp
      initialChannels={channels.map((c) => mapChannel(c, isAdmin))}
      initialUser={user ? toPublicUser(user) : null}
    />
  );
}
