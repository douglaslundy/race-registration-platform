import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/format";
import ApproveEventButton from "@/components/admin/ApproveEventButton";
import GeneratePayoutButton from "@/components/admin/GeneratePayoutButton";
import EventDailySummaryRecipientsManager from "@/components/organizer/EventDailySummaryRecipientsManager";
import { EVENT_STATUS_LABEL, MODALITY_LABEL } from "@/lib/admin/labels";
import {
  computeRegistrationStatusBreakdown,
  computeDimensionBreakdowns,
  buildPaymentMethodSummary,
  computeShirtSizeBreakdown,
} from "@/lib/organizer/event-metrics";
import { computeRevenueBreakdown } from "@/lib/revenue-breakdown";
import { PAYMENT_METHOD_LABEL } from "@/components/registrations/RegistrationsTable";
import RevenueBreakdownCard from "@/components/ui/RevenueBreakdownCard";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Detalhe do Evento — Admin" };

export default async function AdminEventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const event = await db.event.findUnique({
    where: { id },
    include: {
      organizer: { include: { user: { select: { id: true, name: true, email: true } } } },
      routes: { orderBy: { distanceKm: "asc" } },
      categories: { orderBy: { name: "asc" } },
      ticketBatches: { orderBy: { startAt: "asc" } },
      coupons: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!event) notFound();

  const [couponStats, statusCounts, dimensionRegistrations, paymentGroups, paymentsAgg, orderFeeAgg] = await Promise.all([
    event.coupons.length > 0
      ? db.order.groupBy({
          by: ["couponId"],
          where: {
            eventId: id,
            couponId: { in: event.coupons.map((c) => c.id) },
            status: "PAID",
          },
          _count: { id: true },
          _sum: { discountAmount: true },
        })
      : Promise.resolve([]),
    db.registration.groupBy({
      by: ["status"],
      where: { eventId: id },
      _count: { id: true },
    }),
    db.registration.findMany({
      where: { eventId: id, status: "CONFIRMED" },
      select: { routeId: true, categoryId: true, ticketBatchId: true, shirtSize: true, order: { select: { subtotalAmount: true } } },
    }),
    db.payment.groupBy({
      by: ["method"],
      where: { status: "PAID", order: { eventId: id } },
      _count: { id: true },
      _sum: { amount: true },
    }),
    db.payment.aggregate({
      _sum: { amount: true, gatewayFeeAmount: true },
      where: { status: "PAID", order: { eventId: id } },
    }),
    db.order.aggregate({
      _sum: { subtotalAmount: true, platformFeeAmount: true, paymentFeeAmount: true },
      where: { status: "PAID", eventId: id },
    }),
  ]);

  const revenueBreakdown = computeRevenueBreakdown({
    grossRevenue: paymentsAgg._sum.amount,
    eventRevenue: orderFeeAgg._sum.subtotalAmount,
    platformFeeAmount: orderFeeAgg._sum.platformFeeAmount,
    serviceFeeAmount: orderFeeAgg._sum.paymentFeeAmount,
    gatewayFeeAmount: paymentsAgg._sum.gatewayFeeAmount,
  });
  const revenue = revenueBreakdown.grossRevenue;

  const statsMap = new Map(
    couponStats.map((s) => [s.couponId, { uses: s._count.id, discount: s._sum.discountAmount ?? 0 }])
  );
  const totalCouponOrders = couponStats.reduce((s, c) => s + c._count.id, 0);
  const totalDiscount = couponStats.reduce((s, c) => s + (c._sum.discountAmount ?? 0), 0);

  const breakdown = computeRegistrationStatusBreakdown(
    statusCounts.map((s) => ({ status: s.status, count: s._count.id }))
  );

  // Attributes the full order subtotal to each registration — correct only because checkout is
  // strictly 1 registration per order today; would double-count if that ever changes.
  const { byRoute, byCategory, byTicketBatch } = computeDimensionBreakdowns(
    dimensionRegistrations.map((r) => ({
      routeId: r.routeId,
      categoryId: r.categoryId,
      ticketBatchId: r.ticketBatchId,
      orderSubtotalAmount: r.order.subtotalAmount,
    })),
  );
  const paymentMethodSummary = buildPaymentMethodSummary(
    paymentGroups.map((g) => ({ method: g.method, count: g._count.id, revenue: g._sum.amount ?? 0 })),
  );
  const shirtSizeBreakdown = computeShirtSizeBreakdown(
    dimensionRegistrations.map((r) => ({ shirtSize: r.shirtSize })),
  );

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/admin/eventos" className="hover:text-primary-600">← Eventos</Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <p className="text-sm text-gray-500 mt-1">{MODALITY_LABEL[event.modality] ?? event.modality} · {formatDate(event.startAt)} · {event.city}/{event.state}</p>
          <span className="text-xs bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 px-2 py-0.5 rounded mt-1 inline-block">{EVENT_STATUS_LABEL[event.status] ?? event.status}</span>
        </div>
        <div className="flex items-center gap-2">
          <GeneratePayoutButton eventId={event.id} />
          {event.status === "UNDER_REVIEW" && (
            <ApproveEventButton eventId={event.id} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-primary-600">{breakdown.paid}</p>
          <p className="text-gray-500 text-sm">Inscrições confirmadas</p>
          <p className="text-xs text-gray-400 mt-1">{breakdown.pending} pendentes · {breakdown.cancelled} canceladas</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-green-600">{formatCurrency(revenue)}</p>
          <p className="text-gray-500 text-sm">Receita</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold">{event.ticketBatches.reduce((s, b) => s + b.capacity, 0)}</p>
          <p className="text-gray-500 text-sm">Vagas totais</p>
        </div>
      </div>

      <RevenueBreakdownCard breakdown={revenueBreakdown} variant="admin" />

      {event.coupons.length > 0 && (
        <div className="card space-y-5">
          <h2 className="font-semibold">Uso de cupons</h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-primary-600">{event.coupons.length}</p>
              <p className="text-xs text-gray-500 mt-0.5">Cupons criados</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{totalCouponOrders}</p>
              <p className="text-xs text-gray-500 mt-0.5">Pedidos com cupom</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-orange-600">{formatCurrency(totalDiscount)}</p>
              <p className="text-xs text-gray-500 mt-0.5">Desconto concedido</p>
            </div>
          </div>
          <div className="space-y-2">
            {event.coupons.map((c) => {
              const stat = statsMap.get(c.id);
              const uses = stat?.uses ?? 0;
              const discount = stat?.discount ?? 0;
              const maxUses = c.maxUses ?? null;
              const pct = maxUses ? Math.min(100, Math.round((uses / maxUses) * 100)) : null;
              const discountLabel =
                c.discountType === "PERCENT"
                  ? `${c.discountValue}% off`
                  : `${formatCurrency(c.discountValue)} off`;

              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-sm">{c.code}</span>
                      <span className="text-xs text-gray-500">{discountLabel}</span>
                      {!c.active && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500">
                          inativo
                        </span>
                      )}
                    </div>
                    {pct !== null && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                          <div className="h-full bg-primary-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">{pct}%</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <p className="text-sm font-semibold">
                      {uses} uso{uses !== 1 ? "s" : ""}
                      {maxUses ? ` / ${maxUses}` : ""}
                    </p>
                    {discount > 0 && (
                      <p className="text-xs text-green-700 dark:text-green-400">
                        {formatCurrency(discount)} concedidos
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card space-y-3">
        <h2 className="font-semibold">Organizador</h2>
        <div className="flex items-center justify-between text-sm">
          <div>
            <p className="font-medium">{event.organizer.user.name}</p>
            <p className="text-gray-500">{event.organizer.user.email}</p>
            {event.organizer.companyName && <p className="text-gray-500">{event.organizer.companyName}</p>}
          </div>
          <Link href={`/admin/usuarios/${event.organizer.userId}`} className="text-xs text-primary-600 hover:underline">
            Ver perfil
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Lotes</h2>
          {event.ticketBatches.map((b) => {
            const stats = byTicketBatch.get(b.id) ?? { count: 0, revenue: 0 };
            return (
              <div key={b.id} className="flex justify-between text-xs border-b pb-1 last:border-0">
                <span>{b.name}</span>
                <span className="text-gray-500">{b.soldCount}/{b.capacity} · {formatCurrency(b.priceAmount)} · receita: {formatCurrency(stats.revenue)}</span>
              </div>
            );
          })}
        </div>
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Percursos</h2>
          {event.routes.map((r) => {
            const stats = byRoute.get(r.id) ?? { count: 0, revenue: 0 };
            return (
              <div key={r.id} className="flex justify-between text-xs border-b pb-1 last:border-0">
                <span>{r.name} <span className="text-gray-400">({r.distanceKm}km)</span></span>
                <span className="text-gray-500">{stats.count} inscritos · {formatCurrency(stats.revenue)}</span>
              </div>
            );
          })}
        </div>
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Categorias</h2>
          {event.categories.map((c) => {
            const stats = byCategory.get(c.id) ?? { count: 0, revenue: 0 };
            return (
              <div key={c.id} className="flex justify-between text-xs border-b pb-1 last:border-0">
                <span>{c.name}</span>
                <span className="text-gray-500">{stats.count} inscritos · {formatCurrency(stats.revenue)}</span>
              </div>
            );
          })}
        </div>
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Tipo de pagamento</h2>
          <p className="text-xs text-gray-400">Valor total pago pelo atleta, incluindo taxas — não é a receita líquida do organizador.</p>
          {paymentMethodSummary.map((p) => (
            <div key={p.method} className="flex justify-between text-xs border-b pb-1 last:border-0">
              <span>{PAYMENT_METHOD_LABEL[p.method] ?? p.method}</span>
              <span className="text-gray-500">{p.count} pagamento{p.count !== 1 ? "s" : ""} · {formatCurrency(p.revenue)} pago</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold text-sm">Camisetas</h2>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {shirtSizeBreakdown.map((s) => (
            <div key={s.size} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-primary-600">{s.count}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <Link href={`/admin/eventos/${event.id}/inscritos`} className="btn-secondary text-sm">
          Ver inscritos
        </Link>
        <Link href={`/api/events/${event.id}/registrations?format=csv`} className="btn-secondary text-sm">
          Exportar inscritos CSV
        </Link>
        <Link href={`/eventos/${event.slug}`} target="_blank" className="btn-secondary text-sm">
          Ver página pública
        </Link>
      </div>

      <EventDailySummaryRecipientsManager eventId={event.id} />
    </div>
  );
}
