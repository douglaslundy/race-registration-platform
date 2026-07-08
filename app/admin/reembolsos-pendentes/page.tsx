import { requireAdmin } from "@/lib/auth/rbac";
import { listPendingCancellations, listPendingRefunds } from "@/lib/registrations/pending-queue";
import PendingCancellationsTable from "@/components/registrations/PendingCancellationsTable";
import PendingRefundsTable from "@/components/payment/PendingRefundsTable";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cancelamentos e reembolsos pendentes — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminReembolsosPendentesPage() {
  await requireAdmin();
  const [cancellations, refunds] = await Promise.all([listPendingCancellations(), listPendingRefunds()]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Cancelamentos e reembolsos pendentes</h1>
        <p className="text-sm text-gray-500 mt-1">
          Solicitações de cancelamento e reembolsos pendentes de todos os eventos da plataforma.
        </p>
      </div>

      <div>
        <h2 className="font-semibold mb-2">Solicitações de cancelamento</h2>
        <PendingCancellationsTable
          items={cancellations}
          decisionEndpoint={(id) => `/api/admin/registrations/${id}/cancellation-decision`}
        />
      </div>

      <div>
        <h2 className="font-semibold mb-2">Reembolsos pendentes</h2>
        <PendingRefundsTable
          items={refunds}
          resolveEndpoint={(paymentId) => `/api/admin/refunds/${paymentId}/manual-resolve`}
        />
      </div>
    </div>
  );
}
