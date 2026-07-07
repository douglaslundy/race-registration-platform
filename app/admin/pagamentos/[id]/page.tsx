import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Metadata } from "next";
import RefundPaymentButton from "@/components/admin/RefundPaymentButton";

export const metadata: Metadata = { title: "Detalhe do Pagamento — Admin" };
export const dynamic = "force-dynamic";

import { BADGE } from "@/lib/badge-colors";

const STATUS_COLOR: Record<string, string> = {
  PENDING:    BADGE.yellow,
  PAID:       BADGE.green,
  EXPIRED:    BADGE.gray,
  CANCELLED:  BADGE.red,
  REFUNDED:   BADGE.blue,
  CHARGEBACK: BADGE.purple,
};

const METHOD_LABEL: Record<string, string> = {
  PIX: "Pix",
  CREDIT_CARD: "Cartão de Crédito",
  DEBIT_CARD: "Débito",
  BOLETO: "Boleto",
};

export default async function AdminPaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const payment = await db.payment.findUnique({
    where: { id },
    include: {
      order: {
        include: {
          buyer: { select: { id: true, name: true, email: true } },
          registrations: {
            include: {
              event: { select: { id: true, title: true } },
              ticketBatch: { select: { name: true } },
            },
          },
          coupon: { select: { code: true } },
        },
      },
      refunds: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!payment) notFound();

  const order = payment.order;
  const reg = order.registrations[0];

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <Link href="/admin/pagamentos" className="text-sm text-gray-500 hover:text-primary-600">
          ← Pagamentos
        </Link>
        <Link
          href={`/api/admin/payments/${payment.id}/export`}
          className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          Exportar CSV
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Pagamento</h1>
          <p className="text-xs text-gray-400 font-mono mt-1">{payment.id}</p>
        </div>
        <span className={`text-sm px-3 py-1 rounded-full font-medium ${STATUS_COLOR[payment.status] ?? ""}`}>
          {payment.status}
        </span>
      </div>

      {/* Valores */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-primary-600">{formatCurrency(payment.amount)}</p>
          <p className="text-gray-500 text-xs mt-1">Valor</p>
        </div>
        <div className="card text-center">
          <p className="text-xl font-semibold">{METHOD_LABEL[payment.method] ?? payment.method}</p>
          <p className="text-gray-500 text-xs mt-1">Método</p>
        </div>
        <div className="card text-center">
          <p className="text-sm font-mono text-gray-700 dark:text-gray-300 truncate">{payment.provider}</p>
          <p className="text-gray-500 text-xs mt-1">Provedor</p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-gray-700 dark:text-gray-300">{payment.paidAt ? formatDate(payment.paidAt) : "—"}</p>
          <p className="text-gray-500 text-xs mt-1">Pago em</p>
        </div>
      </div>

      {/* Comprador e pedido */}
      <div className="card space-y-3">
        <h2 className="font-semibold">Comprador</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">{order.buyer.name}</p>
            <p className="text-sm text-gray-500">{order.buyer.email}</p>
          </div>
          <Link href={`/admin/usuarios/${order.buyer.id}`} className="text-sm text-primary-600 hover:underline">
            Ver usuário →
          </Link>
        </div>
      </div>

      {/* Inscrição */}
      {reg && (
        <div className="card space-y-3">
          <h2 className="font-semibold">Inscrição</h2>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Evento</span>
              <Link href={`/admin/eventos/${reg.event.id}`} className="font-medium text-primary-700 hover:underline">
                {reg.event.title}
              </Link>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Lote</span>
              <span>{reg.ticketBatch.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Status da inscrição</span>
              <span>{reg.status}</span>
            </div>
            {order.coupon && (
              <div className="flex justify-between">
                <span className="text-gray-500">Cupom aplicado</span>
                <span className="font-mono">{order.coupon.code}</span>
              </div>
            )}
          </div>
          <div className="border-t dark:border-gray-700 pt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Subtotal</span>
              <span>{formatCurrency(order.subtotalAmount)}</span>
            </div>
            {order.discountAmount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Desconto</span>
                <span>-{formatCurrency(order.discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-xs text-gray-400">
              <span>Taxa plataforma</span>
              <span>{formatCurrency(order.platformFeeAmount)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span>Taxa de serviço</span>
              <span>{formatCurrency(order.paymentFeeAmount)}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span>Total</span>
              <span>{formatCurrency(order.totalAmount)}</span>
            </div>
            {payment.gatewayFeeAmount != null && (
              <div className="flex justify-between text-xs text-gray-400 pt-1 border-t dark:border-gray-700">
                <span>Comissão do gateway (custo, não incluído no total)</span>
                <span>{formatCurrency(payment.gatewayFeeAmount)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* IDs técnicos */}
      <div className="card space-y-2 text-sm">
        <h2 className="font-semibold">Referências técnicas</h2>
        <div className="grid grid-cols-1 gap-1 font-mono text-xs text-gray-600 dark:text-gray-400">
          <div className="flex gap-2">
            <span className="text-gray-400 w-40 shrink-0">Payment ID</span>
            <span className="truncate">{payment.id}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-400 w-40 shrink-0">Provider Payment ID</span>
            <span className="truncate">{payment.providerPaymentId ?? "—"}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-400 w-40 shrink-0">Order ID</span>
            <span className="truncate">{payment.orderId}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-400 w-40 shrink-0">Idempotency Key</span>
            <span className="truncate">{payment.idempotencyKey}</span>
          </div>
          {payment.expiresAt && (
            <div className="flex gap-2">
              <span className="text-gray-400 w-40 shrink-0">Expira em</span>
              <span>{formatDate(payment.expiresAt)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Estornos */}
      {(payment.status === "PAID" || payment.refunds.length > 0) && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Estornos</h2>
            {payment.status === "PAID" && <RefundPaymentButton paymentId={payment.id} />}
          </div>
          {payment.refunds.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum estorno registrado.</p>
          ) : (
            payment.refunds.map((r) => (
              <div key={r.id} className="flex justify-between text-sm border-b dark:border-gray-700 pb-2 last:border-0">
                <span className="text-gray-600">{r.reason ?? "—"}</span>
                <span className="font-medium text-red-600">-{formatCurrency(r.amount)}</span>
                <span className="text-gray-400 text-xs">{r.processedAt ? formatDate(r.processedAt) : "Pendente"}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Raw Payload */}
      {payment.rawPayload && (
        <details className="card">
          <summary className="font-semibold cursor-pointer">Raw payload do gateway</summary>
          <pre className="mt-3 text-xs overflow-auto bg-gray-50 dark:bg-gray-800 p-3 rounded-lg max-h-64">
            {JSON.stringify(payment.rawPayload, null, 2)}
          </pre>
        </details>
      )}

      {/* Pix / Boleto info */}
      {payment.pixQrCodeText && (
        <div className="card space-y-2">
          <h2 className="font-semibold">Código Pix</h2>
          <div className="bg-gray-50 dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-3 font-mono text-xs break-all">
            {payment.pixQrCodeText}
          </div>
        </div>
      )}
      {payment.boletoUrl && (
        <div className="card">
          <a href={payment.boletoUrl} target="_blank" rel="noreferrer" className="btn-primary text-sm">
            Ver boleto →
          </a>
        </div>
      )}
    </div>
  );
}
