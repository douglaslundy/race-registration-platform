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

  const where = q ? { title: { contains: q, mode: "insensitive" as const } } : {};

  const [rows, total] = await Promise.all([
    db.event.findMany({
      where,
      select: { id: true, title: true },
      orderBy: { title: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.event.count({ where }),
  ]);

  return NextResponse.json({
    rows,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
