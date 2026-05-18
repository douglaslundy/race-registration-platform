import type { PaymentProvider } from "./types";
import { SandboxPaymentProvider } from "./sandbox";
import { MercadoPagoProvider } from "./mercadopago";

export function getPaymentProvider(): PaymentProvider {
  const provider = process.env.PAYMENT_PROVIDER ?? "sandbox";
  if (provider === "sandbox") return new SandboxPaymentProvider();
  if (provider === "mercadopago") return new MercadoPagoProvider();
  throw new Error(`Payment provider "${provider}" not implemented`);
}

export type { PaymentProvider, CreatePaymentInput, CreatePaymentResult, PaymentWebhookPayload } from "./types";
