import { calculateAge, formatCurrency, formatDate } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "./RegistrationsTable";

export interface GeneralReportRow {
  id: string;
  shirtSize: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  medicalNotes: string | null;
  participantName: string;
  participantEmail: string;
  participantCpf: string | null;
  participantPhone: string | null;
  participantBirthDate: Date | null;
  route: { name: string } | null;
  category: { name: string } | null;
  ticketBatch: { name: string };
  order: { totalAmount: number };
  payment: { method: string; paidAt: Date | null } | null;
}

export default function GeneralReportTable({
  registrations,
  eventDate,
}: {
  registrations: GeneralReportRow[];
  eventDate: Date;
}) {
  return (
    <div className="card overflow-x-auto print:overflow-visible print:shadow-none print:border-0 print:p-0">
      <table className="w-full text-xs print:text-[9px]">
        <thead>
          <tr className="text-left text-gray-500 border-b dark:border-gray-700">
            <th className="pb-2 pr-3">Atleta</th>
            <th className="pb-2 pr-3">Data de Nascimento</th>
            <th className="pb-2 pr-3">Idade</th>
            <th className="pb-2 pr-3">CPF</th>
            <th className="pb-2 pr-3">Telefone</th>
            <th className="pb-2 pr-3">Percurso / Categoria / Lote</th>
            <th className="pb-2 pr-3">Camiseta</th>
            <th className="pb-2 pr-3">Contato de emergência</th>
            <th className="pb-2 pr-3">Alergias / Observações médicas</th>
            <th className="pb-2 pr-3">Valor pago</th>
            <th className="pb-2 pr-3">Forma de pagamento</th>
            <th className="pb-2 pr-3">Confirmado em</th>
          </tr>
        </thead>
        <tbody>
          {registrations.map((r) => (
            <tr key={r.id} className="border-b dark:border-gray-700 last:border-0">
              <td className="py-2 pr-3">
                <p className="font-medium">{r.participantName}</p>
                <p className="text-gray-500">{r.participantEmail}</p>
              </td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                {r.participantBirthDate ? formatDate(r.participantBirthDate) : "—"}
              </td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                {r.participantBirthDate ? calculateAge(r.participantBirthDate, eventDate) : "—"}
              </td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{r.participantCpf ?? "—"}</td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{r.participantPhone ?? "—"}</td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                <p>{r.route?.name ?? "—"} {r.category ? `· ${r.category.name}` : ""}</p>
                <p className="text-gray-500">{r.ticketBatch.name}</p>
              </td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{r.shirtSize ?? "—"}</td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                <p>{r.emergencyContactName ?? "—"}</p>
                <p className="text-gray-500">{r.emergencyContactPhone ?? "—"}</p>
              </td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{r.medicalNotes ?? "—"}</td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{formatCurrency(r.order.totalAmount)}</td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                {r.payment ? PAYMENT_METHOD_LABEL[r.payment.method] ?? r.payment.method : "—"}
              </td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                {r.payment?.paidAt ? formatDate(r.payment.paidAt, "dd/MM/yy HH:mm") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
