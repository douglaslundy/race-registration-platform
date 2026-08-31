import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { formatCurrency, formatDate, formatDateOnly } from "@/lib/format";
import Link from "next/link";
import PaymentStatusPoller from "@/components/dashboard/PaymentStatusPoller";
import CancelRegistrationButton from "@/components/dashboard/CancelRegistrationButton";
import EditMyRegistrationButton from "@/components/dashboard/EditMyRegistrationButton";
import PixPaymentCard from "@/components/dashboard/PixPaymentCard";
import { getCancellationPolicyEnabled } from "@/lib/settings";
import QRCode from "react-qr-code";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Detalhe da Inscrição" };

import { BADGE } from "@/lib/badge-colors";

const STATUS_INFO: Record<string, { label: string; color: string; icon: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: `${BADGE.yellow} border border-yellow-200 dark:border-yellow-800`, icon: "⏳" },
  CONFIRMED:       { label: "Inscrição confirmada", color: `${BADGE.green} border border-green-200 dark:border-green-800`, icon: "✅" },
  CANCELLED:       { label: "Inscrição cancelada", color: `${BADGE.red} border border-red-200 dark:border-red-800`, icon: "❌" },
  TRANSFERRED:     { label: "Inscrição transferida", color: `${BADGE.blue} border border-blue-200 dark:border-blue-800`, icon: "🔄" },
  WAITLISTED:      { label: "Lista de espera", color: `${BADGE.gray} border border-gray-200 dark:border-gray-600`, icon: "🕐" },
  CANCELLATION_REQUESTED: { label: "Cancelamento solicitado", color: `${BADGE.orange} border border-orange-200 dark:border-orange-800`, icon: "🕓" },
};

export default async function InscricaoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: {
      id,
      OR: [{ athleteUserId: session.user.id }, { order: { buyerUserId: session.user.id } }],
    },
    include: {
      event: {
        select: {
          title: true, slug: true, startAt: true, kitPickupAt: true,
          venueName: true, addressLine: true, city: true, state: true,
          organizerContact: true, cancellationDeadline: true, cancellationRequiresApproval: true,
          registrationEditDeadline: true,
        },
      },
      route: { select: { name: true, distanceKm: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true, priceAmount: true } },
      order: {
        select: {
          id: true,
          status: true,
          totalAmount: true,
          discountAmount: true,
          platformFeeAmount: true,
          paymentFeeAmount: true,
          serviceFeeOriginalAmount: true,
          pixDiscountAmount: true,
          buyerUserId: true,
        },
      },
    },
  });

  if (!registration) notFound();

  const createdByMeForOther = registration.order.buyerUserId === session.user.id && registration.athleteUserId !== session.user.id;

  const payment = await db.payment.findFirst({
    where: { orderId: registration.order.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, method: true, status: true, pixQrCodeText: true, boletoUrl: true, expiresAt: true, paidAt: true },
  });

  const statusInfo = STATUS_INFO[registration.status] ?? STATUS_INFO.PENDING_PAYMENT;
  const isPending = registration.status === "PENDING_PAYMENT";
  const isConfirmed = registration.status === "CONFIRMED";
  const policyEnabled = await getCancellationPolicyEnabled();
  const deadlinePassed = Boolean(
    policyEnabled && registration.event.cancellationDeadline && new Date(registration.event.cancellationDeadline) <= new Date(),
  );
  const requiresApproval = policyEnabled && registration.event.cancellationRequiresApproval;
  const canCancel = isConfirmed && new Date(registration.event.startAt) > new Date() && !deadlinePassed;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
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

      {createdByMeForOther && (
        <div className="text-sm text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/30 border border-primary-100 dark:border-primary-800 rounded-lg px-4 py-2">
          Inscrição feita por você para {registration.participantName}.
        </div>
      )}

      {isPending && payment && (
        <PaymentStatusPoller orderId={registration.order.id} />
      )}

      {isPending && payment?.method === "PIX" && (payment as { pixQrCodeText?: string | null }).pixQrCodeText && (
        <PixPaymentCard
          pixQrCodeText={(payment as { pixQrCodeText?: string | null }).pixQrCodeText ?? ""}
          expiresAt={(payment as { expiresAt?: Date | null }).expiresAt?.toISOString() ?? null}
        />
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
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Dados do evento</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between py-1 border-b dark:border-gray-700">
            <span className="text-gray-500">Evento</span>
            <span className="font-medium text-right">{registration.event.title}</span>
          </div>
          <div className="flex justify-between py-1 border-b dark:border-gray-700">
            <span className="text-gray-500">Data</span>
            <span>{formatDate(registration.event.startAt)}</span>
          </div>
          <div className="flex justify-between py-1 border-b dark:border-gray-700">
            <span className="text-gray-500">Local</span>
            <span className="text-right">{registration.event.venueName}, {registration.event.city}/{registration.event.state}</span>
          </div>
          {registration.event.kitPickupAt && (
            <div className="flex justify-between py-1 border-b dark:border-gray-700">
              <span className="text-gray-500">Retirada de kit</span>
              <span>{formatDate(registration.event.kitPickupAt)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="card space-y-4">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Dados da inscrição</h3>
        <div className="space-y-2 text-sm">
          {registration.route && (
            <div className="flex justify-between py-1 border-b dark:border-gray-700">
              <span className="text-gray-500">Percurso</span>
              <span>{registration.route.name} ({registration.route.distanceKm}km)</span>
            </div>
          )}
          {registration.category && (
            <div className="flex justify-between py-1 border-b dark:border-gray-700">
              <span className="text-gray-500">Categoria</span>
              <span>{registration.category.name}</span>
            </div>
          )}
          {registration.shirtSize && (
            <div className="flex justify-between py-1 border-b dark:border-gray-700">
              <span className="text-gray-500">Camiseta</span>
              <span>{registration.shirtSize}</span>
            </div>
          )}
          {registration.teamName && (
            <div className="flex justify-between py-1 border-b dark:border-gray-700">
              <span className="text-gray-500">Equipe</span>
              <span>{registration.teamName}</span>
            </div>
          )}
          <div className="flex justify-between py-1 border-b dark:border-gray-700">
            <span className="text-gray-500">Lote</span>
            <span>{registration.ticketBatch.name}</span>
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Dados do participante</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between py-1 border-b dark:border-gray-700">
            <span className="text-gray-500">Nome</span>
            <span className="text-right">{registration.participantName || "—"}</span>
          </div>
          <div className="flex justify-between py-1 border-b dark:border-gray-700">
            <span className="text-gray-500">Telefone</span>
            <span className="text-right">{registration.participantPhone ?? "—"}</span>
          </div>
          <div className="flex justify-between py-1 border-b dark:border-gray-700">
            <span className="text-gray-500">Nascimento</span>
            <span>{registration.participantBirthDate ? formatDateOnly(registration.participantBirthDate) : "—"}</span>
          </div>
          <div className="flex justify-between py-1 border-b dark:border-gray-700">
            <span className="text-gray-500">Gênero</span>
            <span>{registration.participantGender ?? "—"}</span>
          </div>
          <div className="flex justify-between py-1 border-b dark:border-gray-700">
            <span className="text-gray-500">Contato de emergência</span>
            <span className="text-right">{registration.emergencyContactName ?? "—"}</span>
          </div>
          <div className="flex justify-between py-1 border-b dark:border-gray-700">
            <span className="text-gray-500">Telefone de emergência</span>
            <span className="text-right">{registration.emergencyContactPhone ?? "—"}</span>
          </div>
        </div>
      </div>

      <div className="card space-y-3">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Resumo financeiro</h3>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-gray-600 dark:text-gray-400">
            <span>Subtotal</span>
            <span>{formatCurrency(registration.ticketBatch.priceAmount)}</span>
          </div>
          {registration.order.discountAmount > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Desconto</span>
              <span>- {formatCurrency(registration.order.discountAmount)}</span>
            </div>
          )}
          {registration.order.platformFeeAmount > 0 && (
            <div className="flex justify-between text-gray-600 dark:text-gray-400">
              <span>Taxa da plataforma</span>
              <span>+ {formatCurrency(registration.order.platformFeeAmount)}</span>
            </div>
          )}
          {registration.order.pixDiscountAmount > 0 ? (
            <>
              <div className="flex justify-between">
                <span>Taxa de serviço original</span>
                <span>+ {formatCurrency(registration.order.serviceFeeOriginalAmount)}</span>
              </div>
              <div className="flex justify-between text-green-600 dark:text-green-400">
                <span>Desconto PIX na taxa de serviço</span>
                <span>- {formatCurrency(registration.order.pixDiscountAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span>Taxa de serviço de ingresso</span>
                <span>+ {formatCurrency(registration.order.paymentFeeAmount)}</span>
              </div>
            </>
          ) : (
            registration.order.paymentFeeAmount > 0 && (
              <div className="flex justify-between text-gray-600 dark:text-gray-400">
                <span>Taxa de serviço de ingresso</span>
                <span>+ {formatCurrency(registration.order.paymentFeeAmount)}</span>
              </div>
            )
          )}
          <div className="flex justify-between font-bold text-gray-900 dark:text-gray-100 pt-2 border-t dark:border-gray-700">
            <span>Total pago</span>
            <span>{formatCurrency(registration.order.totalAmount)}</span>
          </div>
        </div>
      </div>

      {isConfirmed && (
        <div className="card text-center space-y-3">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">QR code de retirada do kit</h3>
          <p className="text-sm text-gray-500">Apresente este código no ponto de retirada do kit no dia do evento.</p>
          <div className="flex justify-center bg-white p-4 rounded-lg w-fit mx-auto">
            <QRCode value={registration.id} size={180} />
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Link href={`/eventos/${registration.event.slug}`} className="btn-secondary flex-1 text-center text-sm">
          Ver página do evento
        </Link>
        <EditMyRegistrationButton
          registrationId={registration.id}
          deadline={registration.event.registrationEditDeadline?.toISOString() ?? null}
          canEdit={registration.athleteUserId === session.user.id}
          participantName={registration.participantName}
          participantPhone={registration.participantPhone}
          participantBirthDate={registration.participantBirthDate?.toISOString() ?? null}
          participantGender={registration.participantGender}
          shirtSize={registration.shirtSize}
          teamName={registration.teamName}
          emergencyContactName={registration.emergencyContactName}
          emergencyContactPhone={registration.emergencyContactPhone}
        />
        {canCancel && (
          <CancelRegistrationButton registrationId={registration.id} requiresApproval={requiresApproval} />
        )}
      </div>
    </div>
  );
}
