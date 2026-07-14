import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkApiPermission } from "@/lib/auth/rbac";
import { buildAdminEventOrderBy, buildAdminEventWhere, escapeCsvValue } from "@/lib/admin/events";

export async function GET(req: NextRequest) {
  const check = await checkApiPermission("events.view");
  if (!check.allowed) return check.response;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const status = searchParams.get("status")?.trim() ?? "ALL";
  const modality = searchParams.get("modality")?.trim() ?? "ALL";
  const city = searchParams.get("city")?.trim() ?? "";
  const dateFrom = searchParams.get("dateFrom")?.trim() ?? "";
  const dateTo = searchParams.get("dateTo")?.trim() ?? "";
  const organizerId = searchParams.get("organizerId")?.trim() ?? "";
  const sort = searchParams.get("sort")?.trim() ?? "createdAt";
  const dir = searchParams.get("dir")?.trim() ?? "desc";

  const where = buildAdminEventWhere({ q, status, modality, city, dateFrom, dateTo, organizerId });
  const orderBy = buildAdminEventOrderBy(sort, dir).orderBy;

  const events = await db.event.findMany({
    where,
    orderBy,
    include: {
      organizer: { include: { user: { select: { name: true, email: true } } } },
      _count: { select: { registrations: true } },
      orders: { where: { status: "PAID" }, select: { totalAmount: true } },
    },
  });

  const header = ["Evento", "Slug", "Organizador", "Email", "Status", "Modalidade", "Cidade", "Data", "Inscrições", "Receita paga"]
    .map(escapeCsvValue)
    .join(",") + "\n";

  const rows = events
    .map((event) => {
      const revenue = event.orders.reduce((sum, order) => sum + order.totalAmount, 0);
      return [
        event.title,
        event.slug,
        event.organizer.user.name,
        event.organizer.user.email,
        event.status,
        event.modality,
        `${event.city}/${event.state}`,
        event.startAt.toISOString(),
        event._count.registrations,
        revenue,
      ]
        .map(escapeCsvValue)
        .join(",");
    })
    .join("\n");

  return new NextResponse(header + rows, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="eventos.csv"',
    },
  });
}
