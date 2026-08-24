import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

const PAGE_SIZE = 20;

export async function GET(req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("campaigns.view");
  if (!check.allowed) return check.response;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || undefined;
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);

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
    ...searchClause,
  };

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      select: { id: true, name: true, email: true, athleteProfile: { select: { phone: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.user.count({ where }),
  ]);

  return NextResponse.json({
    rows: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.athleteProfile?.phone ?? null })),
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
