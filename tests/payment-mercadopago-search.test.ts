import { beforeEach, describe, expect, it, vi } from "vitest";

const searchMock = vi.fn();

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: vi.fn().mockImplementation(() => ({})),
  Payment: vi.fn().mockImplementation(() => ({ search: searchMock })),
  PaymentRefund: vi.fn(),
}));

vi.mock("@/lib/payment-settings", () => ({
  getMercadoPagoAccessToken: vi.fn().mockResolvedValue("test-token"),
  getMercadoPagoWebhookSecret: vi.fn().mockResolvedValue(""),
}));

import { MercadoPagoProvider } from "@/lib/payment/mercadopago";

function page(n: number, startId = 0) {
  return {
    results: Array.from({ length: n }, (_, i) => ({
      id: String(startId + i),
      status: "approved",
      external_reference: `order-${startId + i}`,
      date_last_updated: "2026-10-06T10:00:00.000Z",
    })),
  };
}

describe("MercadoPagoProvider.searchUpdatedSince", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("busca por date_last_updated ascendente a partir do instante informado e mapeia os status", async () => {
    searchMock.mockResolvedValueOnce({
      results: [
        { id: 1, status: "approved", external_reference: "order-1", date_last_updated: "2026-10-06T10:00:00.000Z" },
        { id: 2, status: "refunded", date_last_updated: "2026-10-06T10:01:00.000Z" },
        { id: 3, status: "in_process", date_last_updated: "2026-10-06T10:02:00.000Z" },
        { status: "approved" },
      ],
    });
    const since = new Date("2026-10-06T09:00:00.000Z");

    const out = await new MercadoPagoProvider().searchUpdatedSince(since);

    expect(searchMock).toHaveBeenCalledWith({
      options: expect.objectContaining({
        sort: "date_last_updated",
        criteria: "asc",
        range: "date_last_updated",
        begin_date: since.toISOString(),
        end_date: "NOW",
        limit: 100,
        offset: 0,
      }),
    });
    expect(out.truncated).toBe(false);
    expect(out.payments).toEqual([
      { providerPaymentId: "1", status: "PAID", externalReference: "order-1", updatedAt: "2026-10-06T10:00:00.000Z" },
      { providerPaymentId: "2", status: "REFUNDED", externalReference: undefined, updatedAt: "2026-10-06T10:01:00.000Z" },
      { providerPaymentId: "3", status: "PENDING", externalReference: undefined, updatedAt: "2026-10-06T10:02:00.000Z" },
    ]);
  });

  it("pagina enquanto a página vier cheia", async () => {
    searchMock.mockResolvedValueOnce(page(100, 0)).mockResolvedValueOnce(page(30, 100));

    const out = await new MercadoPagoProvider().searchUpdatedSince(new Date());

    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(searchMock.mock.calls[1][0].options.offset).toBe(100);
    expect(out.payments).toHaveLength(130);
    expect(out.truncated).toBe(false);
  });

  it("marca truncated ao atingir o limite de páginas", async () => {
    searchMock.mockResolvedValue(page(100));

    const out = await new MercadoPagoProvider().searchUpdatedSince(new Date());

    expect(searchMock).toHaveBeenCalledTimes(20);
    expect(out.truncated).toBe(true);
  });

  it("propaga erro da API (o chamador não deve avançar o cursor)", async () => {
    searchMock.mockRejectedValueOnce(new Error("mp 500"));

    await expect(new MercadoPagoProvider().searchUpdatedSince(new Date())).rejects.toThrow("mp 500");
  });
});
