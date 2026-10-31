import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncRating } from "@/lib/rating";

// Passagem retroativa e diária: recalcula o rating de todos os atletas e organizadores.
export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected || req.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const users = await db.user.findMany({ where: { role: { in: ["ATHLETE", "ORGANIZER"] } }, select: { id: true } });
  let failed = 0;
  for (const u of users) {
    try {
      await syncRating(u.id);
    } catch (err) {
      failed++;
      console.error("[rating-sync] falhou", u.id, err);
    }
  }
  return NextResponse.json({ processed: users.length, failed });
}
