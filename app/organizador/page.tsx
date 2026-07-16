import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import DeleteEventButton from "@/components/organizer/DeleteEventButton";
import { BADGE } from "@/lib/badge-colors";
import PrintButton from "@/components/ui/PrintButton";
import { computeRegistrationStatusBreakdown } from "@/lib/organizer/event-metrics";
import { parseDateInput } from "@/lib/admin/audit";
import { getDailyRegistrations, getDailyCouponUsageByCode, getDailyRegistrationsByCouponPresence } from "@/lib/dashboard-metrics";
import LineChart from "@/components/ui/LineChart";
import MultiLineChart from "@/components/ui/MultiLineChart";

export const dynamic = "force-dynamic";

const EVENT_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT:                 { label: "Rascunho",             cls: BADGE.gray },
  UNDER_REVIEW:          { label: "Em análise",           cls: BADGE.yellow },
  PUBLISHED:             { label: "Publicado",            cls: BADGE.blue },
  REGISTRATIONS_OPEN:    { label: "Inscrições abertas",   cls: BADGE.green },
  SOLD_OUT:              { label: "Esgotado",             cls: BADGE.orange },
  REGISTRATIONS_CLOSED:  { label: "Inscrições encerradas",cls: BADGE.gray },
  COMPLETED:             { label: "Concluído",            cls: BADGE.green },
  CANCELLED:             { label: "Cancelado",            cls: BADGE.red },
};

export default async function OrganizerDashboard({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; eventId?: string }>;
}) {
  const session = await requireOrganizer();
  const { de, ate, eventId } = await searchParams;

  const organizer = await db.organizerProfile.findUnique({
    where: { userId: session.user.id },
    include: {
      events: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          orders: {
            where: { status: "PAID" },
            select: { totalAmount: true },
          },
        },
      },
    },
  });

  if (!organizer) {
    return (
      <div className="text-center py-16">
        <h1 className="text-2xl font-bold mb-4">Configure seu perfil de organizador</h1>
        <Link href="/organizador/perfil" className="btn-primary">Configurar perfil</Link>
      </div>
    );
  }

  const to = parseDateInput(ate, true) ?? new Date();
  const from = parseDateInput(de, false) ?? (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 29);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  })();

  const [eventCount, totalRegistrations, revenueAgg, confirmedRegistrations, pendingRegistrations, cancelledRegistrations, statusGroups] = await Promise.all([
    db.event.count({ where: { organizerId: organizer.id, createdAt: { gte: from, lte: to } } }),
    db.registration.count({ where: { event: { organizerId: organizer.id }, createdAt: { gte: from, lte: to }, ...(eventId ? { eventId } : {}) } }),
    db.order.aggregate({
      // Receita do organizador = valor das inscrições (subtotal). totalAmount inclui
      // taxa da plataforma e taxa de serviço, que são receita da plataforma, não dele.
      _sum: { subtotalAmount: true },
      where: { status: "PAID", event: { organizerId: organizer.id }, createdAt: { gte: from, lte: to } },
    }),
    db.registration.count({ where: { event: { organizerId: organizer.id }, status: "CONFIRMED", createdAt: { gte: from, lte: to }, ...(eventId ? { eventId } : {}) } }),
    db.registration.count({ where: { event: { organizerId: organizer.id }, status: "PENDING_PAYMENT", createdAt: { gte: from, lte: to }, ...(eventId ? { eventId } : {}) } }),
    db.registration.count({ where: { event: { organizerId: organizer.id }, status: "CANCELLED", createdAt: { gte: from, lte: to }, ...(eventId ? { eventId } : {}) } }),
    db.registration.groupBy({
      by: ["eventId", "status"],
      where: { event: { organizerId: organizer.id } },
      _count: { id: true },
    }),
  ]);
  const totalRevenue = revenueAgg._sum.subtotalAmount ?? 0;

  const statusCountsByEvent = new Map<string, { status: string; count: number }[]>();
  for (const g of statusGroups) {
    const arr = statusCountsByEvent.get(g.eventId) ?? [];
    arr.push({ status: g.status, count: g._count.id });
    statusCountsByEvent.set(g.eventId, arr);
  }

  const [registrationsData, couponUsage, couponPresence, chartEvents] = await Promise.all([
    getDailyRegistrations(from, to, { organizerId: organizer.id, eventId: eventId || undefined }),
    getDailyCouponUsageByCode(from, to, { organizerId: organizer.id }),
    getDailyRegistrationsByCouponPresence(from, to, { organizerId: organizer.id, eventId: eventId || undefined }),
    db.event.findMany({ where: { organizerId: organizer.id }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link href="/organizador/eventos/novo" className="btn-primary">+ Novo Evento</Link>
      </div>

      <form method="GET" className="flex items-center justify-between flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2">
          <label className="text-gray-600">De</label>
          <input type="date" name="de" defaultValue={de ?? from.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
          <label className="text-gray-600">Até</label>
          <input type="date" name="ate" defaultValue={ate ?? to.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-gray-600">Evento (inscrições)</label>
          <select name="eventId" defaultValue={eventId ?? ""} className="input-field py-1 text-sm">
            <option value="">Todos os eventos</option>
            {chartEvents.map((e) => (
              <option key={e.id} value={e.id}>{e.title}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary py-1 px-4 text-sm">Filtrar</button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card text-center">
          <p className="text-3xl font-bold text-primary-600">{eventCount}</p>
          <p className="text-gray-600 mt-1">Novos eventos</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{totalRegistrations}</p>
          <p className="text-gray-600 mt-1">Inscrições no período</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-blue-600">{formatCurrency(totalRevenue)}</p>
          <p className="text-gray-600 mt-1">Receita no período</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{confirmedRegistrations}</p>
          <p className="text-gray-600 mt-1 text-sm">Inscrições efetivadas</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-yellow-600">{pendingRegistrations}</p>
          <p className="text-gray-600 mt-1 text-sm">Inscrições pendentes</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-red-600">{cancelledRegistrations}</p>
          <p className="text-gray-600 mt-1 text-sm">Inscrições canceladas</p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Inscrições</h2>
          <LineChart data={registrationsData} color="#0ea5e9" name="Inscrições" />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Cupons mais utilizados (top 5)</h2>
          <MultiLineChart data={couponUsage.data} series={couponUsage.series} />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Inscrições com e sem cupom</h2>
          <MultiLineChart data={couponPresence.data} series={couponPresence.series} />
        </div>
      </div>

      <div className="card" id="meus-eventos">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold">Meus Eventos</h2>
            <p className="text-xs text-gray-500">Abra um evento para editar, criar lotes e cupons.</p>
          </div>
          <div className="flex gap-2 print:hidden">
            <Link href="/api/organizer/events/export" className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
              Exportar CSV
            </Link>
            <PrintButton label="PDF" />
          </div>
        </div>
        {organizer.events.length === 0 ? (
          <p className="text-gray-500 text-center py-8">Nenhum evento criado ainda</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b dark:border-gray-700">
                <th className="pb-2">Evento</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Inscrições</th>
                <th className="pb-2">Receita</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {organizer.events.map((event) => {
                const breakdown = computeRegistrationStatusBreakdown(statusCountsByEvent.get(event.id) ?? []);
                return (
                <tr key={event.id} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="py-3 font-medium">{event.title}</td>
                  <td className="py-3">
                    {(() => { const s = EVENT_STATUS[event.status] ?? { label: event.status, cls: BADGE.gray }; return (
                      <span className={`text-xs px-2 py-1 rounded font-medium ${s.cls}`}>{s.label}</span>
                    ); })()}
                  </td>
                  <td className="py-3">
                    <p>{breakdown.paid} confirmadas</p>
                    <p className="text-xs text-gray-400">{breakdown.pending} pendentes · {breakdown.cancelled} canceladas</p>
                  </td>
                  <td className="py-3">{formatCurrency(event.orders.reduce((s, o) => s + o.totalAmount, 0))}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      <Link href={`/organizador/eventos/${event.id}`} className="text-primary-600 hover:underline">
                        Gerenciar
                      </Link>
                      {["DRAFT", "CANCELLED"].includes(event.status) && (
                        <DeleteEventButton eventId={event.id} />
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
