import { BADGE } from "@/lib/badge-colors";

export const REGISTRATION_STATUS: Record<string, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: BADGE.yellow },
  CONFIRMED: { label: "Confirmada", color: BADGE.green },
  CANCELLED: { label: "Cancelada", color: BADGE.red },
  TRANSFERRED: { label: "Transferida", color: BADGE.blue },
  WAITLISTED: { label: "Lista de espera", color: BADGE.gray },
  CANCELLATION_REQUESTED: { label: "Cancelamento solicitado", color: BADGE.orange },
  COMPLETED: { label: "Concluída", color: BADGE.purple },
};

/**
 * Resolve a chave de exibição do status de uma inscrição pro atleta: uma inscrição CONFIRMED
 * cujo evento já aconteceu passa a exibir "Concluída" em vez de "Confirmada". Isso é só de
 * exibição — o campo `status` gravado no banco nunca muda, preservando toda a lógica de negócio
 * que depende dele (elegibilidade de cancelamento, relatórios, etc.). Só a visão do atleta usa
 * isso; organizador/admin continuam vendo "Confirmada" como hoje.
 */
export function getRegistrationDisplayStatusKey(
  status: string,
  eventStartAt: Date,
  now: Date = new Date(),
): string {
  if (status === "CONFIRMED" && eventStartAt <= now) return "COMPLETED";
  return status;
}
