import crypto from "crypto";
import { getPagarMeApiKey, getPagarMeWebhookPassword } from "@/lib/payment-settings";
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
} from "./types";

const BASE_URL = "https://api.pagar.me/core/v5";

async function authHeader(): Promise<string> {
  const apiKey = await getPagarMeApiKey();
  if (!apiKey) throw new Error("Pagar.me API key não configurada");
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

async function request(path: string, body: Record<string, unknown>, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: await authHeader(),
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pagar.me ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}

const CHARGE_STATUS_MAP: Record<string, PaymentWebhookPayload["status"]> = {
  paid: "PAID",
  overpaid: "PAID",
  failed: "CANCELLED",
  canceled: "CANCELLED",
  chargedback: "CHARGEBACK",
  refunded: "REFUNDED",
  pending: "EXPIRED",
  waiting_payment: "EXPIRED",
};

const WEBHOOK_TYPE_MAP: Record<string, PaymentWebhookPayload["status"]> = {
  "charge.paid": "PAID",
  "charge.payment_failed": "CANCELLED",
  "charge.chargedback": "CHARGEBACK",
  "charge.refunded": "REFUNDED",
  "charge.expired": "EXPIRED",
  "charge.canceled": "CANCELLED",
  "charge.updated": "CANCELLED",
};

export class PagarMeProvider implements PaymentProvider {
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const customer: Record<string, unknown> = {
      name: input.buyer.name,
      email: input.buyer.email,
      type: "individual",
    };
    if (input.cpf) {
      customer.document = input.cpf.replace(/\D/g, "");
      customer.document_type = "CPF";
    }

    if (input.method === "PIX") {
      const data = await request(
        "/charges",
        {
          code: input.orderId,
          amount: input.amount,
          payment_method: "pix",
          pix: { expires_in: 3600 },
          customer,
          description: input.description,
        },
        input.idempotencyKey,
      );

      const pix = (data as any)?.last_transaction?.pix;
      return {
        providerPaymentId: String(data.id),
        status: "PENDING",
        pixQrCodeText: pix?.qr_code ?? undefined,
        expiresAt: pix?.expires_at ? new Date(pix.expires_at) : new Date(Date.now() + 3600 * 1000),
      };
    }

    if (input.method === "CREDIT_CARD") {
      if (!input.cardToken) throw new Error("Token do cartão não fornecido");

      const data = await request(
        "/charges",
        {
          code: input.orderId,
          amount: input.amount,
          payment_method: "credit_card",
          credit_card: {
            card_token: input.cardToken,
            installments: input.installments ?? 1,
            statement_descriptor: "CORRIDAS",
          },
          customer,
          description: input.description,
        },
        input.idempotencyKey,
      );

      const chargeStatus = String(data.status ?? "");
      return {
        providerPaymentId: String(data.id),
        status: chargeStatus === "paid" ? "PAID" : "PENDING",
      };
    }

    throw new Error(`Método ${input.method} não suportado pelo Pagar.me`);
  }

  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    const password = await getPagarMeWebhookPassword();
    if (!password) return true;

    // Authorization: Basic base64(password:)
    const expectedBasic = `Basic ${Buffer.from(`${password}:`).toString("base64")}`;
    if (signature === expectedBasic) return true;

    // X-Hub-Signature: sha256=<hmac>
    if (signature.startsWith("sha256=")) {
      const hmac = crypto.createHmac("sha256", password).update(payload).digest("hex");
      const expected = `sha256=${hmac}`;
      try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
      } catch {
        return false;
      }
    }

    return false;
  }

  parseWebhookPayload(payload: Record<string, unknown>): PaymentWebhookPayload {
    const type = String(payload.type ?? "");
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const id = String(data.id ?? "");
    const chargeStatus = String(data.status ?? "");

    const status =
      WEBHOOK_TYPE_MAP[type] ?? CHARGE_STATUS_MAP[chargeStatus] ?? "CANCELLED";

    return {
      providerPaymentId: id,
      status,
      paidAt: status === "PAID" ? new Date().toISOString() : undefined,
      rawPayload: payload,
    };
  }
}
