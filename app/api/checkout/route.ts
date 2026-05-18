import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createCheckout } from "@/lib/checkout";
import { getPaymentProvider } from "@/lib/payment";
import type { ShirtSize, PaymentMethod } from "@prisma/client";

async function sendConfirmationEmail(email: string, name: string, registrationId: string) {
  if (!process.env.SMTP_HOST) return;
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? "587"),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const url = `${process.env.NEXTAUTH_URL}/dashboard/inscricoes/${registrationId}`;
  await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? "noreply@example.com",
    to: email,
    subject: "Inscrição confirmada! — Corridas App",
    html: `<p>Olá ${name},</p><p>Sua inscrição foi confirmada com sucesso! 🏅</p><p><a href="${url}">Ver detalhes da inscrição</a></p>`,
  });
}

const checkoutSchema = z.object({
  eventId: z.string().cuid(),
  ticketBatchId: z.string().cuid(),
  routeId: z.string().cuid().optional(),
  categoryId: z.string().cuid().optional(),
  shirtSize: z.enum(["PP", "P", "M", "G", "GG", "XGG"]).optional(),
  teamName: z.string().max(100).optional(),
  emergencyContactName: z.string().max(100).optional(),
  emergencyContactPhone: z.string().max(20).optional(),
  medicalNotes: z.string().max(500).optional(),
  couponCode: z.string().max(50).optional(),
  paymentMethod: z.enum(["PIX", "CREDIT_CARD", "BOLETO"]),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { paymentMethod, ...checkoutData } = parsed.data;

  const checkout = await createCheckout({
    ...checkoutData,
    shirtSize: checkoutData.shirtSize as ShirtSize | undefined,
    buyerUserId: session.user.id,
    athleteUserId: session.user.id,
  });

  const idempotencyKey = `${checkout.orderId}_${paymentMethod}_${Date.now()}`;
  const provider = getPaymentProvider();
  const [buyer, athleteProfile] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true },
    }),
    db.athleteProfile.findUnique({
      where: { userId: session.user.id },
      select: { cpf: true },
    }),
  ]);

  const paymentResult = await provider.createPayment({
    orderId: checkout.orderId,
    amount: checkout.totalAmount,
    method: paymentMethod,
    idempotencyKey,
    buyer: { name: buyer!.name, email: buyer!.email },
    description: `Inscrição #${checkout.registrationId}`,
    cpf: athleteProfile?.cpf ?? undefined,
  });

  const payment = await db.payment.create({
    data: {
      orderId: checkout.orderId,
      provider: process.env.PAYMENT_PROVIDER ?? "sandbox",
      providerPaymentId: paymentResult.providerPaymentId,
      method: paymentMethod as PaymentMethod,
      status: paymentResult.status === "PAID" ? "PAID" : "PENDING",
      amount: checkout.totalAmount,
      idempotencyKey,
      paidAt: paymentResult.status === "PAID" ? new Date() : null,
      pixQrCodeText: paymentResult.pixQrCodeText ?? null,
      boletoUrl: paymentResult.boletoUrl ?? null,
      expiresAt: paymentResult.expiresAt ? new Date(paymentResult.expiresAt) : null,
    },
  });

  if (paymentResult.status === "PAID") {
    await db.order.update({ where: { id: checkout.orderId }, data: { status: "PAID" } });
    await db.registration.update({
      where: { id: checkout.registrationId },
      data: { status: "CONFIRMED" },
    });
    // Send confirmation email (fire-and-forget)
    sendConfirmationEmail(buyer!.email, buyer!.name, checkout.registrationId).catch(() => {});
  }

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CHECKOUT_INITIATED",
      entityType: "Order",
      entityId: checkout.orderId,
      metadata: { paymentMethod, totalAmount: checkout.totalAmount },
    },
  });

  return NextResponse.json({
    orderId: checkout.orderId,
    registrationId: checkout.registrationId,
    paymentId: payment.id,
    totalAmount: checkout.totalAmount,
    status: paymentResult.status,
    pixQrCodeText: paymentResult.pixQrCodeText,
    boletoUrl: paymentResult.boletoUrl,
    checkoutUrl: paymentResult.checkoutUrl,
    expiresAt: paymentResult.expiresAt,
  });
}
