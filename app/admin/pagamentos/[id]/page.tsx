import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Detalhe do Pagamento — Admin" };

const STATUS_COLOR: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-700",
  PAID: "bg-green-100 text-green-700",
  EXPIRED: "bg-gray-100 text-gray-500",
  CANCELLED: "bg-red-100 text-red-600",
  REFUNDED: "bg-blue-100 text-blue-700",
  CHARGEBACK: "bg-purple-100 text-purple-700",
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
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/pagamentos" className="text-sm text-gray-500 hover:text-primary-600">
          ← Pagamentos
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
          <p className="text-sm font-mono text-gray-700 truncate">{payment.provider}</p>
          <p className="text-gray-500 text-xs mt-1">Provedor</p>
        </div>
        <div className="card text-center">
          <p className="text-sm text-gray-700">{payment.paidAt ? formatDate(payment.paidAt) : "—"}</p>
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
          <div className="border-t pt-3 space-y-1 text-sm">
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
            <div className="flex justify-between font-bold">
              <span>Total</span>
              <span>{formatCurrency(order.totalAmount)}</span>
            </div>
          </div>
        </div>
      )}

      {/* IDs técnicos */}
      <div className="card space-y-2 text-sm">
        <h2 className="font-semibold">Referências técnicas</h2>
        <div className="grid grid-cols-1 gap-1 font-mono text-xs text-gray-600">
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
      {payment.refunds.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-semibold">Estornos</h2>
          {payment.refunds.map((r) => (
            <div key={r.id} className="flex justify-between text-sm border-b pb-2 last:border-0">
              <span className="text-gray-600">{r.reason ?? "—"}</span>
              <span className="font-medium text-red-600">-{formatCurrency(r.amount)}</span>
              <span className="text-gray-400 text-xs">{r.processedAt ? formatDate(r.processedAt) : "Pendente"}</span>
            </div>
          ))}
        </div>
      )}

      {/* Raw Payload */}
      {payment.rawPayload && (
        <details className="card">
          <summary className="font-semibold cursor-pointer">Raw payload do gateway</summary>
          <pre className="mt-3 text-xs overflow-auto bg-gray-50 p-3 rounded-lg max-h-64">
            {JSON.stringify(payment.rawPayload, null, 2)}
          </pre>
        </details>
      )}

      {/* Pix / Boleto info */}
      {payment.pixQrCodeText && (
        <div className="card space-y-2">
          <h2 className="font-semibold">Código Pix</h2>
          <div className="bg-gray-50 border rounded-lg p-3 font-mono text-xs break-all">
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
