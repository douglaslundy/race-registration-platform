import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import type { Metadata } from "next";
import CouponManager, { type CouponRow } from "@/components/admin/CouponManager";
import Link from "next/link";
import PrintButton from "@/components/ui/PrintButton";

export const metadata: Metadata = { title: "Cupons — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminCuponsPage() {
  await requireAdmin();

  const [coupons, events, usage] = await Promise.all([
    db.coupon.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        event: { select: { title: true } },
        createdBy: { select: { name: true, email: true } },
      },
    }),
    db.event.findMany({
      where: { status: { notIn: ["CANCELLED"] } },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    db.order.groupBy({
      by: ["couponId"],
      where: { couponId: { not: null }, status: "PAID" },
      _sum: { discountAmount: true },
      _count: { _all: true },
    }),
  ]);

  const usageMap = new Map(
    usage.map((u) => [u.couponId as string, { discount: u._sum.discountAmount ?? 0, count: u._count._all }])
  );

  // Detalhamento por evento dos cupons globais (em quais eventos foram aplicados).
  const globalIds = coupons.filter((c) => !c.eventId).map((c) => c.id);
  const perEventRaw = globalIds.length
    ? await db.order.groupBy({
        by: ["couponId", "eventId"],
        where: { couponId: { in: globalIds }, status: "PAID" },
        _sum: { discountAmount: true },
        _count: { _all: true },
      })
    : [];

  const eventIds = [...new Set(perEventRaw.map((p) => p.eventId))];
  const eventTitles = eventIds.length
    ? await db.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, title: true } })
    : [];
  const eventTitleMap = new Map(eventTitles.map((e) => [e.id, e.title]));

  const perEventByCoupon = new Map<string, { eventTitle: string; discount: number; count: number }[]>();
  for (const p of perEventRaw) {
    const list = perEventByCoupon.get(p.couponId as string) ?? [];
    list.push({
      eventTitle: eventTitleMap.get(p.eventId) ?? "Evento removido",
      discount: p._sum.discountAmount ?? 0,
      count: p._count._all,
    });
    perEventByCoupon.set(p.couponId as string, list);
  }

  const rows: CouponRow[] = coupons.map((c) => {
    const u = usageMap.get(c.id);
    return {
      id: c.id,
      code: c.code,
      discountType: c.discountType,
      discountValue: c.discountValue,
      maxUses: c.maxUses,
      usedCount: c.usedCount,
      expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
      active: c.active,
      eventId: c.eventId,
      eventTitle: c.event?.title ?? null,
      creatorName: c.createdBy?.name ?? null,
      paidDiscount: u?.discount ?? 0,
      paidCount: u?.count ?? 0,
      perEvent: perEventByCoupon.get(c.id) ?? [],
    };
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Cupons de desconto</h1>
          <p className="text-sm text-gray-500">
          Crie cupons para um evento específico ou globais (todos os eventos) e acompanhe o desconto concedido por
          código — útil para negociar patrocínios.
        </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/api/admin/coupons/export" className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Exportar CSV
          </Link>
          <PrintButton />
        </div>
      </div>
      <CouponManager rows={rows} events={events} />
    </div>
  );
}
