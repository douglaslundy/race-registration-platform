import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("campaigns.view");
  if (!check.allowed) return check.response;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || undefined;
  const eventId = url.searchParams.get("eventId")?.trim() || undefined;

  const searchClause = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { athleteProfile: { phone: { contains: q, mode: "insensitive" as const } } },
        ],
      }
    : {};

  const where = {
    role: "ATHLETE" as const,
    active: true,
    receivePromotionalMessages: true,
    ...(eventId ? { registrations: { some: { eventId, status: "CONFIRMED" as const } } } : {}),
    ...searchClause,
  };

  const rows = await db.user.findMany({
    where,
    select: { id: true },
  });

  return NextResponse.json({ ids: rows.map((r) => r.id) });
}
