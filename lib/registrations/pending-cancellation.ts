export const PENDING_CANCELLATION_THRESHOLD_HOURS = 4;

/**
 * Regra única de "quando um organizador/admin pode cancelar manualmente uma inscrição pendente de
 * pagamento pra liberar a vaga": status ainda PENDING_PAYMENT e já se passaram mais de
 * PENDING_CANCELLATION_THRESHOLD_HOURS desde a criação da inscrição.
 *
 * Usada tanto pra decidir se o botão aparece na tela de inscritos (organizador/admin) quanto pela
 * própria rota de API que executa o cancelamento (defesa em profundidade — nunca confiar só na UI).
 * O cancelamento em si reaproveita `cancelExpiredPayment` (lib/payment/expire-payments.ts), a mesma
 * função que o cron `expire-payments` já usa pra expirar pagamentos pendentes sozinho — aqui é só
 * disparada manualmente, antes do prazo do próprio Payment.expiresAt, em vez de esperar o cron.
 */
export function canCancelPendingRegistration(registration: { status: string; createdAt: Date }): boolean {
  if (registration.status !== "PENDING_PAYMENT") return false;
  const thresholdMs = PENDING_CANCELLATION_THRESHOLD_HOURS * 60 * 60 * 1000;
  return Date.now() - registration.createdAt.getTime() >= thresholdMs;
}
