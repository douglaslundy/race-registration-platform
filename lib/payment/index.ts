import type { PaymentProvider } from "./types";
import { SandboxPaymentProvider } from "./sandbox";
import { MercadoPagoProvider } from "./mercadopago";
import { PagarMeProvider } from "./pagarme";
import { getPaymentProviderSetting } from "@/lib/payment-settings";
import type { ResolvedPaymentAccount } from "./account-resolver";

export async function getPaymentProvider(account?: ResolvedPaymentAccount): Promise<PaymentProvider> {
  const provider = await getPaymentProviderSetting();
  if (provider === "sandbox") return new SandboxPaymentProvider();
  if (provider === "mercadopago") return new MercadoPagoProvider(account);
  if (provider === "pagarme") return new PagarMeProvider();
  throw new Error(`Payment provider "${provider}" not implemented`);
}

export type { PaymentProvider, CreatePaymentInput, CreatePaymentResult, PaymentWebhookPayload } from "./types";
