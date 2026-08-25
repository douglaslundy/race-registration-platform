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
  { key: "registrations.cancel-pending-any", label: "Cancelar inscrição pendente de pagamento há mais de 4h (qualquer inscrição)" },
  { key: "registrations.cancel-confirmed-any", label: "Cancelar inscrição confirmada (qualquer inscrição)" },
  { key: "registrations.resend-confirmation-email-any", label: "Reenviar e-mail de confirmação (qualquer inscrição)" },
  { key: "registrations.resend-payment-notification-any", label: "Reenviar notificação de erro de pagamento (qualquer inscrição)" },
  { key: "registrations.expire-payments-any", label: "Expirar pagamentos pendentes (plataforma inteira)" },
  { key: "coupons.view", label: "Ver cupons de um evento" },
  { key: "coupons.report-export", label: "Exportar relatório de uso de cupons de um evento" },
  { key: "coupons.create-any", label: "Criar cupom (qualquer evento ou global)" },
  { key: "coupons.edit-any", label: "Editar cupom (qualquer)" },
  { key: "coupons.delete-any", label: "Excluir cupom (qualquer)" },
  { key: "coupons.export-all", label: "Exportar CSV de todos os cupons (plataforma inteira)" },
  { key: "social-links.view", label: "Ver redes sociais de um evento" },
  { key: "social-links.create", label: "Criar rede social" },
  { key: "social-links.edit", label: "Editar rede social" },
  { key: "social-links.delete", label: "Excluir rede social" },
  { key: "sponsors.view", label: "Ver patrocinadores de um evento" },
  { key: "sponsors.create", label: "Criar patrocinador" },
  { key: "sponsors.edit", label: "Editar patrocinador" },
  { key: "sponsors.delete", label: "Excluir patrocinador" },
  { key: "campaigns.view", label: "Ver campanhas de WhatsApp de um evento" },
  { key: "campaigns.create", label: "Criar campanha de WhatsApp" },
  { key: "campaigns.edit", label: "Editar campanha de WhatsApp" },
  { key: "campaigns.cancel", label: "Cancelar campanha de WhatsApp" },
  { key: "kits.view", label: "Ver retirada de kits de um evento" },
  { key: "kits.deliver", label: "Confirmar entrega de kit" },
  { key: "payments.refund-any", label: "Estornar pagamento (qualquer)" },
  { key: "payments.manual-resolve-any", label: "Resolver estorno manualmente (qualquer)" },
  { key: "payments.reconciliation-any", label: "Conciliar pagamentos com o gateway (plataforma inteira)" },
  { key: "payments.export", label: "Exportar CSV de um pagamento específico" },
  { key: "payments.export-all", label: "Exportar CSV de todos os pagamentos" },
  { key: "results.import", label: "Importar resultados via CSV (qualquer evento)" },
  { key: "results.publish", label: "Publicar resultados (qualquer evento)" },
  { key: "abandoned-carts.notify-any", label: "Reenviar alerta de carrinho abandonado (plataforma inteira)" },
  { key: "reports.export-all", label: "Exportar relatório financeiro da plataforma" },
  { key: "messages.view", label: "Ver caixa de mensagens" },
];

export default function AdminAssistentesPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Usuários Assistentes</h1>
      <AssistantManager apiBase="/api/admin" actionOptions={ADMIN_EVENT_ACTIONS} />
    </div>
  );
}
