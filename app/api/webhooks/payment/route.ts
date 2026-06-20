import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { getMercadoPagoAccessToken } from "@/lib/payment-settings";
import { notifyOrderConfirmed } from "@/lib/notifications";

async function fetchMPPaymentStatus(
  paymentId: string
): Promise<{ status: string; paidAt?: string } | null> {
  const token = await getMercadoPagoAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { status: data.status, paidAt: data.date_approved };
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
    include: { order: { include: { registrations: true, buyer: { select: { name: true, email: true } } } } },
  });

  if (!payment) return NextResponse.json({ ok: true });
  if (payment.status === "PAID" || payment.status === "REFUNDED") return NextResponse.json({ ok: true });

  const newPaymentStatus = event.status;
  const newOrderStatus =
    newPaymentStatus === "PAID" ? "PAID"
    : newPaymentStatus === "REFUNDED" ? "REFUNDED"
    : newPaymentStatus === "CANCELLED" || newPaymentStatus === "EXPIRED" ? "CANCELLED"
    : payment.order.status;

  const newRegistrationStatus =
    newPaymentStatus === "PAID" ? "CONFIRMED"
    : newPaymentStatus === "CANCELLED" || newPaymentStatus === "EXPIRED" ? "CANCELLED"
    : undefined;

  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: {
        status: newPaymentStatus,
        paidAt: event.paidAt ? new Date(event.paidAt) : undefined,
        rawPayload: event.rawPayload as Parameters<typeof db.payment.update>[0]["data"]["rawPayload"],
      },
    }),
    db.order.update({
      where: { id: payment.orderId },
      data: { status: newOrderStatus },
    }),
    ...(newRegistrationStatus
      ? payment.order.registrations.map((r) =>
          db.registration.update({ where: { id: r.id }, data: { status: newRegistrationStatus } })
        )
      : []),
    db.auditLog.create({
      data: {
        action: "PAYMENT_WEBHOOK",
        entityType: "Payment",
        entityId: payment.id,
        metadata: JSON.parse(JSON.stringify(event)),
      },
    }),
  ]);

  // Envia a confirmação de inscrição por e-mail quando o pagamento é aprovado
  if (newPaymentStatus === "PAID") {
    void notifyOrderConfirmed(payment.orderId);
  }

  return NextResponse.json({ ok: true });
}
