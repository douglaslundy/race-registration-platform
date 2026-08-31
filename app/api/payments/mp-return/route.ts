import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * URL de retorno do checkout do Mercado Pago — o navegador chega aqui com parâmetros
 * (`status`, `payment_id`) que são 100% controláveis pelo usuário (não é um webhook
 * servidor-a-servidor, não tem assinatura nenhuma). Por isso esta rota NUNCA grava nada no
 * banco: ela é apenas um redirect para o painel. A confirmação real do pagamento é feita
 * exclusivamente pelo webhook do Mercado Pago, pelo cron de reconciliação e pelo poller da
 * página de detalhe da inscrição (`PaymentStatusPoller` → `/api/orders/[id]/status`), todos
 * usando o `providerPaymentId` ARMAZENADO no pagamento — nunca o `payment_id` da query string.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const orderId = searchParams.get("order");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const session = await auth();

  if (!orderId || !session?.user) {
    return NextResponse.redirect(`${appUrl}/dashboard/inscricoes`);
  }

  const order = await db.order.findFirst({
    where: { id: orderId, buyerUserId: session.user.id },
    include: { registrations: { take: 1 } },
  });

  if (!order) {
    return NextResponse.redirect(`${appUrl}/dashboard/inscricoes`);
  }

  const regId = order.registrations[0]?.id;

  if (order.status === "PAID" && regId) {
    return NextResponse.redirect(`${appUrl}/dashboard/inscricoes/${regId}?confirmed=1`);
  }

  if (status === "failure") {
    return NextResponse.redirect(`${appUrl}/dashboard/inscricoes?payment_failed=1`);
  }

  if (regId) {
    return NextResponse.redirect(`${appUrl}/dashboard/inscricoes/${regId}?payment_pending=1`);
  }

  return NextResponse.redirect(`${appUrl}/dashboard/inscricoes?payment_pending=1`);
}
