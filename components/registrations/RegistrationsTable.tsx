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
    } | null;
  };
  route: { name: string } | null;
  category: { name: string } | null;
  ticketBatch: { name: string };
  order: {
    id: string;
    totalAmount: number;
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
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="pb-2 pr-4">Atleta</th>
            <th className="pb-2 pr-4">Percurso</th>
            <th className="pb-2 pr-4">Categoria</th>
            <th className="pb-2 pr-4">Lote</th>
            <th className="pb-2 pr-4">Camiseta</th>
            <th className="pb-2 pr-4">Pagamento</th>
            <th className="pb-2 pr-4">Valor</th>
            <th className="pb-2 pr-4">Data inscrição</th>
            <th className="pb-2 pr-4">Data pag.</th>
            <th className="pb-2 pr-4">Pedido</th>
            <th className="pb-2 pr-4">Cód. transação</th>
            <th className="pb-2 pr-4">Status</th>
            {renderActions && <th className="pb-2">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {registrations.map((r) => {
            const payment = r.order.payments[0];
            const statusInfo = REGISTRATION_STATUS[r.status];
            return (
              <tr key={r.id} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                <td className="py-2 pr-4">
                  <p className="font-medium">{r.athlete.name}</p>
                  <p className="text-xs text-gray-500">{r.athlete.email}</p>
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
                <td className="py-2 pr-4 text-gray-700">{r.route?.name ?? "—"}</td>
                <td className="py-2 pr-4 text-gray-700">{r.category?.name ?? "—"}</td>
                <td className="py-2 pr-4 text-gray-700">{r.ticketBatch.name}</td>
                <td className="py-2 pr-4 text-gray-700">{r.shirtSize ?? "—"}</td>
                <td className="py-2 pr-4 text-gray-700">
                  {payment ? PAYMENT_METHOD_LABEL[payment.method] ?? payment.method : "—"}
                </td>
                <td className="py-2 pr-4 text-gray-700">
                  {formatCurrency(r.order.totalAmount)}
                </td>
                <td className="py-2 pr-4 text-gray-700">
                  {formatDate(r.createdAt, "dd/MM/yyyy HH:mm")}
                </td>
                <td className="py-2 pr-4 text-gray-700">
                  {payment?.paidAt ? formatDate(payment.paidAt, "dd/MM/yyyy HH:mm") : "—"}
                </td>
                <td className="py-2 pr-4 text-gray-500 font-mono text-xs truncate max-w-[8rem]" title={r.order.id}>
                  {r.order.id}
                </td>
                <td className="py-2 pr-4 text-gray-500 font-mono text-xs truncate max-w-[10rem]">
                  {payment?.providerPaymentId ?? "—"}
                </td>
                <td className="py-2 pr-4">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusInfo?.color ?? ""}`}>
                    {statusInfo?.label ?? r.status}
                  </span>
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
