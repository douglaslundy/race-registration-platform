import type { Metadata } from "next";
import AssistantManager from "@/components/assistants/AssistantManager";
import { requireRole, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Assistentes — Organizador" };
export const dynamic = "force-dynamic";

const ORGANIZER_EVENT_ACTIONS = [
  { key: "events.view", label: "Ver meus eventos e exportar CSV" },
  { key: "events.create", label: "Criar evento" },
  { key: "events.edit", label: "Editar meus eventos" },
  { key: "events.delete", label: "Excluir meus eventos" },
  { key: "events.archive", label: "Arquivar/cancelar meus eventos" },
  { key: "events.duplicate", label: "Duplicar meus eventos" },
  { key: "batches.create", label: "Criar lote de ingresso" },
  { key: "batches.edit", label: "Editar lote de ingresso" },
  { key: "batches.delete", label: "Excluir lote de ingresso" },
  { key: "categories.create", label: "Criar categoria" },
  { key: "categories.edit", label: "Editar categoria" },
  { key: "categories.delete", label: "Excluir categoria" },
  { key: "routes.create", label: "Criar percurso" },
  { key: "routes.edit", label: "Editar percurso" },
  { key: "routes.delete", label: "Excluir percurso" },
  { key: "registrations.view", label: "Ver e exportar meus inscritos" },
  { key: "registrations.cancellation-decision", label: "Decidir cancelamento" },
  { key: "registrations.manual-confirm", label: "Confirmar inscrição manualmente" },
  { key: "registrations.cancel-pending", label: "Cancelar inscrição pendente de pagamento há mais de 4h" },
  { key: "registrations.cancel-confirmed", label: "Cancelar inscrição confirmada" },
  { key: "registrations.edit-athlete", label: "Editar dados do atleta" },
  { key: "registrations.resend-confirmation-email", label: "Reenviar e-mail de confirmação" },
  { key: "registrations.resend-payment-notification", label: "Reenviar notificação de erro de pagamento" },
  { key: "registrations.expire-payments", label: "Expirar pagamentos pendentes (meus eventos)" },
  { key: "coupons.view", label: "Ver cupons de um evento" },
  { key: "coupons.create", label: "Criar cupom" },
  { key: "coupons.edit", label: "Editar cupom" },
  { key: "coupons.delete", label: "Excluir cupom" },
  { key: "coupons.report-export", label: "Exportar relatório de uso de cupons" },
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
  { key: "payments.refund", label: "Estornar pagamento" },
  { key: "payments.manual-resolve", label: "Resolver estorno manualmente" },
  { key: "payments.reconciliation", label: "Conciliar pagamentos com o gateway (meus eventos)" },
  { key: "results.import", label: "Importar resultados via CSV" },
  { key: "results.publish", label: "Publicar resultados" },
  { key: "abandoned-carts.notify", label: "Reenviar alerta de carrinho abandonado (meus eventos)" },
  { key: "reports.export", label: "Exportar relatório financeiro (meus eventos)" },
  { key: "messages.view", label: "Ver caixa de mensagens (minhas mensagens)" },
];

export default async function OrganizerAssistentesPage() {
  // Gestão de assistentes é só do titular (ORGANIZER/ADMIN) — nenhuma AssistantPermission cobre isso.
  const session = await requireRole(["ORGANIZER", "ADMIN"]);
  const scope = await resolveActingScope(session);
  const events = scope.organizerId
    ? await db.event.findMany({
        where: { organizerId: scope.organizerId },
        orderBy: { startAt: "desc" },
        select: { id: true, title: true },
      })
    : [];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Usuários Assistentes</h1>
      <AssistantManager apiBase="/api/organizer" actionOptions={ORGANIZER_EVENT_ACTIONS} events={events} />
    </div>
  );
}
