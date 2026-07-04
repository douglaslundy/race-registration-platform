import { requireOrganizer } from "@/lib/auth/rbac";
import ExpirePaymentsPanel from "@/components/payment/ExpirePaymentsPanel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pedidos vencidos" };

export default async function OrganizerPedidosVencidosPage() {
  await requireOrganizer();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Pedidos com pagamento vencido</h1>
        <p className="text-sm text-gray-500 mt-1">
          Cancela pedidos dos seus eventos cujo prazo de pagamento (PIX/boleto) já expirou sem confirmação,
          liberando a vaga do lote. Roda automaticamente por cron; use o botão para processar agora.
        </p>
      </div>

      <ExpirePaymentsPanel endpoint="/api/organizer/expire-payments" />
    </div>
  );
}
