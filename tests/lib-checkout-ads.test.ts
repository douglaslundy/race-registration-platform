import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createAdPlanCheckout } from "@/lib/checkout-ads";

const dbMock = db as any;

describe("createAdPlanCheckout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lança erro quando o plano não existe ou está inativo", async () => {
    dbMock.adPlan.findUnique.mockResolvedValueOnce(null);
    await expect(createAdPlanCheckout("adv-1", "plan-1")).rejects.toThrow("Plano não encontrado");
  });

  it("lança erro quando o plano está desativado", async () => {
    dbMock.adPlan.findUnique.mockResolvedValueOnce({ id: "plan-1", active: false, priceAmount: 9900 });
    await expect(createAdPlanCheckout("adv-1", "plan-1")).rejects.toThrow("Plano não encontrado");
  });

  it("cria AdPurchase(status=PENDING) e retorna o id + valor total", async () => {
    dbMock.adPlan.findUnique.mockResolvedValueOnce({ id: "plan-1", active: true, priceAmount: 9900 });
    dbMock.adPurchase.create.mockResolvedValueOnce({ id: "purchase-1" });

    const result = await createAdPlanCheckout("adv-1", "plan-1");

    expect(dbMock.adPurchase.create).toHaveBeenCalledWith({
      data: { advertiserId: "adv-1", adPlanId: "plan-1", status: "PENDING" },
    });
    expect(result).toEqual({ adPurchaseId: "purchase-1", totalAmount: 9900 });
  });
});
