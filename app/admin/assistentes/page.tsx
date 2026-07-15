import type { Metadata } from "next";
import AssistantManager from "@/components/assistants/AssistantManager";

export const metadata: Metadata = { title: "Assistentes — Admin" };

const ADMIN_EVENT_ACTIONS = [
  { key: "events.view", label: "Ver eventos e exportar CSV" },
  { key: "events.approve", label: "Aprovar evento" },
  { key: "events.reject", label: "Rejeitar evento" },
  { key: "events.set-fee", label: "Definir taxa de plataforma" },
  { key: "events.edit", label: "Editar evento (qualquer)" },
  { key: "events.delete", label: "Excluir evento (qualquer)" },
  { key: "events.archive", label: "Arquivar/cancelar evento (qualquer)" },
  { key: "batches.create", label: "Criar lote de ingresso (qualquer evento)" },
  { key: "registrations.view", label: "Ver e exportar inscritos (qualquer evento)" },
  { key: "registrations.cancellation-decision-any", label: "Decidir cancelamento (qualquer inscrição)" },
  { key: "registrations.resend-confirmation-email-any", label: "Reenviar e-mail de confirmação (qualquer inscrição)" },
  { key: "registrations.resend-payment-notification-any", label: "Reenviar notificação de erro de pagamento (qualquer inscrição)" },
  { key: "registrations.expire-payments-any", label: "Expirar pagamentos pendentes (plataforma inteira)" },
];

export default function AdminAssistentesPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Usuários Assistentes</h1>
      <AssistantManager apiBase="/api/admin" actionOptions={ADMIN_EVENT_ACTIONS} />
    </div>
  );
}
