import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkMPPaymentStatus } from "@/lib/payment/check-mp-status";
import { getPaymentAccountById } from "@/lib/payment/account-resolver";

/**
 * URL de retorno do checkout do Mercado Pago — o navegador chega aqui com parâmetros
 * (`status`, `payment_id`) que são 100% controláveis pelo usuário (não é um webhook
 * servidor-a-servidor, não tem assinatura nenhuma). Por isso esta rota NUNCA grava nada no
 * banco só porque a query string diz "approved" — ela sempre reconsulta o status real na API
 * do Mercado Pago antes de confirmar qualquer pagamento, e sempre exige que o pedido pertença
 * ao usuário autenticado.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const orderId = searchParams.get("order");
  const paymentId = searchParams.get("payment_id");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const session = await auth();

  if (!orderId || !session?.user) {
    return NextResponse.redirect(`${appUrl}/dashboard/inscricoes`);
  }

  const order = await db.order.findFirst({
    where: { id: orderId, buyerUserId: session.user.id },
    include: {
      registrations: { take: 1 },
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { provider: true, paymentAccountId: true },
      },
    },
  });

  if (!order) {
    return NextResponse.redirect(`${appUrl}/dashboard/inscricoes`);
  }

  const regId = order.registrations[0]?.id;

  if (paymentId && order.status !== "PAID") {
    const pmt = order.payments?.[0];
    const acc = pmt?.paymentAccountId
      ? await getPaymentAccountById(pmt.paymentAccountId).catch(() => null)
      : null;
    const realStatus = await checkMPPaymentStatus(paymentId, acc?.accessToken);
    if (realStatus === "PAID") {
      await db.$transaction([
        db.order.update({ where: { id: orderId }, data: { status: "PAID" } }),
        ...order.registrations.map((r) =>
          db.registration.update({ where: { id: r.id }, data: { status: "CONFIRMED" } })
        ),
        db.payment.updateMany({
          where: { orderId, status: "PENDING" },
          data: { status: "PAID", paidAt: new Date(), providerPaymentId: paymentId },
        }),
      ]);
      if (regId) {
        return NextResponse.redirect(`${appUrl}/dashboard/inscricoes/${regId}?confirmed=1`);
      }
    }
  }

  if (order.status === "PAID" && regId) {
    return NextResponse.redirect(`${appUrl}/dashboard/inscricoes/${regId}?confirmed=1`);
  }

  if (status === "failure") {
    return NextResponse.redirect(`${appUrl}/dashboard/inscricoes?payment_failed=1`);
  }

  return NextResponse.redirect(`${appUrl}/dashboard/inscricoes?payment_pending=1`);
}
