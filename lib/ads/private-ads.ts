import sharp from "sharp";
import { db } from "../db";

export async function listAvailableSlotsForAdvertiser() {
  return db.adSlot.findMany({
    where: { privateAds: { none: { status: "APPROVED" } } },
    orderBy: { key: "asc" },
  });
}

const ACTIVE_STATUSES = ["APPROVED", "PENDING_APPROVAL"];

export async function hasAvailableSlotInPurchase(adPurchaseId: string): Promise<boolean> {
  const purchase = await db.adPurchase.findUnique({
    where: { id: adPurchaseId },
    include: { adPlan: true, ads: true },
  });
  if (!purchase) return false;

  const activeCount = purchase.ads.filter((ad) => ACTIVE_STATUSES.includes(ad.status)).length;
  return activeCount < purchase.adPlan.maxSimultaneousSlots;
}

export async function validateImageDimensions(
  buffer: Buffer,
  expectedWidth: number,
  expectedHeight: number,
): Promise<boolean> {
  const metadata = await sharp(buffer).metadata();
  return metadata.width === expectedWidth && metadata.height === expectedHeight;
}
