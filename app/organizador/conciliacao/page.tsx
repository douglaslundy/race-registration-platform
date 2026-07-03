import { requireOrganizer } from "@/lib/auth/rbac";
import ReconciliationPanel from "@/components/payment/ReconciliationPanel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Conciliação" };

export default async function OrganizerConciliacaoPage() {
  await requireOrganizer();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Conciliação de pagamentos</h1>
        <p className="text-sm text-gray-500 mt-1">
          Compara o status local dos pagamentos pendentes dos seus eventos com o status real no gateway de pagamento.
          Nenhuma correção é feita automaticamente — só sinaliza divergências.
        </p>
      </div>

      <ReconciliationPanel endpoint="/api/organizer/reconciliation" />
    </div>
  );
}
