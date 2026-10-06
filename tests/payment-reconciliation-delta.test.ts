import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";

vi.mock("@/lib/payment", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/payment/account-resolver", () => ({ getPaymentAccountById: vi.fn() }));

import { reconcileDelta } from "@/lib/payment/reconciliation-delta";
import { getPaymentAccountById } from "@/lib/payment/account-resolver";

const dbMock = db as any;
const NOW = new Date("2026-10-06T12:00:00.000Z").getTime();
const OLD = "2026-10-06T11:00:00.000Z"; // bem antes do limite de 5 min
const RECENT = "2026-10-06T11:58:00.000Z"; // dentro dos 5 min

function mpProvider(payments: any[], truncated = false) {
  return { searchUpdatedSince: vi.fn().mockResolvedValue({ payments, truncated }) } as any;
}

describe("reconcileDelta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.paymentAccount.findMany.mockResolvedValue([]);
    dbMock.platformSetting.findUnique.mockResolvedValue(null);
    dbMock.payment.findMany.mockResolvedValue([]);
    dbMock.order.findMany.mockResolvedValue([]);
  });

  it("primeira execução busca as últimas 24h e grava o cursor no limite de 5 min", async () => {
    const provider = mpProvider([]);
    vi.mocked(getPaymentProvider).mockResolvedValue(provider);

    await reconcileDelta(NOW);

    expect(provider.searchUpdatedSince).toHaveBeenCalledWith(new Date(NOW - 24 * 60 * 60 * 1000));
    expect(dbMock.platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "reconciliation_delta_cursor:global" },
        update: { value: new Date(NOW - 5 * 60 * 1000).toISOString() },
      }),
    );
  });

  it("retoma do cursor com 2 min de sobreposição", async () => {
    dbMock.platformSetting.findUnique.mockResolvedValue({ value: "2026-10-06T11:30:00.000Z" });
    const provider = mpProvider([]);
    vi.mocked(getPaymentProvider).mockResolvedValue(provider);

    await reconcileDelta(NOW);

    expect(provider.searchUpdatedSince).toHaveBeenCalledWith(new Date("2026-10-06T11:28:00.000Z"));
  });

  it("zera reconciledAt (SQL cru) do pagamento local cujo status difere do gateway", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      mpProvider([
        { providerPaymentId: "mp-1", status: "PAID", updatedAt: OLD },
        { providerPaymentId: "mp-2", status: "PENDING", updatedAt: OLD },
        { providerPaymentId: "mp-3", status: "PAID", updatedAt: OLD },
      ]),
    );
    dbMock.payment.findMany.mockResolvedValue([
      { id: "p1", providerPaymentId: "mp-1", status: "PENDING" },
      { id: "p2", providerPaymentId: "mp-2", status: "PENDING" },
      { id: "p3", providerPaymentId: "mp-3", status: "PAID" },
    ]);

    const result = await reconcileDelta(NOW);

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mismatches: [], failed: 0 });
  });

  it("acusa cobrança aprovada no gateway sem registro local quando o external_reference é um pedido nosso", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      mpProvider([
        { providerPaymentId: "mp-9", status: "PAID", externalReference: "order-9", updatedAt: OLD },
        { providerPaymentId: "mp-10", status: "PAID", externalReference: "algo-de-fora", updatedAt: OLD },
        { providerPaymentId: "mp-11", status: "PENDING", externalReference: "order-9", updatedAt: OLD },
      ]),
    );
    dbMock.order.findMany.mockResolvedValue([{ id: "order-9", event: { title: "Corrida Y" } }]);

    const result = await reconcileDelta(NOW);

    expect(result.mismatches).toEqual([
      {
        paymentId: "gateway:mp-9",
        orderId: "order-9",
        eventTitle: "Corrida Y",
        localStatus: "SEM REGISTRO LOCAL",
        gatewayStatus: "PAID",
        corrected: false,
      },
    ]);
  });

  it("ignora o que mudou há menos de 5 min (o checkout ainda pode estar gravando o Payment)", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      mpProvider([{ providerPaymentId: "mp-new", status: "PAID", externalReference: "order-9", updatedAt: RECENT }]),
    );
    dbMock.order.findMany.mockResolvedValue([{ id: "order-9", event: { title: "Corrida Y" } }]);

    const result = await reconcileDelta(NOW);

    expect(result.mismatches).toEqual([]);
  });

  it("busca truncada: o cursor para no último item processado, não no limite", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      mpProvider([{ providerPaymentId: "mp-1", status: "PENDING", updatedAt: "2026-10-06T10:00:00.000Z" }], true),
    );

    await reconcileDelta(NOW);

    expect(dbMock.platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: "2026-10-06T10:00:00.000Z" } }),
    );
  });

  it("falha na busca: conta failed e NÃO avança o cursor", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue({
      searchUpdatedSince: vi.fn().mockRejectedValue(new Error("mp 500")),
    } as any);

    const result = await reconcileDelta(NOW);

    expect(result.failed).toBe(1);
    expect(dbMock.platformSetting.upsert).not.toHaveBeenCalled();
  });

  it("percorre também as contas Mercado Pago cadastradas, cada uma com seu cursor", async () => {
    dbMock.paymentAccount.findMany.mockResolvedValue([{ id: "acc-1" }]);
    vi.mocked(getPaymentAccountById).mockResolvedValue({ id: "acc-1" } as any);
    vi.mocked(getPaymentProvider).mockResolvedValue(mpProvider([]));

    await reconcileDelta(NOW);

    const keys = dbMock.platformSetting.upsert.mock.calls.map((c: any) => c[0].where.key);
    expect(keys).toEqual(["reconciliation_delta_cursor:global", "reconciliation_delta_cursor:acc-1"]);
  });

  it("provider sem busca por delta (sandbox) é ignorado", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue({} as any);

    const result = await reconcileDelta(NOW);

    expect(result).toEqual({ mismatches: [], failed: 0 });
    expect(dbMock.platformSetting.upsert).not.toHaveBeenCalled();
  });
});
