import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const revalidate = 60;

export async function GET() {
  const events = await db.event.findMany({
    where: {
      status: { in: ["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT"] },
      bannerUrl: { not: null },
    },
    select: { id: true, title: true, slug: true, bannerUrl: true },
    orderBy: { startAt: "asc" },
    take: 10,
  });
  return NextResponse.json(events);
}
