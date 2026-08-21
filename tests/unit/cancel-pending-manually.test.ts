import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";

vi.mock("@/lib/payment", () => ({
  getPaymentProvider: vi.fn(),
}));
vi.mock("@/lib/payment/expire-payments", () => ({
  cancelExpiredPayment: vi.fn(),
}));

import { cancelPendingPaymentManually } from "@/lib/payment/cancel-pending-manually";
import { cancelExpiredPayment } from "@/lib/payment/expire-payments";

const dbMock = db as any;
const getPaymentProviderMock = vi.mocked(getPaymentProvider);
const cancelExpiredPaymentMock = vi.mocked(cancelExpiredPayment);

describe("cancelPendingPaymentManually", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancela no gateway com o providerPaymentId certo e só então cancela localmente", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({ status: "PENDING", providerPaymentId: "mp-123" });
    const cancelPaymentGateway = vi.fn().mockResolvedValueOnce(undefined);
    getPaymentProviderMock.mockResolvedValueOnce({ cancelPayment: cancelPaymentGateway } as any);
    cancelExpiredPaymentMock.mockResolvedValueOnce(true);

    const result = await cancelPendingPaymentManually("payment-1");

    expect(cancelPaymentGateway).toHaveBeenCalledWith("mp-123");
    expect(cancelExpiredPaymentMock).toHaveBeenCalledWith("payment-1");
    expect(result).toEqual({ ok: true });
  });

  it("se o gateway recusar o cancelamento, retorna erro e NUNCA cancela localmente", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({ status: "PENDING", providerPaymentId: "mp-123" });
    const cancelPaymentGateway = vi.fn().mockRejectedValueOnce(new Error("já foi aprovado"));
    getPaymentProviderMock.mockResolvedValueOnce({ cancelPayment: cancelPaymentGateway } as any);

    const result = await cancelPendingPaymentManually("payment-1");

    expect(cancelPaymentGateway).toHaveBeenCalledWith("mp-123");
    expect(cancelExpiredPaymentMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("retorna erro sem chamar o provider quando o pagamento não está mais PENDING", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({ status: "EXPIRED", providerPaymentId: "mp-123" });

    const result = await cancelPendingPaymentManually("payment-1");

    expect(getPaymentProviderMock).not.toHaveBeenCalled();
    expect(cancelExpiredPaymentMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it("retorna erro sem chamar o provider quando o pagamento não tem providerPaymentId", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({ status: "PENDING", providerPaymentId: null });

    const result = await cancelPendingPaymentManually("payment-1");

    expect(getPaymentProviderMock).not.toHaveBeenCalled();
    expect(cancelExpiredPaymentMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});
