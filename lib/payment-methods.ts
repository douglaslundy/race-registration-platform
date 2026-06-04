import { getSetting } from "./settings";

export const PAYMENT_METHOD_VALUES = ["PIX", "CREDIT_CARD", "BOLETO"] as const;

export type CheckoutPaymentMethod = (typeof PAYMENT_METHOD_VALUES)[number];

export const PAYMENT_METHOD_LABELS: Record<CheckoutPaymentMethod, string> = {
  PIX: "Pix",
  CREDIT_CARD: "Cartão de crédito",
  BOLETO: "Boleto",
};

const DEFAULT_ENABLED_PAYMENT_METHODS: CheckoutPaymentMethod[] = [...PAYMENT_METHOD_VALUES];

function isCheckoutPaymentMethod(value: string): value is CheckoutPaymentMethod {
  return (PAYMENT_METHOD_VALUES as readonly string[]).includes(value);
}

export function parseEnabledPaymentMethods(rawValue: string | null | undefined): CheckoutPaymentMethod[] {
  if (!rawValue) return DEFAULT_ENABLED_PAYMENT_METHODS;

  const parsed = rawValue
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is CheckoutPaymentMethod => isCheckoutPaymentMethod(value));

  const unique = parsed.filter((value, index) => parsed.indexOf(value) === index);
  return unique.length > 0 ? unique : DEFAULT_ENABLED_PAYMENT_METHODS;
}

export async function getEnabledPaymentMethods(): Promise<CheckoutPaymentMethod[]> {
  const rawValue = await getSetting("enabled_payment_methods");
  return parseEnabledPaymentMethods(rawValue);
}
