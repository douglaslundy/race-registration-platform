import type { PaymentProvider } from "./types";
import { SandboxPaymentProvider } from "./sandbox";
import { MercadoPagoProvider } from "./mercadopago";
import { PagarMeProvider } from "./pagarme";
import { getPaymentProviderSetting } from "@/lib/payment-settings";
import type { ResolvedPaymentAccount } from "./account-resolver";

export async function getPaymentProvider(account?: ResolvedPaymentAccount): Promise<PaymentProvider> {
  // Conta congelada no pagamento manda, SEMPRE — antes de olhar a setting global.
  // Um estorno/webhook/conciliação de um pagamento preso a uma conta Mercado Pago
  // precisa falar com o Mercado Pago mesmo que o admin tenha mudado a setting global
  // pra "sandbox" ou "pagarme" (teste, ou contornando uma queda do MP). Sem isso, o
  // estorno viraria um SandboxPaymentProvider — "estornado" gravado, dinheiro nunca
  // saiu do MP. Todo call site que passa `account` só o faz pra pagamento MP.
  if (account) return new MercadoPagoProvider(account);

  const provider = await getPaymentProviderSetting();
  if (provider === "sandbox") return new SandboxPaymentProvider();
  if (provider === "mercadopago") return new MercadoPagoProvider(account);
  if (provider === "pagarme") return new PagarMeProvider();
  throw new Error(`Payment provider "${provider}" not implemented`);
}

export type { PaymentProvider, CreatePaymentInput, CreatePaymentResult, PaymentWebhookPayload } from "./types";
