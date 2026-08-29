import { NextRequest, NextResponse } from "next/server";
import { getPaymentAccountById, NoPaymentAccountError } from "@/lib/payment/account-resolver";
import { getPaymentProvider } from "@/lib/payment";
import { processPaymentWebhookEvent } from "@/lib/payment/webhook-handler";
import { extractGatewayFeeAmount } from "@/lib/payment/mercadopago";

const MP_STATUS_MAP: Record<string, "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK"> = {
  approved: "PAID",
  cancelled: "CANCELLED",
  refunded: "REFUNDED",
  charged_back: "CHARGEBACK",
  rejected: "CANCELLED",
  expired: "EXPIRED",
};

/**
 * Webhook do Mercado Pago por conta. A URL carrega o `accountId`, então cada painel
 * do MP pode apontar pro seu próprio endpoint e o handler consegue exigir que o
 * pagamento pertença àquela conta antes de aplicar qualquer mudança.
 *
 * Depois que a assinatura é verificada, a resposta é SEMPRE `200 { ok: true }` —
 * `processPaymentWebhookEvent` retornar `{ handled: false }` é normal (pagamento
 * ainda não existe, conta não bate, evento sem order) e não pode virar erro, senão
 * o Mercado Pago fica reenviando. Os únicos não-200 aqui são: 404 (conta não
 * encontrada), 401 (assinatura inválida) e 400 (corpo não é JSON).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await params;

  let account;
  try {
    account = await getPaymentAccountById(accountId);
  } catch (e) {
    if (e instanceof NoPaymentAccountError) {
      return NextResponse.json({ error: "Conta de pagamento não encontrada" }, { status: 404 });
    }
    throw e;
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-signature") ?? req.headers.get("x-webhook-signature") ?? "";
  const provider = await getPaymentProvider(account);
  if (!(await provider.verifyWebhookSignature(rawBody, signature))) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const action = String(payload.action ?? "");
  const mpPaymentId = String((payload.data as Record<string, unknown> | undefined)?.id ?? "");
  if (!mpPaymentId) return NextResponse.json({ ok: true });

  let status: "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK" = "CANCELLED";
  let paidAt: string | undefined;
  let gatewayFeeAmount: number | undefined;

  if (action === "payment.updated" || action === "payment.created") {
    // Reconsulta o status real na API do MP com o token DESTA conta — nunca confia
    // no status que veio cru no corpo do webhook.
    try {
      const res = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        status = MP_STATUS_MAP[data.status as string] ?? "CANCELLED";
        paidAt = data.date_approved ?? undefined;
        gatewayFeeAmount = data.status === "approved" ? extractGatewayFeeAmount(data) : undefined;
      }
    } catch {
      // Falha ao reconsultar a API — mantém o fallback (CANCELLED) e deixa o handler
      // decidir; a mesma resiliência do fluxo do endpoint legado.
    }
  } else {
    status = MP_STATUS_MAP[String(payload.status ?? "pending")] ?? "CANCELLED";
  }

  await processPaymentWebhookEvent({
    providerPaymentId: mpPaymentId,
    status,
    paidAt,
    gatewayFeeAmount,
    rawPayload: payload,
    accountId,
  });

  return NextResponse.json({ ok: true });
}
