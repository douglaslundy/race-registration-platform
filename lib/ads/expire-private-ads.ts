import { db } from "../db";
import { ACTIVE_STATUSES } from "./private-ads";

export async function expirePrivateAds(): Promise<{ expired: number }> {
  const result = await db.privateAd.updateMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      adPurchase: { endAt: { lt: new Date() } },
    },
    data: { status: "EXPIRED" },
  });
  return { expired: result.count };
}
