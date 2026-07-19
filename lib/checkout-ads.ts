import { db } from "./db";

export interface AdPlanCheckoutResult {
  adPurchaseId: string;
  totalAmount: number;
}

export async function createAdPlanCheckout(advertiserId: string, adPlanId: string): Promise<AdPlanCheckoutResult> {
  const plan = await db.adPlan.findUnique({ where: { id: adPlanId } });
  if (!plan || !plan.active) {
    throw new Error("Plano não encontrado");
  }

  const purchase = await db.adPurchase.create({
    data: { advertiserId, adPlanId, status: "PENDING" },
  });

  return { adPurchaseId: purchase.id, totalAmount: plan.priceAmount };
}
