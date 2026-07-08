import { formatCurrency, formatDate } from "@/lib/format";
import ManualRefundResolutionButton from "@/components/payment/ManualRefundResolutionButton";
import type { PendingRefund } from "@/lib/registrations/pending-queue";

export default function PendingRefundsTable({
  items,
  resolveEndpoint,
}: {
  items: PendingRefund[];
  resolveEndpoint: (paymentId: string) => string;
}) {
  if (items.length === 0) {
    return <div className="card text-center py-8 text-gray-500">Nenhum reembolso pendente.</div>;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="pb-2 pr-3">Evento</th>
            <th className="pb-2 pr-3">Atleta</th>
            <th className="pb-2 pr-3">Valor</th>
            <th className="pb-2 pr-3">Motivo da falha</th>
            <th className="pb-2">Ações</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b dark:border-gray-700 last:border-0">
              <td className="py-2 pr-3">{item.event.title}</td>
              <td className="py-2 pr-3">
                <p className="font-medium">{item.athlete.name}</p>
                <p className="text-gray-500">{item.athlete.email}</p>
              </td>
              <td className="py-2 pr-3">{formatCurrency(item.amount)}</td>
              <td className="py-2 pr-3 text-gray-700">
                <p>{item.latestFailedRefund?.failureReason ?? "—"}</p>
                {item.latestFailedRefund && (
                  <p className="text-gray-400">{formatDate(item.latestFailedRefund.createdAt, "dd/MM/yy HH:mm")}</p>
                )}
              </td>
              <td className="py-2">
                <ManualRefundResolutionButton endpoint={resolveEndpoint(item.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
