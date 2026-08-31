import { formatDate } from "@/lib/format";
import CancellationReasonModal from "@/components/registrations/CancellationReasonModal";
import CancellationDecisionButtons from "@/components/organizer/CancellationDecisionButtons";
import type { PendingCancellation } from "@/lib/registrations/pending-queue";

export default function PendingCancellationsTable({
  items,
  decisionEndpoint,
  requestCodeEndpoint,
}: {
  items: PendingCancellation[];
  decisionEndpoint: (registrationId: string) => string;
  requestCodeEndpoint: (registrationId: string) => string;
}) {
  if (items.length === 0) {
    return <div className="card text-center py-8 text-gray-500">Nenhuma solicitação de cancelamento pendente.</div>;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="pb-2 pr-3">Evento</th>
            <th className="pb-2 pr-3">Atleta</th>
            <th className="pb-2 pr-3">Solicitado em</th>
            <th className="pb-2 pr-3">Justificativa</th>
            <th className="pb-2">Ações</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b dark:border-gray-700 last:border-0">
              <td className="py-2 pr-3">{item.event.title}</td>
              <td className="py-2 pr-3">
                <p className="font-medium">{item.participantName}</p>
                <p className="text-gray-500">{item.participantEmail}</p>
              </td>
              <td className="py-2 pr-3 text-gray-700">
                {item.cancellationRequestedAt ? formatDate(item.cancellationRequestedAt, "dd/MM/yy HH:mm") : "—"}
              </td>
              <td className="py-2 pr-3">
                <CancellationReasonModal
                  athleteName={item.participantName}
                  reason={item.cancellationReason ?? ""}
                  requestedAt={item.cancellationRequestedAt}
                />
              </td>
              <td className="py-2">
                <CancellationDecisionButtons
                  cancellationReason={item.cancellationReason}
                  endpoint={decisionEndpoint(item.id)}
                  requestCodeEndpoint={requestCodeEndpoint(item.id)}
                  hasPaidPayment={item.hasPaidPayment}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
