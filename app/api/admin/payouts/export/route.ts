import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildAdminPayoutOrderBy, buildAdminPayoutWhere, escapeCsvValue } from "@/lib/admin/payouts";
import { formatCurrency, formatDate } from "@/lib/format";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const status = searchParams.get("status")?.trim() ?? "";
  const event = searchParams.get("event")?.trim() ?? "";
  const organizer = searchParams.get("organizer")?.trim() ?? "";
  const dateFrom = searchParams.get("dateFrom")?.trim() ?? "";
  const dateTo = searchParams.get("dateTo")?.trim() ?? "";
  const sort = searchParams.get("sort")?.trim() ?? "createdAt";
  const dir = searchParams.get("dir")?.trim() ?? "desc";

  const where = buildAdminPayoutWhere({ q, status, event, organizer, dateFrom, dateTo });
  const orderBy = buildAdminPayoutOrderBy(sort, dir).orderBy;

  const payouts = await db.transferPayout.findMany({
    where,
    orderBy,
    include: {
      event: { select: { title: true } },
      organizer: { include: { user: { select: { name: true, email: true } } } },
    },
  });

  const header = [
    "Data",
    "Evento",
    "Organizador",
    "Email",
    "Bruto",
    "Taxa",
    "Líquido",
    "Status",
  ]
    .map(escapeCsvValue)
    .join(",") + "\n";

  const rows = payouts
    .map((payout) =>
      [
        formatDate(payout.createdAt),
        payout.event.title,
        payout.organizer.user.name,
        payout.organizer.user.email,
        formatCurrency(payout.grossAmount),
        formatCurrency(payout.platformFee),
        formatCurrency(payout.netAmount),
        payout.status,
      ]
        .map(escapeCsvValue)
        .join(","),
    )
    .join("\n");

  return new NextResponse(header + rows, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="repasses.csv"',
    },
  });
}
