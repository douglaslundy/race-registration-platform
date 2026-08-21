import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { cancelExpiredPayment } from "./expire-payments";

export interface CancelPendingManuallyResult {
  ok: boolean;
  error?: string;
}

/** Cancela manualmente (fora do prazo natural do cron `expire-payments`) uma inscrição ainda
 * aguardando pagamento. Ao contrário do cron — que só roda depois que o Payment.expiresAt já
 * passou, quando o PIX/boleto já morreu no gateway sozinho — isto pode disparar bem antes desse
 * prazo, então cancela primeiro no GATEWAY (fecha o PIX/boleto de verdade, impedindo pagamento
 * tardio depois da vaga já ter sido revendida) e só then aplica o cancelamento local via
 * cancelExpiredPayment. Se o gateway recusar (ex: pagamento já foi aprovado nesse meio-tempo),
 * falha alto em vez de cancelar localmente com o gateway ainda pagável. */
export async function cancelPendingPaymentManually(paymentId: string): Promise<CancelPendingManuallyResult> {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, select: { status: true, providerPaymentId: true } });
  if (!payment || payment.status !== "PENDING") {
    return { ok: false, error: "Nenhum pagamento pendente encontrado para esta inscrição" };
  }
  if (!payment.providerPaymentId) {
    return { ok: false, error: "Pagamento sem referência no gateway" };
  }

  const provider = await getPaymentProvider();
  try {
    await provider.cancelPayment(payment.providerPaymentId);
  } catch (err) {
    console.error("[cancelPendingPaymentManually] falha ao cancelar no gateway:", err);
    return { ok: false, error: "Não foi possível cancelar o pagamento no gateway — ele pode já ter sido processado" };
  }

  const cancelled = await cancelExpiredPayment(paymentId);
  if (!cancelled) {
    return { ok: false, error: "Não foi possível cancelar — o pagamento já não está mais pendente" };
  }

  return { ok: true };
}
