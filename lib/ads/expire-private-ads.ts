import { db } from "../db";

export async function expirePrivateAds(): Promise<{ expired: number }> {
  const result = await db.privateAd.updateMany({
    where: {
      status: { in: ["APPROVED", "PENDING_APPROVAL"] },
      adPurchase: { endAt: { lt: new Date() } },
    },
    data: { status: "EXPIRED" },
  });
  return { expired: result.count };
}
