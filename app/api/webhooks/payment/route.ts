import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { getMercadoPagoAccessToken } from "@/lib/payment-settings";
import { notifyOrderConfirmed } from "@/lib/notifications";
import { notifyPaymentError } from "@/lib/alerts/payment-error";
import { applyGatewayStatus } from "@/lib/payment/sync-payment-status";
import { extractGatewayFeeAmount } from "@/lib/payment/mercadopago";
import { confirmAdPurchasePayment } from "@/lib/ads/ad-purchase-confirmation";

async function fetchMPPaymentStatus(
  paymentId: string
): Promise<{ status: string; paidAt?: string; gatewayFeeAmount?: number } | null> {
  const token = await getMercadoPagoAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      status: data.status,
      paidAt: data.date_approved,
      gatewayFeeAmount: data.status === "approved" ? extractGatewayFeeAmount(data) : undefined,
    };
  } catch {
    return null;
  }
}

const MP_STATUS_MAP: Record<string, "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK"> = {
  approved: "PAID",
  cancelled: "CANCELLED",
  refunded: "REFUNDED",
  charged_back: "CHARGEBACK",
  rejected: "CANCELLED",
  expired: "EXPIRED",
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Select the correct signature header based on payload structure
  const mpSignature = req.headers.get("x-signature") ?? req.headers.get("x-webhook-signature") ?? "";
  const pagarmeSignature = req.headers.get("authorization") ?? req.headers.get("x-hub-signature") ?? "";

  const provider = await getPaymentProvider();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  // Auto-detect provider from payload structure to pick right signature
  const isPagarMe = typeof payload.type === "string" && (payload.type as string).includes(".");
  const signature = isPagarMe ? pagarmeSignature : mpSignature;

  if (!(await provider.verifyWebhookSignature(rawBody, signature))) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
  }

  // Mercado Pago notifica com action + data.id — busca o status real
  const action = String(payload.action ?? "");
  const mpPaymentId =
    String((payload.data as Record<string, unknown>)?.id ?? "");

  let parsedStatus: ReturnType<typeof provider.parseWebhookPayload> | null = null;

  if (!isPagarMe && (action === "payment.updated" || action === "payment.created") && mpPaymentId) {
    const real = await fetchMPPaymentStatus(mpPaymentId);
    if (real) {
      parsedStatus = {
        providerPaymentId: mpPaymentId,
        status: MP_STATUS_MAP[real.status] ?? "CANCELLED",
        paidAt: real.paidAt,
        gatewayFeeAmount: real.gatewayFeeAmount,
        rawPayload: payload,
      };
    }
  }

  if (!parsedStatus) {
    parsedStatus = provider.parseWebhookPayload(payload);
  }

  const event = parsedStatus;

  const payment = await db.payment.findFirst({
    where: { providerPaymentId: event.providerPaymentId },
    include: {
      order: { include: { registrations: true, buyer: { select: { name: true, email: true } } } },
      adPurchase: { include: { advertiser: { include: { user: true } }, adPlan: true } },
    },
  });

  if (!payment) return NextResponse.json({ ok: true });

  if (payment.adPurchaseId) {
    // Pagamento de compra de plano de anúncio (AdPurchase) — não passa pelo fluxo de
    // Order/Registration abaixo, que assume payment.order não-nulo.
    await confirmAdPurchasePayment(payment.id, event.status);
    return NextResponse.json({ ok: true });
  }

  if (!payment.order || !payment.orderId) {
    // Chegou aqui um pagamento sem Order E sem AdPurchase associado (o branch de AdPurchase já
    // retornou acima) — loga bem alto em vez de tentar sincronizar um pedido inexistente, mas
    // ainda confirma o recebimento (ok:true) pro gateway não ficar reenviando.
    console.error(`[webhooks/payment] payment ${payment.id} sem order associado — ignorando evento`);
    return NextResponse.json({ ok: true });
  }

  const order = payment.order;
  const orderId = payment.orderId;

  const newPaymentStatus = event.status;

  const result = await db.$transaction(async (tx) => {
    return applyGatewayStatus(
      tx,
      payment,
      order,
      order.registrations,
      newPaymentStatus,
      "webhook",
      {
        paidAt: event.paidAt ? new Date(event.paidAt) : undefined,
        gatewayFeeAmount: event.gatewayFeeAmount,
        rawPayload: event.rawPayload,
      },
    );
  });

  if (!result.changed) return NextResponse.json({ ok: true });

  // Envia a confirmação de inscrição por e-mail quando o pagamento é aprovado
  if (newPaymentStatus === "PAID") {
    void notifyOrderConfirmed(orderId);
  }

  // Avisa o atleta quando o pagamento falha ou expira
  if (newPaymentStatus === "CANCELLED" || newPaymentStatus === "EXPIRED") {
    void notifyPaymentError(payment.id);
  }

  return NextResponse.json({ ok: true });
}
