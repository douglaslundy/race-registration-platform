import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/format";
import PublishEventButton from "@/components/organizer/PublishEventButton";
import DuplicateEventButton from "@/components/organizer/DuplicateEventButton";
import ArchiveEventButton from "@/components/organizer/ArchiveEventButton";
import DeleteEventButton from "@/components/organizer/DeleteEventButton";
import PrintButton from "@/components/ui/PrintButton";
import type { Metadata } from "next";
import {
  computeRegistrationStatusBreakdown,
  computeSlotsInfo,
  computeDimensionBreakdowns,
  buildPaymentMethodSummary,
  computeShirtSizeBreakdown,
} from "@/lib/organizer/event-metrics";
import { computeRevenueBreakdown } from "@/lib/revenue-breakdown";
import { PAYMENT_METHOD_LABEL } from "@/components/registrations/RegistrationsTable";
import RevenueBreakdownCard from "@/components/ui/RevenueBreakdownCard";

export const metadata: Metadata = { title: "Gerenciar Evento" };
export const dynamic = "force-dynamic";

import { BADGE } from "@/lib/badge-colors";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  DRAFT:                { label: "Rascunho", color: BADGE.gray },
  UNDER_REVIEW:         { label: "Em análise", color: BADGE.yellow },
  PUBLISHED:            { label: "Publicado", color: BADGE.blue },
  REGISTRATIONS_OPEN:   { label: "Inscrições abertas", color: BADGE.green },
  SOLD_OUT:             { label: "Esgotado", color: BADGE.orange },
  REGISTRATIONS_CLOSED: { label: "Inscrições encerradas", color: BADGE.gray },
  COMPLETED:            { label: "Concluído", color: BADGE.green },
  CANCELLED:            { label: "Cancelado", color: BADGE.red },
};

export default async function OrganizerEventPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrganizer();
  const { id } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    include: {
      routes: { orderBy: { distanceKm: "asc" } },
      categories: { orderBy: { name: "asc" } },
      ticketBatches: { orderBy: { startAt: "asc" } },
      coupons: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!event) notFound();

  // Coupon usage stats grouped by couponId, plus registration status breakdown
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

  const statsMap = new Map(
    couponStats.map((s) => [s.couponId, { uses: s._count.id, discount: s._sum.discountAmount ?? 0 }])
  );

  const totalCouponOrders = couponStats.reduce((s, c) => s + c._count.id, 0);
  const totalDiscount = couponStats.reduce((s, c) => s + (c._sum.discountAmount ?? 0), 0);

  const statusBreakdown = computeRegistrationStatusBreakdown(
    statusCounts.map((s) => ({ status: s.status, count: s._count.id }))
  );

  const slotsInfo = computeSlotsInfo({
    maxParticipants: event.maxParticipants,
    activeRegistrationsCount: statusBreakdown.paid + statusBreakdown.pending,
    batchCapacityTotal: event.ticketBatches.reduce((s, b) => s + b.capacity, 0),
    batchSoldTotal: event.ticketBatches.reduce((s, b) => s + b.soldCount, 0),
  });

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
  const shirtSizeBreakdown = computeShirtSizeBreakdown(
    dimensionRegistrations.map((r) => ({ shirtSize: r.shirtSize })),
  );
  const paymentMethodSummary = buildPaymentMethodSummary(
    paymentGroups.map((g) => ({ method: g.method, count: g._count.id, revenue: g._sum.amount ?? 0 })),
  );

  const revenueBreakdown = computeRevenueBreakdown({
    grossRevenue: paymentsAgg._sum.amount,
    eventRevenue: orderFeeAgg._sum.subtotalAmount,
    platformFeeAmount: orderFeeAgg._sum.platformFeeAmount,
    serviceFeeAmount: orderFeeAgg._sum.paymentFeeAmount,
    gatewayFeeAmount: paymentsAgg._sum.gatewayFeeAmount,
  });
  const revenue = revenueBreakdown.eventRevenue;
  const statusInfo = STATUS_LABEL[event.status] ?? STATUS_LABEL.DRAFT;
  const canPublish = event.status === "DRAFT";
  const canDelete = ["DRAFT", "CANCELLED"].includes(event.status);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href="/organizador" className="hover:text-primary-600">← Dashboard</Link>
          </div>
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusInfo.color}`}>
              {statusInfo.label}
            </span>
            <span className="text-sm text-gray-500">{formatDate(event.startAt)}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
          <Link href={`/organizador/eventos/${id}/editar`} className="btn-secondary text-sm">
            Editar evento
          </Link>
          {canPublish && <PublishEventButton eventId={id} />}
          <DuplicateEventButton eventId={id} />
          {!["COMPLETED", "CANCELLED"].includes(event.status) && <ArchiveEventButton eventId={id} />}
          {canDelete && <DeleteEventButton eventId={id} />}
          <PrintButton label="PDF" />
          <Link href={`/eventos/${event.slug}`} target="_blank" className="btn-secondary text-sm">
            Ver página →
          </Link>
        </div>
      </div>

      {/* Métricas gerais */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-3xl font-bold text-primary-600">{statusBreakdown.paid}</p>
          <p className="text-gray-500 text-sm mt-1">Inscrições confirmadas</p>
          <p className="text-xs text-gray-400 mt-1">
            {statusBreakdown.pending} pendentes · {statusBreakdown.cancelled} canceladas
          </p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{formatCurrency(revenue)}</p>
          <p className="text-gray-500 text-sm mt-1">Receita do evento</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold">{slotsInfo.total}</p>
          <p className="text-gray-500 text-sm mt-1">Vagas totais</p>
          <p className="text-xs text-gray-400 mt-1">restantes: {slotsInfo.remaining}</p>
        </div>
      </div>

      <RevenueBreakdownCard breakdown={revenueBreakdown} variant="organizer" />

      {/* Relatório de cupons — visão geral + agrupado por cupom */}
      {event.coupons.length > 0 && (
        <div className="card space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Uso de cupons</h2>
            <Link
              href={`/organizador/eventos/${id}/cupons/relatorio`}
              className="text-xs text-primary-600 hover:underline"
            >
              Ver relatório completo →
            </Link>
          </div>

          {/* Visão geral */}
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

          {/* Agrupado por cupom */}
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
                          <div
                            className="h-full bg-primary-500 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
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

      {/* Grade: Lotes / Percursos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Lotes */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Lotes de inscrição</h2>
            <Link href={`/organizador/eventos/${id}/lotes`} className="text-xs text-primary-600 hover:underline">
              Gerenciar
            </Link>
          </div>
          {event.ticketBatches.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum lote criado</p>
          ) : (
            <div className="space-y-2">
              {event.ticketBatches.map((b) => {
                const stats = byTicketBatch.get(b.id) ?? { count: 0, revenue: 0 };
                return (
                  <div key={b.id} className="flex justify-between text-sm border-b dark:border-gray-700 pb-2 last:border-0">
                    <span className="font-medium">{b.name}</span>
                    <span className="text-gray-500">{b.soldCount}/{b.capacity} · {formatCurrency(b.priceAmount)} · receita: {formatCurrency(stats.revenue)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Percursos */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Percursos</h2>
            <Link href={`/organizador/eventos/${id}/percursos`} className="text-xs text-primary-600 hover:underline">
              Gerenciar
            </Link>
          </div>
          {event.routes.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum percurso cadastrado</p>
          ) : (
            <div className="space-y-1">
              {event.routes.map((r) => {
                const stats = byRoute.get(r.id) ?? { count: 0, revenue: 0 };
                return (
                  <div key={r.id} className="flex justify-between text-sm border-b dark:border-gray-700 pb-1 last:border-0">
                    <span>{r.name} <span className="text-gray-400">({r.distanceKm}km)</span></span>
                    <span className="text-gray-500">{stats.count} inscritos · {formatCurrency(stats.revenue)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Camisetas — inscrições confirmadas por tamanho */}
      <div className="card space-y-3">
        <h2 className="font-semibold">Camisetas</h2>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {shirtSizeBreakdown.map((s) => (
            <div key={s.size} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-primary-600">{s.count}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Grade: Categorias / Cupons / Tipo de pagamento */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Categorias */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Categorias</h2>
            <Link href={`/organizador/eventos/${id}/categorias`} className="text-xs text-primary-600 hover:underline">
              Gerenciar
            </Link>
          </div>
          {event.categories.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhuma categoria cadastrada</p>
          ) : (
            <div className="space-y-1">
              {event.categories.map((c) => {
                const stats = byCategory.get(c.id) ?? { count: 0, revenue: 0 };
                return (
                  <div key={c.id} className="flex justify-between text-sm border-b dark:border-gray-700 pb-1 last:border-0">
                    <span>{c.name}</span>
                    <span className="text-gray-500">{stats.count} inscritos · {formatCurrency(stats.revenue)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Cupons — card compacto */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Cupons de desconto</h2>
            <Link href={`/organizador/eventos/${id}/cupons`} className="text-xs text-primary-600 hover:underline">
              Gerenciar
            </Link>
          </div>
          {event.coupons.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum cupom criado</p>
          ) : (
            <div className="space-y-1">
              {event.coupons.map((c) => (
                <div key={c.id} className="flex justify-between text-sm border-b dark:border-gray-700 pb-1 last:border-0">
                  <span className="font-mono font-medium">{c.code}</span>
                  <span className="text-gray-500">
                    {c.discountType === "PERCENT" ? `${c.discountValue}%` : formatCurrency(c.discountValue)}
                    {" · "}{c.usedCount}/{c.maxUses ?? "∞"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tipo de pagamento */}
        <div className="card space-y-3">
          <h2 className="font-semibold">Tipo de pagamento</h2>
          <p className="text-xs text-gray-400">Valor total pago pelo atleta, incluindo taxas — não é a receita líquida do organizador.</p>
          <div className="space-y-1">
            {paymentMethodSummary.map((p) => (
              <div key={p.method} className="flex justify-between text-sm border-b dark:border-gray-700 pb-1 last:border-0">
                <span>{PAYMENT_METHOD_LABEL[p.method] ?? p.method}</span>
                <span className="text-gray-500">{p.count} pagamento{p.count !== 1 ? "s" : ""} · {formatCurrency(p.revenue)} pago</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Ações */}
      <div className="flex gap-3">
        <Link href={`/organizador/eventos/${id}/inscritos`} className="btn-secondary flex-1 text-center">
          Ver inscritos
        </Link>
        <Link href={`/organizador/eventos/${id}/resultados`} className="btn-secondary flex-1 text-center">
          Importar resultados
        </Link>
      </div>
    </div>
  );
}
