import { db } from "./db";
import { ALL_SHIRT_SIZES } from "./shirt-size-restriction";

export interface ShirtSizeAvailability {
  size: string;
  quantity: number | null;
  usedCount: number;
  remaining: number | null;
}

export function computeShirtSizeAvailability(
  sizes: string[],
  quotas: { size: string; quantity: number }[],
  usage: { size: string; count: number }[],
): ShirtSizeAvailability[] {
  const quotaBySize = new Map(quotas.map((q) => [q.size, q.quantity]));
  const usedBySize = new Map(usage.map((u) => [u.size, u.count]));

  return sizes.map((size) => {
    const quantity = quotaBySize.get(size) ?? null;
    const usedCount = usedBySize.get(size) ?? 0;
    const remaining = quantity === null ? null : Math.max(0, quantity - usedCount);
    return { size, quantity, usedCount, remaining };
  });
}

export async function getShirtSizeAvailability(eventId: string): Promise<ShirtSizeAvailability[]> {
  const [quotas, usage] = await Promise.all([
    db.eventShirtSizeQuota.findMany({ where: { eventId }, select: { size: true, quantity: true } }),
    db.registration.groupBy({
      by: ["shirtSize"],
      where: { eventId, shirtSize: { not: null }, status: { not: "CANCELLED" } },
      _count: { _all: true },
    }),
  ]);

  return computeShirtSizeAvailability(
    ALL_SHIRT_SIZES,
    quotas,
    usage
      .filter((u) => u.shirtSize !== null)
      .map((u) => ({ size: u.shirtSize as string, count: u._count._all })),
  );
}

export function formatShirtSizeLabel(size: string, remaining?: number): string {
  return remaining !== undefined ? `${size} (restam ${remaining})` : size;
}
