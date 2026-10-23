import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

export const PAYMENT_FAILURE_PHONE_KEY = "alert_payment_failure_phone";

const METHOD_LABEL: Record<string, string> = {
  PIX: "PIX",
  CREDIT_CARD: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  BOLETO: "Boleto",
};

/**
 * Avisa por WhatsApp o telefone da plataforma (Admin → Alertas) e o do organizador do evento
 * (Meus Dados) quando um pagamento do checkout dá erro no gateway ou o cartão é recusado.
 * "Fire-and-forget": nunca lança. Sem dedupe — cada tentativa de pagamento é um evento distinto.
 */
export async function notifyPaymentFailureStaff(params: {
  orderId: string;
  method: string;
  kind: "ERROR" | "DECLINED";
  detail?: string;
}): Promise<void> {
  try {
    const order = await db.order.findUnique({
      where: { id: params.orderId },
      select: {
        totalAmount: true,
        buyer: { select: { name: true, email: true } },
        event: { select: { title: true, organizer: { select: { paymentAlertPhone: true } } } },
      },
    });
    if (!order) return;

    const phones = new Set(
      [await getSetting(PAYMENT_FAILURE_PHONE_KEY), order.event.organizer.paymentAlertPhone]
        .map((p) => p?.trim())
        .filter((p): p is string => !!p),
    );
    if (phones.size === 0) return;

    const lines = [
      params.kind === "ERROR" ? "⚠️ Erro no pagamento" : "⚠️ Pagamento recusado",
      `Evento: ${order.event.title}`,
      `Comprador: ${order.buyer.name} (${order.buyer.email})`,
      `Forma: ${METHOD_LABEL[params.method] ?? params.method}`,
      `Valor: R$ ${(order.totalAmount / 100).toFixed(2).replace(".", ",")}`,
    ];
    if (params.detail) lines.push(`Detalhe: ${params.detail.slice(0, 200)}`);
    const text = lines.join("\n");

    for (const phone of phones) {
      try {
        await sendWhatsAppMessage(phone, text, "PAYMENT_FAILURE_STAFF", {
          relatedEntityType: "Order",
          relatedEntityId: params.orderId,
        });
      } catch (err) {
        console.error("[notifyPaymentFailureStaff] whatsapp failed:", err);
      }
    }
  } catch (err) {
    console.error("[notifyPaymentFailureStaff] failed:", err);
  }
}
