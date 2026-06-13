import { MercadoPagoConfig, Payment, Preference } from "mercadopago";
import crypto from "crypto";
import { getMercadoPagoAccessToken, getMercadoPagoWebhookSecret } from "@/lib/payment-settings";
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
} from "./types";

async function getClient() {
  const token = await getMercadoPagoAccessToken();
  if (!token) throw new Error("MP_ACCESS_TOKEN não configurado");
  return new MercadoPagoConfig({ accessToken: token, options: { timeout: 10000 } });
}

export class MercadoPagoProvider implements PaymentProvider {
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const client = await getClient();
    const amountBRL = input.amount / 100;
    const [firstName, ...rest] = input.buyer.name.split(" ");
    const lastName = rest.join(" ") || firstName;

    // ── Pix ────────────────────────────────────────────────────────────────────
    if (input.method === "PIX") {
      const paymentApi = new Payment(client);
      const res = await paymentApi.create({
        body: {
          transaction_amount: amountBRL,
          description: input.description,
          payment_method_id: "pix",
          payer: {
            email: input.buyer.email,
            first_name: firstName,
            last_name: lastName,
          },
          external_reference: input.orderId,
        },
        requestOptions: { idempotencyKey: input.idempotencyKey },
      });

      return {
        providerPaymentId: String(res.id),
        status: res.status === "approved" ? "PAID" : "PENDING",
        pixQrCodeText:
          (res as unknown as {
            point_of_interaction?: { transaction_data?: { qr_code?: string } };
          })?.point_of_interaction?.transaction_data?.qr_code ?? undefined,
        expiresAt: res.date_of_expiration
          ? new Date(res.date_of_expiration)
          : new Date(Date.now() + 30 * 60 * 1000),
      };
    }

    // ── Boleto ─────────────────────────────────────────────────────────────────
    if (input.method === "BOLETO") {
      const paymentApi = new Payment(client);
      const payer: Record<string, unknown> = {
        email: input.buyer.email,
        first_name: firstName,
        last_name: lastName,
      };
      if (input.cpf) {
        payer.identification = { type: "CPF", number: input.cpf.replace(/\D/g, "") };
      }

      const res = await paymentApi.create({
        body: {
          transaction_amount: amountBRL,
          description: input.description,
          payment_method_id: "bolbradesco",
          payer,
          external_reference: input.orderId,
        },
        requestOptions: { idempotencyKey: input.idempotencyKey },
      });

      const raw = res as unknown as {
        transaction_details?: { external_resource_url?: string };
      };

      return {
        providerPaymentId: String(res.id),
        status: "PENDING",
        boletoUrl: raw.transaction_details?.external_resource_url ?? undefined,
        expiresAt: res.date_of_expiration
          ? new Date(res.date_of_expiration)
          : new Date(Date.now() + 3 * 24 * 3600 * 1000),
      };
    }

    // ── Cartão de crédito — Checkout Pro ───────────────────────────────────────
    const preference = new Preference(client);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    const res = await preference.create({
      body: {
        items: [
          {
            id: input.orderId,
            title: input.description,
            description: input.description,
            unit_price: amountBRL,
            quantity: 1,
            currency_id: "BRL",
          },
        ],
        payer: { email: input.buyer.email, name: input.buyer.name },
        back_urls: {
          success: `${appUrl}/api/payments/mp-return?status=approved&order=${input.orderId}`,
          failure: `${appUrl}/api/payments/mp-return?status=failure&order=${input.orderId}`,
          pending: `${appUrl}/api/payments/mp-return?status=pending&order=${input.orderId}`,
        },
        notification_url: `${appUrl}/api/webhooks/payment`,
        auto_return: "approved",
        external_reference: input.orderId,
        expires: false,
        statement_descriptor: "CORRIDAS APP",
      },
    });

    return {
      providerPaymentId: `pref_${res.id}`,
      status: "PENDING",
      checkoutUrl: res.init_point ?? undefined,
    };
  }

  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    const secret = await getMercadoPagoWebhookSecret();
    if (!secret) return true; // skip verification if not configured

    // MP signature format: ts=<timestamp>,v1=<hash>
    const parts = Object.fromEntries(
      signature.split(",").map((p) => p.split("=") as [string, string])
    );
    if (!parts.ts || !parts.v1) return false;

    const manifest = `id:${JSON.parse(payload)?.data?.id ?? ""};request-id:${parts.ts};ts:${parts.ts}`;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(manifest)
      .digest("hex");
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  }

  parseWebhookPayload(payload: Record<string, unknown>): PaymentWebhookPayload {
    // MP webhooks send { action, data: { id } } — we fetch status from API in the webhook handler
    const id = String((payload.data as Record<string, unknown>)?.id ?? "");
    const status = String((payload as Record<string, unknown>).status ?? "pending");

    const mpToStatus: Record<string, PaymentWebhookPayload["status"]> = {
      approved: "PAID",
      cancelled: "CANCELLED",
      refunded: "REFUNDED",
      charged_back: "CHARGEBACK",
      rejected: "CANCELLED",
      expired: "EXPIRED",
    };

    return {
      providerPaymentId: id,
      status: mpToStatus[status] ?? "CANCELLED",
      rawPayload: payload,
    };
  }
}
