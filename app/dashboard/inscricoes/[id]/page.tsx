import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { formatCurrency, formatDate } from "@/lib/format";
import Link from "next/link";
import PaymentStatusPoller from "@/components/dashboard/PaymentStatusPoller";
import CancelRegistrationButton from "@/components/dashboard/CancelRegistrationButton";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Detalhe da Inscrição" };

const STATUS_INFO: Record<string, { label: string; color: string; icon: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: "⏳" },
  CONFIRMED:       { label: "Inscrição confirmada", color: "bg-green-100 text-green-800 border-green-200", icon: "✅" },
  CANCELLED:       { label: "Inscrição cancelada", color: "bg-red-100 text-red-800 border-red-200", icon: "❌" },
  TRANSFERRED:     { label: "Inscrição transferida", color: "bg-blue-100 text-blue-800 border-blue-200", icon: "🔄" },
  WAITLISTED:      { label: "Lista de espera", color: "bg-gray-100 text-gray-800 border-gray-200", icon: "🕐" },
};

export default async function InscricaoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id, athleteUserId: session.user.id },
    include: {
      event: {
        select: {
          title: true, slug: true, startAt: true, kitPickupAt: true,
          venueName: true, addressLine: true, city: true, state: true,
          organizerContact: true,
        },
      },
      route: { select: { name: true, distanceKm: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true, priceAmount: true } },
      order: {
        select: { id: true, status: true, totalAmount: true, discountAmount: true, platformFeeAmount: true },
      },
    },
  });

  if (!registration) notFound();

  const payment = await db.payment.findFirst({
    where: { orderId: registration.order.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, method: true, status: true, pixQrCodeText: true, boletoUrl: true, expiresAt: true, paidAt: true },
  });

  const statusInfo = STATUS_INFO[registration.status] ?? STATUS_INFO.PENDING_PAYMENT;
  const isPending = registration.status === "PENDING_PAYMENT";
  const isConfirmed = registration.status === "CONFIRMED";
  const canCancel = isConfirmed && new Date(registration.event.startAt) > new Date();

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/dashboard/inscricoes" className="hover:text-primary-600">← Minhas inscrições</Link>
      </div>

      <div className={`border rounded-xl p-4 flex items-center gap-3 ${statusInfo.color}`}>
        <span className="text-2xl">{statusInfo.icon}</span>
        <div>
          <p className="font-semibold">{statusInfo.label}</p>
          {registration.bibNumber && (
            <p className="text-sm mt-0.5">Número de peito: <strong>#{registration.bibNumber}</strong></p>
          )}
        </div>
      </div>

      {isPending && payment && (
        <PaymentStatusPoller orderId={registration.order.id} />
      )}

      {isPending && payment?.method === "PIX" && (payment as { pixQrCodeText?: string | null }).pixQrCodeText && (
        <div className="card space-y-3">
          <h3 className="font-semibold text-gray-900">Pague via Pix</h3>
          <p className="text-sm text-gray-600">Copie o código abaixo e cole no app do seu banco:</p>
          <div className="bg-gray-50 border rounded-lg p-3 font-mono text-xs break-all select-all">
            {(payment as { pixQrCodeText?: string | null }).pixQrCodeText}
          </div>
          <button
            onClick={() => navigator.clipboard.writeText((payment as { pixQrCodeText?: string | null }).pixQrCodeText ?? "")}
            className="btn-secondary w-full text-sm"
          >
            Copiar código Pix
          </button>
          {(payment as { expiresAt?: Date | null }).expiresAt && (
            <p className="text-xs text-gray-500 text-center">
              Expira em: {new Date((payment as { expiresAt?: Date | null }).expiresAt!).toLocaleString("pt-BR")}
            </p>
          )}
        </div>
      )}

      {isPending && payment?.method === "BOLETO" && (payment as { boletoUrl?: string | null }).boletoUrl && (
        <div className="card text-center space-y-3">
          <h3 className="font-semibold">Boleto bancário</h3>
          <a href={(payment as { boletoUrl?: string | null }).boletoUrl!} target="_blank" rel="noreferrer" className="btn-primary block">
            Abrir boleto
          </a>
        </div>
      )}

      <div className="card space-y-4">
        <h3 className="font-semibold text-gray-900">Dados do evento</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between py-1 border-b">
            <span className="text-gray-500">Evento</span>
            <span className="font-medium text-right">{registration.event.title}</span>
          </div>
          <div className="flex justify-between py-1 border-b">
            <span className="text-gray-500">Data</span>
            <span>{formatDate(registration.event.startAt)}</span>
          </div>
          <div className="flex justify-between py-1 border-b">
            <span className="text-gray-500">Local</span>
            <span className="text-right">{registration.event.venueName}, {registration.event.city}/{registration.event.state}</span>
          </div>
          {registration.event.kitPickupAt && (
            <div className="flex justify-between py-1 border-b">
              <span className="text-gray-500">Retirada de kit</span>
              <span>{formatDate(registration.event.kitPickupAt)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="card space-y-4">
        <h3 className="font-semibold text-gray-900">Dados da inscrição</h3>
        <div className="space-y-2 text-sm">
          {registration.route && (
            <div className="flex justify-between py-1 border-b">
              <span className="text-gray-500">Percurso</span>
              <span>{registration.route.name} ({registration.route.distanceKm}km)</span>
            </div>
          )}
          {registration.category && (
            <div className="flex justify-between py-1 border-b">
              <span className="text-gray-500">Categoria</span>
              <span>{registration.category.name}</span>
            </div>
          )}
          {registration.shirtSize && (
            <div className="flex justify-between py-1 border-b">
              <span className="text-gray-500">Camiseta</span>
              <span>{registration.shirtSize}</span>
            </div>
          )}
          {registration.teamName && (
            <div className="flex justify-between py-1 border-b">
              <span className="text-gray-500">Equipe</span>
              <span>{registration.teamName}</span>
            </div>
          )}
          <div className="flex justify-between py-1 border-b">
            <span className="text-gray-500">Lote</span>
            <span>{registration.ticketBatch.name}</span>
          </div>
        </div>
      </div>

      <div className="card space-y-3">
        <h3 className="font-semibold text-gray-900">Resumo financeiro</h3>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Subtotal</span>
            <span>{formatCurrency(registration.ticketBatch.priceAmount)}</span>
          </div>
          {registration.order.discountAmount > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Desconto</span>
              <span>- {formatCurrency(registration.order.discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-gray-900 pt-2 border-t">
            <span>Total pago</span>
            <span>{formatCurrency(registration.order.totalAmount)}</span>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <Link href={`/eventos/${registration.event.slug}`} className="btn-secondary flex-1 text-center text-sm">
          Ver página do evento
        </Link>
        {canCancel && (
          <CancelRegistrationButton registrationId={registration.id} />
        )}
      </div>
    </div>
  );
}
