import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

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

export interface MultiSeriesDay {
  label: string;
  [series: string]: string | number;
}

function dayLabels(from: Date, to: Date): string[] {
  const labels: string[] = [];
  for (const cur = new Date(from); cur <= to; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const [, month, day] = cur.toISOString().slice(0, 10).split("-");
    labels.push(`${day}/${month}`);
  }
  return labels;
}

function bucketSeriesByDay(
  entries: Array<{ date: Date; series: string }>,
  seriesNames: string[],
  from: Date,
  to: Date,
): MultiSeriesDay[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const [, month, day] = e.date.toISOString().slice(0, 10).split("-");
    const key = `${day}/${month}|${e.series}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return dayLabels(from, to).map((label) => {
    const row: MultiSeriesDay = { label };
    for (const name of seriesNames) row[name] = counts.get(`${label}|${name}`) ?? 0;
    return row;
  });
}

/** Uso diário por cupom, restrito aos 5 códigos mais usados no período. */
export async function getDailyCouponUsageByCode(
  from: Date,
  to: Date,
  scope: { organizerId?: string },
): Promise<{ data: MultiSeriesDay[]; series: string[] }> {
  const orders = await db.order.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      couponId: { not: null },
      ...(scope.organizerId ? { event: { organizerId: scope.organizerId } } : {}),
    },
    select: { createdAt: true, coupon: { select: { code: true } } },
  });

  const totals = new Map<string, number>();
  for (const o of orders) {
    const code = o.coupon?.code;
    if (code) totals.set(code, (totals.get(code) ?? 0) + 1);
  }
  const series = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code]) => code);
  const topSet = new Set(series);

  const entries = orders
    .filter((o) => o.coupon && topSet.has(o.coupon.code))
    .map((o) => ({ date: o.createdAt, series: o.coupon!.code }));

  return { data: bucketSeriesByDay(entries, series, from, to), series };
}

export const COUPON_PRESENCE_SERIES = ["Com cupom", "Sem cupom"] as const;

/** Inscrições diárias divididas entre pedidos com e sem cupom. */
export async function getDailyRegistrationsByCouponPresence(
  from: Date,
  to: Date,
  scope: { organizerId?: string; eventId?: string },
): Promise<{ data: MultiSeriesDay[]; series: string[] }> {
  const registrations = await db.registration.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      ...(scope.eventId ? { eventId: scope.eventId } : {}),
      ...(scope.organizerId ? { event: { organizerId: scope.organizerId } } : {}),
    },
    select: { createdAt: true, order: { select: { couponId: true } } },
  });

  const series = [...COUPON_PRESENCE_SERIES];
  const entries = registrations.map((r) => ({
    date: r.createdAt,
    series: r.order.couponId ? series[0] : series[1],
  }));

  return { data: bucketSeriesByDay(entries, series, from, to), series };
}

/**
 * Where-clause do card "Receita no período" do dashboard do ORGANIZADOR
 * (`db.order.aggregate({ _sum: { subtotalAmount } })`).
 *
 * Extraído e testado de propósito: o filtro de evento já foi esquecido aqui uma vez — todo o
 * resto do dashboard restringia por `eventId` e só a receita somava todos os eventos do
 * organizador. `paidAt` (não `Order.createdAt`) porque pra Pix/boleto a criação e a confirmação
 * do pagamento caem em dias diferentes.
 */
export function organizerRevenueWhere(scope: {
  organizerId: string;
  from: Date;
  to: Date;
  eventId?: string;
}): Prisma.OrderWhereInput {
  return {
    status: "PAID",
    event: { organizerId: scope.organizerId },
    payments: { some: { status: "PAID", paidAt: { gte: scope.from, lte: scope.to } } },
    ...(scope.eventId ? { eventId: scope.eventId } : {}),
  };
}

/**
 * Where-clause do card "Receita no período" do dashboard do ADMIN
 * (`db.payment.aggregate({ _sum: { amount } })`). Mesmo cuidado com o filtro de evento, que
 * aqui chega via `order.eventId` (o pagamento não tem `eventId` próprio). Pagamentos sem pedido
 * (compra de anúncio) são naturalmente excluídos quando há filtro de evento.
 */
export function adminRevenueWhere(scope: {
  from: Date;
  to: Date;
  eventId?: string;
}): Prisma.PaymentWhereInput {
  return {
    status: "PAID",
    paidAt: { gte: scope.from, lte: scope.to },
    ...(scope.eventId ? { order: { is: { eventId: scope.eventId } } } : {}),
  };
}
