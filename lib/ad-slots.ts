import { cache } from "react";
import { unstable_noStore as noStore } from "next/cache";
import { db } from "./db";

export interface AdSlotRow {
  id: string;
  key: string;
  label: string;
  width: number;
  height: number;
  enabled: boolean;
  source: string | null;
  googleAdUnitId: string | null;
  houseAdImageUrl: string | null;
  houseAdTargetUrl: string | null;
}

export async function listAdSlots(): Promise<AdSlotRow[]> {
  return db.adSlot.findMany({ orderBy: { key: "asc" } });
}

export const getAdSlot = cache(async (key: string): Promise<AdSlotRow | null> => {
  noStore();
  return db.adSlot.findUnique({ where: { key } });
});

export interface UpdateAdSlotData {
  enabled?: boolean;
  source?: string | null;
  googleAdUnitId?: string | null;
  houseAdImageUrl?: string | null;
  houseAdTargetUrl?: string | null;
}

export async function updateAdSlot(id: string, data: UpdateAdSlotData): Promise<void> {
  await db.adSlot.update({ where: { id }, data });
}

export async function hasActiveGoogleAdSlot(): Promise<boolean> {
  const rows = await db.adSlot.findMany({ where: { enabled: true, source: "GOOGLE" }, take: 1 });
  return rows.length > 0;
}
