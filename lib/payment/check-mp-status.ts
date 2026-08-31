import { getMercadoPagoAccessToken } from "@/lib/payment-settings";

export interface CheckMPPaymentStatusParams {
  /** Pedido esperado — precisa bater com `external_reference` do pagamento no MP. */
  expectedOrderId: string;
  /** Valor total esperado em centavos — precisa bater com `transaction_amount * 100`. */
  expectedAmount: number;
  /** Token da conta congelada no pagamento (inclusive arquivada); sem ela, cai na token global. */
  accessToken?: string;
}

/**
 * Consulta o status real de um pagamento na API do Mercado Pago e só retorna `"PAID"` se o
 * pagamento realmente pertence ao pedido esperado (`external_reference`) E o valor bate
 * (`transaction_amount`). Isso impede que um `payment_id` de OUTRO pedido/valor seja usado
 * pra confirmar o pedido errado (raiz compartilhada com C1 — ver M5 da auditoria 2026-08-31).
 *
 * Nunca confia em status vindo de query string ou corpo de requisição não verificados.
 */
export async function checkMPPaymentStatus(
  providerPaymentId: string,
  params: CheckMPPaymentStatusParams,
): Promise<"PAID" | "CANCELLED" | null> {
  const token = params.accessToken ?? (await getMercadoPagoAccessToken());
  if (!token) return null;
  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${providerPaymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const data = await res.json();

    if (data.status === "cancelled" || data.status === "rejected" || data.status === "expired") {
      return "CANCELLED";
    }

    if (data.status === "approved") {
      const refOk = data.external_reference === params.expectedOrderId;
      const amountOk =
        typeof data.transaction_amount === "number" &&
        Math.round(data.transaction_amount * 100) === params.expectedAmount;
      if (refOk && amountOk) return "PAID";
      console.error(
        "[checkMPPaymentStatus] pagamento aprovado NÃO bate com o pedido esperado",
        {
          providerPaymentId,
          expectedOrderId: params.expectedOrderId,
          gotExternalReference: data.external_reference,
          expectedAmount: params.expectedAmount,
          gotTransactionAmount: data.transaction_amount,
        },
      );
      return null;
    }

    return null;
  } catch {
    return null;
  }
}
