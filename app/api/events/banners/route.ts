import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const events = await db.event.findMany({
    where: {
      status: { in: ["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT"] },
      OR: [{ bannerUrl: { not: null } }, { listBannerUrl: { not: null } }],
    },
    select: { id: true, title: true, slug: true, bannerUrl: true, listBannerUrl: true },
    orderBy: { startAt: "asc" },
    take: 10,
  });
  return NextResponse.json(events.map((event) => ({
    ...event,
    bannerUrl: event.bannerUrl ?? event.listBannerUrl ?? "",
  })));
}
