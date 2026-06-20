import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPaymentProviderSetting, getMercadoPagoAccessToken } from "@/lib/payment-settings";
import { notifyOrderConfirmed } from "@/lib/notifications";

async function checkMPPaymentStatus(providerPaymentId: string): Promise<"PAID" | "CANCELLED" | null> {
  const token = await getMercadoPagoAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${providerPaymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === "approved") return "PAID";
    if (data.status === "cancelled" || data.status === "rejected" || data.status === "expired") return "CANCELLED";
    return null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const order = await db.order.findFirst({
    where: { id, buyerUserId: session.user.id },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, providerPaymentId: true, status: true },
      },
      registrations: { select: { id: true } },
    },
  });

  if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

  // Live check with Mercado Pago when order is still pending
  if (order.status === "PENDING") {
    const payment = order.payments[0];
    if (payment?.providerPaymentId) {
      const providerSetting = await getPaymentProviderSetting();
      if (providerSetting === "mercadopago") {
        const mpStatus = await checkMPPaymentStatus(payment.providerPaymentId);
        if (mpStatus === "PAID" && payment.status !== "PAID") {
          await db.$transaction([
            db.payment.update({ where: { id: payment.id }, data: { status: "PAID", paidAt: new Date() } }),
            db.order.update({ where: { id: order.id }, data: { status: "PAID" } }),
            ...order.registrations.map((r) =>
              db.registration.update({ where: { id: r.id }, data: { status: "CONFIRMED" } })
            ),
          ]);
          void notifyOrderConfirmed(order.id);
          return NextResponse.json({ status: "PAID", totalAmount: order.totalAmount });
        }
        if (mpStatus === "CANCELLED" && payment.status !== "CANCELLED") {
          await db.$transaction([
            db.payment.update({ where: { id: payment.id }, data: { status: "CANCELLED" } }),
            db.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } }),
          ]);
          return NextResponse.json({ status: "CANCELLED", totalAmount: order.totalAmount });
        }
      }
    }
  }

  return NextResponse.json({ status: order.status, totalAmount: order.totalAmount });
}
