import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";

async function fetchMPPaymentStatus(
  paymentId: string
): Promise<{ status: string; paidAt?: string } | null> {
  const token = process.env.MP_ACCESS_TOKEN;
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
  const signature = req.headers.get("x-signature") ?? req.headers.get("x-webhook-signature") ?? "";

  const provider = getPaymentProvider();

  if (!provider.verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  // Mercado Pago notifica com action + data.id — busca o status real
  const action = String(payload.action ?? "");
  const mpPaymentId =
    String((payload.data as Record<string, unknown>)?.id ?? "");

  let parsedStatus: ReturnType<typeof provider.parseWebhookPayload> | null = null;

  if ((action === "payment.updated" || action === "payment.created") && mpPaymentId) {
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

  // Send confirmation email on payment approval
  if (newPaymentStatus === "PAID" && process.env.SMTP_HOST) {
    const buyer = payment.order.buyer;
    const regId = payment.order.registrations[0]?.id;
    if (buyer && regId) {
      const { getAppName } = await import("@/lib/settings");
      const appName = await getAppName();
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT ?? "587"),
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      const url = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/inscricoes/${regId}`;
      transporter
        .sendMail({
          from: process.env.EMAIL_FROM ?? "noreply@example.com",
          to: buyer.email,
          subject: `Inscrição confirmada! — ${appName}`,
          html: `<p>Olá ${buyer.name},</p><p>Pagamento confirmado! Sua inscrição está garantida 🏅</p><p><a href="${url}">Ver detalhes</a></p>`,
        })
        .catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
