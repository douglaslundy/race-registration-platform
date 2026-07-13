import { db } from "@/lib/db";

interface DailyPoint {
  label: string;
  value: number;
}

function bucketByDay(dates: Date[], from: Date, to: Date): DailyPoint[] {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = d.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const days: DailyPoint[] = [];
  for (const cur = new Date(from); cur <= to; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const key = cur.toISOString().slice(0, 10);
    const [, month, day] = key.split("-");
    days.push({ label: `${day}/${month}`, value: counts.get(key) ?? 0 });
  }
  return days;
}

export async function getDailySignups(from: Date, to: Date): Promise<DailyPoint[]> {
  const users = await db.user.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { createdAt: true },
  });
  return bucketByDay(users.map((u) => u.createdAt), from, to);
}

export async function getDailyRegistrations(
  from: Date,
  to: Date,
  scope: { organizerId?: string; eventId?: string },
): Promise<DailyPoint[]> {
  const registrations = await db.registration.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      ...(scope.eventId ? { eventId: scope.eventId } : {}),
      ...(scope.organizerId ? { event: { organizerId: scope.organizerId } } : {}),
    },
    select: { createdAt: true },
  });
  return bucketByDay(registrations.map((r) => r.createdAt), from, to);
}

export async function getDailyCouponUsage(
  from: Date,
  to: Date,
  scope: { organizerId?: string },
): Promise<DailyPoint[]> {
  const orders = await db.order.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      couponId: { not: null },
      ...(scope.organizerId ? { event: { organizerId: scope.organizerId } } : {}),
    },
    select: { createdAt: true },
  });
  return bucketByDay(orders.map((o) => o.createdAt), from, to);
}
