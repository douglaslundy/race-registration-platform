import type { ReactNode } from "react";
import { formatCurrency, formatDate } from "@/lib/format";
import { BADGE } from "@/lib/badge-colors";
import AthleteDetailsModal from "@/components/registrations/AthleteDetailsModal";

const REGISTRATION_STATUS: Record<string, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: BADGE.yellow },
  CONFIRMED: { label: "Confirmada", color: BADGE.green },
  CANCELLED: { label: "Cancelada", color: BADGE.red },
  TRANSFERRED: { label: "Transferida", color: BADGE.blue },
  WAITLISTED: { label: "Lista de espera", color: BADGE.gray },
  CANCELLATION_REQUESTED: { label: "Cancelamento solicitado", color: BADGE.orange },
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  PIX: "PIX",
  CREDIT_CARD: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  BOLETO: "Boleto",
};

export interface RegistrationRow {
  id: string;
  status: string;
  shirtSize: string | null;
  createdAt: Date;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  medicalNotes: string | null;
  athlete: {
    name: string;
    email: string;
    athleteProfile: {
      cpf: string | null;
      birthDate: Date | null;
      phone: string | null;
      gender: string | null;
      city: string | null;
      state: string | null;
      teamName: string | null;
      preferredShirtSize: string | null;
      createdAt: Date;
      updatedAt: Date;
    } | null;
  };
  route: { name: string } | null;
  category: { name: string } | null;
  ticketBatch: { name: string };
  order: {
    id: string;
    totalAmount: number;
    confirmationEmailSentAt: Date | null;
    payments: { method: string; paidAt: Date | null; status: string; providerPaymentId: string | null }[];
  };
}

export default function RegistrationsTable({
  registrations,
  renderActions,
}: {
  registrations: RegistrationRow[];
  renderActions?: (registration: RegistrationRow) => ReactNode;
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="pb-2 pr-3">Atleta</th>
            <th className="pb-2 pr-3">Percurso / Categoria</th>
            <th className="pb-2 pr-3">Lote</th>
            <th className="pb-2 pr-3">Camiseta</th>
            <th className="pb-2 pr-3">Pagamento</th>
            <th className="pb-2 pr-3">Valor</th>
            <th className="pb-2 pr-3">Datas</th>
            <th className="pb-2 pr-3">Pedido / Transação</th>
            <th className="pb-2 pr-3">Status</th>
            <th className="pb-2 pr-3">E-mail</th>
            {renderActions && <th className="pb-2">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {registrations.map((r) => {
            const payment = r.order.payments[0];
            const statusInfo = REGISTRATION_STATUS[r.status];
            return (
              <tr key={r.id} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                <td className="py-2 pr-3 max-w-[10rem]">
                  <p className="font-medium truncate" title={r.athlete.name}>{r.athlete.name}</p>
                  <p className="text-gray-500 truncate" title={r.athlete.email}>{r.athlete.email}</p>
                  <AthleteDetailsModal
                    athleteName={r.athlete.name}
                    athleteEmail={r.athlete.email}
                    profile={r.athlete.athleteProfile}
                    registrationContext={{
                      emergencyContactName: r.emergencyContactName,
                      emergencyContactPhone: r.emergencyContactPhone,
                      medicalNotes: r.medicalNotes,
                    }}
                  />
                </td>
                <td className="py-2 pr-3 text-gray-700">
                  <p>{r.route?.name ?? "—"}</p>
                  <p className="text-gray-500">{r.category?.name ?? "—"}</p>
                </td>
                <td className="py-2 pr-3 text-gray-700">{r.ticketBatch.name}</td>
                <td className="py-2 pr-3 text-gray-700">{r.shirtSize ?? "—"}</td>
                <td className="py-2 pr-3 text-gray-700">
                  {payment ? PAYMENT_METHOD_LABEL[payment.method] ?? payment.method : "—"}
                </td>
                <td className="py-2 pr-3 text-gray-700">
                  {formatCurrency(r.order.totalAmount)}
                </td>
                <td className="py-2 pr-3 text-gray-700">
                  <p>{formatDate(r.createdAt, "dd/MM/yy HH:mm")}</p>
                  <p className="text-gray-500">
                    {payment?.paidAt ? formatDate(payment.paidAt, "dd/MM/yy HH:mm") : "—"}
                  </p>
                </td>
                <td className="py-2 pr-3 text-gray-500 font-mono">
                  <p className="truncate max-w-[7rem]" title={r.order.id}>{r.order.id}</p>
                  <p className="truncate max-w-[7rem]">{payment?.providerPaymentId ?? "—"}</p>
                </td>
                <td className="py-2 pr-3">
                  <span className={`px-2 py-0.5 rounded-full ${statusInfo?.color ?? ""}`}>
                    {statusInfo?.label ?? r.status}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  {r.status === "CONFIRMED" ? (
                    <span
                      className={`px-2 py-0.5 rounded-full ${
                        r.order.confirmationEmailSentAt ? BADGE.green : BADGE.yellow
                      }`}
                    >
                      {r.order.confirmationEmailSentAt ? "Enviado" : "Pendente"}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                {renderActions && (
                  <td className="py-2">
                    <div className="flex flex-col gap-1">{renderActions(r)}</div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
