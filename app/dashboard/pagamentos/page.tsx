import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/format";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Histórico de Pagamentos" };

const METHOD_LABEL: Record<string, string> = {
  PIX: "Pix",
  CREDIT_CARD: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  BOLETO: "Boleto",
};

const STATUS_INFO: Record<string, { label: string; color: string }> = {
  PENDING: { label: "Aguardando", color: "bg-yellow-100 text-yellow-700" },
  PAID:    { label: "Pago", color: "bg-green-100 text-green-700" },
  EXPIRED: { label: "Expirado", color: "bg-gray-100 text-gray-600" },
  CANCELLED: { label: "Cancelado", color: "bg-red-100 text-red-600" },
  REFUNDED: { label: "Reembolsado", color: "bg-blue-100 text-blue-700" },
  CHARGEBACK: { label: "Chargeback", color: "bg-purple-100 text-purple-700" },
};

export default async function PagamentosPage() {
  const session = await requireAuth();

  const orders = await db.order.findMany({
    where: { buyerUserId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      registrations: {
        include: {
          event: { select: { title: true, slug: true } },
        },
        take: 1,
      },
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { method: true, status: true, paidAt: true },
      },
    },
  });

  const totalPaid = orders
    .filter((o) => o.status === "PAID")
    .reduce((sum, o) => sum + o.totalAmount, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Histórico de Pagamentos</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-sm text-gray-500 mb-1">Total pago</p>
          <p className="text-2xl font-bold text-primary-600">{formatCurrency(totalPaid)}</p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-gray-500 mb-1">Pedidos</p>
          <p className="text-2xl font-bold">{orders.length}</p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-gray-500 mb-1">Confirmados</p>
          <p className="text-2xl font-bold text-green-600">{orders.filter((o) => o.status === "PAID").length}</p>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-4xl mb-4">💳</p>
          <p className="text-gray-500 mb-4">Nenhum pagamento encontrado.</p>
          <Link href="/eventos" className="btn-primary">Explorar eventos</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const payment = order.payments[0];
            const reg = order.registrations[0];
            const statusInfo = STATUS_INFO[order.status] ?? STATUS_INFO.PENDING;

            return (
              <div key={order.id} className="card">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                      {payment?.method && (
                        <span className="text-xs text-gray-500">{METHOD_LABEL[payment.method] ?? payment.method}</span>
                      )}
                    </div>
                    <p className="font-semibold text-gray-900 truncate">
                      {reg?.event.title ?? "Evento não encontrado"}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Pedido #{order.id.slice(-8).toUpperCase()} · {formatDate(order.createdAt)}
                    </p>
                    {payment?.paidAt && (
                      <p className="text-xs text-green-600 mt-0.5">Pago em {formatDate(payment.paidAt)}</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-gray-900">{formatCurrency(order.totalAmount)}</p>
                    {order.discountAmount > 0 && (
                      <p className="text-xs text-green-600">Desconto: -{formatCurrency(order.discountAmount)}</p>
                    )}
                    {reg && (
                      <Link href={`/dashboard/inscricoes/${order.registrations[0]?.id}`}
                        className="text-xs text-primary-600 hover:underline mt-1 block">
                        Ver inscrição →
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
