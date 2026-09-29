import { db } from "./db";

export function computeSoldOutShirtSizes(
  quotas: { size: string; quantity: number }[],
  usage: { size: string; count: number }[],
): string[] {
  const usedBySize = new Map(usage.map((u) => [u.size, u.count]));
  return quotas.filter((q) => (usedBySize.get(q.size) ?? 0) >= q.quantity).map((q) => q.size);
}

export async function getSoldOutShirtSizes(eventId: string): Promise<string[]> {
  const [quotas, usage] = await Promise.all([
    db.eventShirtSizeQuota.findMany({ where: { eventId }, select: { size: true, quantity: true } }),
    db.registration.groupBy({
      by: ["shirtSize"],
      where: { eventId, shirtSize: { not: null }, status: { not: "CANCELLED" } },
      _count: { _all: true },
    }),
  ]);

  return computeSoldOutShirtSizes(
    quotas,
    usage
      .filter((u) => u.shirtSize !== null)
      .map((u) => ({ size: u.shirtSize as string, count: u._count._all })),
  );
}
