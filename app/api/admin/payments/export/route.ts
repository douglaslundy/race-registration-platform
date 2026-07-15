import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { buildAdminPaymentOrderBy, buildAdminPaymentWhere, escapeCsvValue } from "@/lib/admin/payments";

export async function GET(req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("payments.export-all");
  if (!check.allowed) return check.response;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const status = searchParams.get("status")?.trim() ?? "";
  const method = searchParams.get("method")?.trim() ?? "";
  const dateFrom = searchParams.get("dateFrom")?.trim() ?? "";
  const dateTo = searchParams.get("dateTo")?.trim() ?? "";
  const sort = searchParams.get("sort")?.trim() ?? "createdAt";
  const dir = searchParams.get("dir")?.trim() ?? "desc";
  const where = buildAdminPaymentWhere({ q, status, method, dateFrom, dateTo });
  const orderBy = buildAdminPaymentOrderBy(sort, dir).orderBy;

  const payments = await db.payment.findMany({
    where,
    orderBy,
    include: {
      order: {
        select: {
          id: true,
          buyer: { select: { name: true, email: true } },
          registrations: { select: { event: { select: { title: true } } }, take: 1 },
        },
      },
    },
  });

  const header = ["Evento", "Comprador", "Email", "Método", "Status", "Valor", "Cadastro"].map(escapeCsvValue).join(",") + "\n";
  const rows = payments
    .map((payment) =>
      [
        payment.order.registrations[0]?.event.title ?? "—",
        payment.order.buyer.name,
        payment.order.buyer.email,
        payment.method,
        payment.status,
        payment.amount,
        payment.createdAt.toISOString(),
      ]
        .map(escapeCsvValue)
        .join(","),
    )
    .join("\n");

  return new NextResponse(header + rows, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="pagamentos.csv"',
    },
  });
}
