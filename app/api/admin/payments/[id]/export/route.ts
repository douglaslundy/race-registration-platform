import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { escapeCsvValue } from "@/lib/admin/payments";
import { formatCurrency, formatDate } from "@/lib/format";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const payment = await db.payment.findUnique({
    where: { id },
    include: {
      order: {
        include: {
          buyer: { select: { name: true, email: true } },
          registrations: { include: { event: { select: { title: true } } } },
          coupon: { select: { code: true } },
        },
      },
      refunds: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!payment) {
    return NextResponse.json({ error: "Pagamento não encontrado" }, { status: 404 });
  }

  const lines: Array<[string, string]> = [
    ["Payment ID", payment.id],
    ["Order ID", payment.orderId],
    ["Status", payment.status],
    ["Método", payment.method],
    ["Valor", formatCurrency(payment.amount)],
    ["Provedor", payment.provider],
    ["Provedor Payment ID", payment.providerPaymentId ?? ""],
    ["Idempotency Key", payment.idempotencyKey],
    ["Pago em", payment.paidAt ? formatDate(payment.paidAt) : ""],
    ["Expira em", payment.expiresAt ? formatDate(payment.expiresAt) : ""],
    ["Comprador", payment.order.buyer.name],
    ["Email", payment.order.buyer.email],
    ["Cupom", payment.order.coupon?.code ?? ""],
    ["Eventos", payment.order.registrations.map((reg) => reg.event.title).join(" | ")],
    ["Total do pedido", formatCurrency(payment.order.totalAmount)],
    ["Subtotal", formatCurrency(payment.order.subtotalAmount)],
    ["Desconto", formatCurrency(payment.order.discountAmount)],
    ["Taxa plataforma", formatCurrency(payment.order.platformFeeAmount)],
  ];

  if (payment.refunds.length > 0) {
    payment.refunds.forEach((refund, index) => {
      lines.push([`Estorno ${index + 1}`, `${formatCurrency(refund.amount)} - ${refund.reason ?? ""}`]);
    });
  }

  const csv = [["Campo", "Valor"], ...lines].map(([label, value]) => `${escapeCsvValue(label)},${escapeCsvValue(value)}`).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pagamento-${id}.csv"`,
    },
  });
}
