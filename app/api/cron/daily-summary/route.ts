import { NextRequest, NextResponse } from "next/server";
import {
  getYesterdayBrasiliaWindow,
  sendAdminDailySummaries,
  sendOrganizerDailySummaries,
  sendEventDailySummaries,
} from "@/lib/alerts/daily-summary";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { dayStart, dayEnd } = getYesterdayBrasiliaWindow();
  const [admins, organizers, events] = await Promise.all([
    sendAdminDailySummaries(dayStart, dayEnd),
    sendOrganizerDailySummaries(dayStart, dayEnd),
    sendEventDailySummaries(dayStart, dayEnd),
  ]);

  return NextResponse.json({
    adminsSent: admins.sent,
    adminsFailed: admins.failed,
    organizersSent: organizers.sent,
    organizersFailed: organizers.failed,
    eventsSent: events.sent,
    eventsFailed: events.failed,
  });
}
