import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payment-settings", () => ({
  getPaymentProviderSetting: vi.fn(),
}));

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: vi.fn().mockImplementation((opts) => ({ __opts: opts })),
  Payment: vi.fn().mockImplementation(() => ({ create: vi.fn(), get: vi.fn(), cancel: vi.fn() })),
  PaymentRefund: vi.fn().mockImplementation(() => ({ create: vi.fn() })),
}));

import { getPaymentProvider } from "@/lib/payment";
import { getPaymentProviderSetting } from "@/lib/payment-settings";
import { MercadoPagoProvider } from "@/lib/payment/mercadopago";
import { SandboxPaymentProvider } from "@/lib/payment/sandbox";

const ACC = {
  id: "acc_1",
  accessToken: "ACC_TOKEN",
  webhookSecret: "ACC_SECRET",
  publicKey: null,
  label: "Conta congelada",
  archived: true,
};

beforeEach(() => vi.clearAllMocks());

describe("getPaymentProvider — a conta congelada tem precedência sobre a setting global", () => {
  it("com conta: devolve MercadoPagoProvider mesmo com a setting global em 'sandbox'", async () => {
    vi.mocked(getPaymentProviderSetting).mockResolvedValue("sandbox");
    const provider = await getPaymentProvider(ACC as any);
    expect(provider).toBeInstanceOf(MercadoPagoProvider);
    // nem consulta a setting global quando a conta manda
    expect(getPaymentProviderSetting).not.toHaveBeenCalled();
  });

  it("com conta: idem quando a setting global está em 'pagarme'", async () => {
    vi.mocked(getPaymentProviderSetting).mockResolvedValue("pagarme");
    const provider = await getPaymentProvider(ACC as any);
    expect(provider).toBeInstanceOf(MercadoPagoProvider);
  });

  it("sem conta: continua respeitando a setting global", async () => {
    vi.mocked(getPaymentProviderSetting).mockResolvedValue("sandbox");
    const provider = await getPaymentProvider();
    expect(provider).toBeInstanceOf(SandboxPaymentProvider);
  });
});
