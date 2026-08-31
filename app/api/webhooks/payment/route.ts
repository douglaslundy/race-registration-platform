import { NextRequest, NextResponse } from "next/server";
import { getPaymentProvider } from "@/lib/payment";
import { getMercadoPagoAccessToken } from "@/lib/payment-settings";
import { extractGatewayFeeAmount } from "@/lib/payment/mercadopago";
import { processPaymentWebhookEvent } from "@/lib/payment/webhook-handler";
import {
  getDefaultPaymentAccount,
  NoPaymentAccountError,
  type ResolvedPaymentAccount,
} from "@/lib/payment/account-resolver";

async function fetchMPPaymentStatus(
  paymentId: string,
  accessToken?: string,
): Promise<{ status: string; paidAt?: string; gatewayFeeAmount?: number } | null> {
  const token = accessToken ?? (await getMercadoPagoAccessToken());
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

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  // Auto-detect provider from payload structure to pick right signature
  const isPagarMe = typeof payload.type === "string" && (payload.type as string).includes(".");

  // MP: durante a migração pra múltiplas contas o painel do Mercado Pago ainda pode
  // apontar pra cá. Se a conta padrão já existe, USA ela — o provider (assinatura) e a
  // reconsulta de status precisam falar com as credenciais ATUAIS da conta, não com a
  // setting global congelada no momento da migração (o form de pagamento não escreve
  // mais `mp_*`, então essa setting nunca mais muda enquanto o admin rotaciona a conta).
  // O shim NÃO passa `accountId` pro handler — o match por conta só vale pro endpoint
  // novo (/api/webhooks/payment/mp/[accountId]).
  let provider;
  let mpAccount: ResolvedPaymentAccount | null = null;
  if (isPagarMe) {
    provider = await getPaymentProvider();
  } else {
    try {
      mpAccount = await getDefaultPaymentAccount();
      console.warn(
        `[webhook] endpoint legado usado — migrar o painel da conta ${mpAccount.label} para /api/webhooks/payment/mp/${mpAccount.id}`,
      );
      provider = await getPaymentProvider(mpAccount);
    } catch (e) {
      if (!(e instanceof NoPaymentAccountError)) throw e;
      // Instalação pré-migração, sem conta cadastrada → segue no caminho antigo com a setting global.
      mpAccount = null;
      provider = await getPaymentProvider();
    }
  }

  const signature = isPagarMe ? pagarmeSignature : mpSignature;
  const requestId = req.headers.get("x-request-id") ?? undefined;

  if (!(await provider.verifyWebhookSignature(rawBody, signature, requestId))) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
  }

  // Mercado Pago notifica com action + data.id — busca o status real
  const action = String(payload.action ?? "");
  const mpPaymentId =
    String((payload.data as Record<string, unknown>)?.id ?? "");

  let parsedStatus: ReturnType<typeof provider.parseWebhookPayload> | null = null;

  if (!isPagarMe && (action === "payment.updated" || action === "payment.created") && mpPaymentId) {
    const real = await fetchMPPaymentStatus(mpPaymentId, mpAccount?.accessToken);
    if (!real) {
      // Reconsulta falhou (MP 5xx/429/timeout ou token revogado). NÃO adivinha um
      // status terminal — o fallback "CANCELLED" cancelaria um pagamento real. A
      // conciliação é o caminho de recuperação.
      console.error(
        "[webhook] reconsulta de status do MP falhou para %s — nada aplicado, conciliação recupera",
        mpPaymentId,
      );
      return NextResponse.json({ ok: true });
    }
    const mapped = MP_STATUS_MAP[real.status];
    if (!mapped) {
      // Status não-terminal (pending, in_process, authorized, in_mediation…) ou
      // desconhecido. O MP manda `payment.updated` pra transições intermediárias —
      // mapear pra "CANCELLED" cancelaria um pagamento pendente real. Não aplica nada.
      console.log(
        "[webhook] status não-terminal %o para %s — nada aplicado",
        real.status,
        mpPaymentId,
      );
      return NextResponse.json({ ok: true });
    }
    parsedStatus = {
      providerPaymentId: mpPaymentId,
      status: mapped,
      paidAt: real.paidAt,
      gatewayFeeAmount: real.gatewayFeeAmount,
      rawPayload: payload,
    };
  }

  if (!parsedStatus) {
    parsedStatus = provider.parseWebhookPayload(payload);
  }

  // Pagar.me não tem, como o Mercado Pago, um passo prévio que já busca o status real na API
  // (ver bloco de fetchMPPaymentStatus acima) — o status usado ali vem direto do corpo do
  // webhook. Como a autenticação do webhook do Pagar.me é uma senha compartilhada (Basic auth),
  // não uma assinatura por mensagem, reconfirmamos aqui via consulta autenticada à API antes de
  // aplicar qualquer mudança, como defesa em profundidade contra um payload adulterado/replay.
  if (isPagarMe && parsedStatus.providerPaymentId) {
    try {
      const real = await provider.checkPaymentStatus(parsedStatus.providerPaymentId);
      if (real.status === "PENDING") {
        // Status real ainda não é definitivo — não aplica nada deste evento.
        return NextResponse.json({ ok: true });
      }
      parsedStatus = { ...parsedStatus, status: real.status };
    } catch {
      // Falha ao reconsultar a API do Pagar.me — mantém o status já calculado a partir do
      // payload (mesma resiliência que o fluxo do Mercado Pago já tem quando
      // fetchMPPaymentStatus falha).
    }
  }

  const event = parsedStatus;

  await processPaymentWebhookEvent({
    providerPaymentId: event.providerPaymentId,
    status: event.status,
    paidAt: event.paidAt,
    gatewayFeeAmount: event.gatewayFeeAmount,
    rawPayload: event.rawPayload,
    accountId: undefined,
  });

  return NextResponse.json({ ok: true });
}
