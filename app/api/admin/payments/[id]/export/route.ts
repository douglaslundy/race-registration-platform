import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { escapeCsvValue } from "@/lib/admin/payments";
import { formatCurrency, formatDate } from "@/lib/format";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("payments.export");
  if (!check.allowed) return check.response;

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

  if (!payment.order || !payment.orderId) {
    // Este endpoint só exporta pagamentos vinculados a um Order (checkout). Se um pagamento de
    // AdPurchase chegar aqui, falha explicitamente em vez de exportar dados incompletos.
    return NextResponse.json({ error: "Pagamento sem pedido associado" }, { status: 500 });
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
    ...(payment.order.pixDiscountAmount > 0
      ? ([
          ["Taxa de serviço (original)", formatCurrency(payment.order.serviceFeeOriginalAmount)],
          ["Desconto PIX na Taxa de Serviço", `-${formatCurrency(payment.order.pixDiscountAmount)}`],
          ["Desconto PIX (%)", `${payment.order.pixDiscountPercent}%`],
          ["Taxa de serviço (líquida)", formatCurrency(payment.order.paymentFeeAmount)],
        ] as Array<[string, string]>)
      : ([["Taxa de serviço", formatCurrency(payment.order.paymentFeeAmount)]] as Array<[string, string]>)),
    ["Comissão do gateway", payment.gatewayFeeAmount != null ? formatCurrency(payment.gatewayFeeAmount) : ""],
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
