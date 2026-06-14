import type { PaymentProvider } from "./types";
import { SandboxPaymentProvider } from "./sandbox";
import { MercadoPagoProvider } from "./mercadopago";
import { PagarMeProvider } from "./pagarme";
import { getPaymentProviderSetting } from "@/lib/payment-settings";

export async function getPaymentProvider(): Promise<PaymentProvider> {
  const provider = await getPaymentProviderSetting();
  if (provider === "sandbox") return new SandboxPaymentProvider();
  if (provider === "mercadopago") return new MercadoPagoProvider();
  if (provider === "pagarme") return new PagarMeProvider();
  throw new Error(`Payment provider "${provider}" not implemented`);
}

export type { PaymentProvider, CreatePaymentInput, CreatePaymentResult, PaymentWebhookPayload } from "./types";
