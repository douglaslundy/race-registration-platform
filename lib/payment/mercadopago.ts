import { MercadoPagoConfig, Payment, PaymentRefund } from "mercadopago";
import crypto from "crypto";
import { getMercadoPagoAccessToken, getMercadoPagoWebhookSecret } from "@/lib/payment-settings";
import type { ResolvedPaymentAccount } from "./account-resolver";
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
  RefundPaymentInput,
  RefundPaymentResult,
  PaymentStatusResult,
} from "./types";

interface MPFeeDetail {
  type?: string;
  amount?: number;
  fee_payer?: string;
}

// Soma as taxas que o Mercado Pago cobra do recebedor (fee_payer: "collector"),
// convertendo de reais (float) para centavos. Retorna undefined se o pagamento
// ainda nao tiver fee_details (ex: Pix/boleto pendentes).
export function extractGatewayFeeAmount(res: unknown): number | undefined {
  const feeDetails = (res as { fee_details?: MPFeeDetail[] })?.fee_details;
  if (!feeDetails || feeDetails.length === 0) return undefined;
  const totalBRL = feeDetails
    .filter((f) => !f.fee_payer || f.fee_payer === "collector")
    .reduce((sum, f) => sum + (f.amount ?? 0), 0);
  return totalBRL > 0 ? Math.round(totalBRL * 100) : undefined;
}

export class MercadoPagoProvider implements PaymentProvider {
  constructor(private account?: ResolvedPaymentAccount) {}

  private async accessToken(): Promise<string> {
    if (this.account) return this.account.accessToken;
    const t = await getMercadoPagoAccessToken();
    if (!t) throw new Error("MP_ACCESS_TOKEN não configurado");
    return t;
  }

  private async webhookSecret(): Promise<string | null> {
    return this.account ? this.account.webhookSecret : getMercadoPagoWebhookSecret();
  }

  private async getClient() {
    return new MercadoPagoConfig({ accessToken: await this.accessToken(), options: { timeout: 10000 } });
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const client = await this.getClient();
    const amountBRL = parseFloat((input.amount / 100).toFixed(2));
    console.log("[mp] createPayment method=%s amount_cents=%d amount_brl=%s", input.method, input.amount, amountBRL);
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
        gatewayFeeAmount: res.status === "approved" ? extractGatewayFeeAmount(res) : undefined,
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

    // ── Cartão de crédito — Checkout transparente ─────────────────────────────
    if (!input.cardToken) throw new Error("Token do cartão não fornecido");
    if (amountBRL < 1) throw new Error("Valor mínimo para pagamento com cartão é R$1,00");

    // Resolve payment_method_id: prefer what the frontend sent; fallback to card token lookup
    let paymentMethodId = input.cardBrand || undefined;
    if (!paymentMethodId) {
      const accessToken = await this.accessToken();
      const tokenRes = await fetch(`https://api.mercadopago.com/v1/card_tokens/${input.cardToken}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const tokenData = await tokenRes.json() as {
        payment_method_id?: string;
        first_six_digits?: string;
        bin_attributes?: { brand?: { code?: string } };
      };

      // Newer token responses put brand info in bin_attributes instead of payment_method_id
      const brandCode = tokenData.payment_method_id
        || tokenData.bin_attributes?.brand?.code;

      const brandMap: Record<string, string> = {
        mastercard: "master",
        visa: "visa",
        amex: "amex",
        american_express: "amex",
        elo: "elo",
        hipercard: "hipercard",
        diners: "diners",
        discover: "discover",
        aura: "aura",
      };
      paymentMethodId = brandCode
        ? (brandMap[brandCode.toLowerCase()] ?? brandCode.toLowerCase())
        : undefined;

      // Last resort: search by BIN
      if (!paymentMethodId && tokenData.first_six_digits) {
        const pmRes = await fetch(
          `https://api.mercadopago.com/v1/payment_methods/search?bin=${tokenData.first_six_digits}&site_id=MLB`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (pmRes.ok) {
          const pmData = await pmRes.json() as { results?: Array<{ id: string; payment_type_id: string }> };
          paymentMethodId = pmData.results?.find((r) => r.payment_type_id === "credit_card")?.id;
        }
      }
    }
    if (!paymentMethodId) throw new Error("Não foi possível identificar a bandeira do cartão");

    const paymentApiCC = new Payment(client);
    const payerCC: Record<string, unknown> = {
      email: input.buyer.email,
      first_name: firstName,
      last_name: lastName,
    };
    if (input.cpf) {
      payerCC.identification = { type: "CPF", number: input.cpf.replace(/\D/g, "") };
    }

    const resCC = await paymentApiCC.create({
      body: {
        transaction_amount: amountBRL,
        token: input.cardToken,
        payment_method_id: paymentMethodId,
        installments: input.installments ?? 1,
        description: input.description,
        payer: payerCC,
        external_reference: input.orderId,
        statement_descriptor: "CORRIDAS APP",
      },
      requestOptions: { idempotencyKey: input.idempotencyKey },
    });

    const CARD_CREATE_FALLBACK_EXPIRY_MS = 48 * 3600 * 1000; // 48h — pending_contingency/pending_review_manual resolvem "em até 2 dias úteis" por doc oficial da MP

    if (resCC.status === "approved") {
      return {
        providerPaymentId: String(resCC.id),
        status: "PAID",
        gatewayFeeAmount: extractGatewayFeeAmount(resCC),
      };
    }
    if (resCC.status === "rejected") {
      return { providerPaymentId: String(resCC.id), status: "CANCELLED" };
    }
    return {
      providerPaymentId: String(resCC.id),
      status: "PENDING",
      expiresAt: new Date(Date.now() + CARD_CREATE_FALLBACK_EXPIRY_MS),
    };
  }

  async cancelPayment(providerPaymentId: string): Promise<void> {
    const client = await this.getClient();
    const paymentApi = new Payment(client);
    console.log("[mp] cancelPayment providerPaymentId=%s", providerPaymentId);
    await paymentApi.cancel({ id: providerPaymentId });
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    const client = await this.getClient();
    const refundApi = new PaymentRefund(client);
    console.log("[mp] refundPayment providerPaymentId=%s", input.providerPaymentId);
    const res = await refundApi.create({ payment_id: input.providerPaymentId });
    return { providerRefundId: res.id !== undefined ? String(res.id) : undefined };
  }

  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    const secret = await this.webhookSecret();
    // Falha fechada: sem segredo configurado, nenhum webhook é aceito (nunca pular a
    // verificação — isso permitiria forjar confirmações de pagamento).
    if (!secret) return false;

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
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(parts.v1);
    // Assinatura com formato/comprimento inválido: rejeita sem lançar
    // (timingSafeEqual joga RangeError se os buffers tiverem tamanhos diferentes).
    if (expectedBuf.length !== providedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
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

  async checkPaymentStatus(providerPaymentId: string): Promise<PaymentStatusResult> {
    const client = await this.getClient();
    const paymentApi = new Payment(client);
    const res = await paymentApi.get({ id: providerPaymentId });
    const statusMap: Record<string, PaymentStatusResult["status"]> = {
      approved: "PAID",
      cancelled: "CANCELLED",
      rejected: "CANCELLED",
      refunded: "REFUNDED",
      charged_back: "CHARGEBACK",
      expired: "EXPIRED",
    };
    const status = statusMap[String(res.status)] ?? "PENDING";
    return {
      status,
      gatewayFeeAmount: status === "PAID" ? extractGatewayFeeAmount(res) : undefined,
      paidAt: status === "PAID" ? (res.date_approved ?? undefined) : undefined,
    };
  }
}
