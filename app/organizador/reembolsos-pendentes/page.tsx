import { requireAnyPermission } from "@/lib/auth/rbac";
import { listPendingCancellations, listPendingRefunds } from "@/lib/registrations/pending-queue";
import PendingCancellationsTable from "@/components/registrations/PendingCancellationsTable";
import PendingRefundsTable from "@/components/payment/PendingRefundsTable";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cancelamentos e reembolsos pendentes" };
export const dynamic = "force-dynamic";

export default async function OrganizerReembolsosPendentesPage() {
  const session = await requireAnyPermission([
    "registrations.cancellation-decision",
    "registrations.manual-confirm",
    "payments.refund",
    "payments.manual-resolve",
  ]);
  const [cancellations, refunds] = await Promise.all([
    listPendingCancellations(session.user.id),
    listPendingRefunds(session.user.id),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Cancelamentos e reembolsos pendentes</h1>
        <p className="text-sm text-gray-500 mt-1">
          Solicitações de cancelamento aguardando sua aprovação e reembolsos que precisam de resolução manual.
        </p>
      </div>

      <div>
        <h2 className="font-semibold mb-2">Solicitações de cancelamento</h2>
        <PendingCancellationsTable
          items={cancellations}
          decisionEndpoint={(id) => `/api/organizer/registrations/${id}/cancellation-decision`}
          requestCodeEndpoint={(id) => `/api/organizer/registrations/${id}/cancellation-decision/request-code`}
        />
      </div>

      <div>
        <h2 className="font-semibold mb-2">Reembolsos pendentes</h2>
        <PendingRefundsTable
          items={refunds}
          resolveEndpoint={(paymentId) => `/api/organizer/refunds/${paymentId}/manual-resolve`}
        />
      </div>
    </div>
  );
}
