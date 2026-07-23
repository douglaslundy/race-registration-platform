import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { ACTION_LABEL, ENTITY_LABEL } from "@/lib/admin/labels";
import { parseDateInput } from "@/lib/admin/audit";
import { getDailySignups, getDailyRegistrations, getDailyCouponUsageByCode, getDailyRegistrationsByCouponPresence } from "@/lib/dashboard-metrics";
import LineChart from "@/components/ui/LineChartLazy";
import MultiLineChart from "@/components/ui/MultiLineChartLazy";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; eventId?: string }>;
}) {
  const { de, ate, eventId } = await searchParams;

  const to = parseDateInput(ate, true) ?? new Date();
  const from = parseDateInput(de, false) ?? (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 29);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  })();

  const [totalUsers, totalEvents, totalOrders, pendingEvents, recentAuditLogs, confirmedRegistrations, pendingRegistrations, cancelledRegistrations, revenue] = await Promise.all([
    db.user.count({ where: { createdAt: { gte: from, lte: to } } }),
    db.event.count({ where: { createdAt: { gte: from, lte: to } } }),
    db.order.count({ where: { status: "PAID", createdAt: { gte: from, lte: to } } }),
    db.event.count({ where: { status: "UNDER_REVIEW" } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    db.registration.count({ where: { status: "CONFIRMED", createdAt: { gte: from, lte: to }, ...(eventId ? { eventId } : {}) } }),
    db.registration.count({ where: { status: "PENDING_PAYMENT", createdAt: { gte: from, lte: to }, ...(eventId ? { eventId } : {}) } }),
    db.registration.count({ where: { status: "CANCELLED", createdAt: { gte: from, lte: to }, ...(eventId ? { eventId } : {}) } }),
    // Receita "no período" tem que refletir quando o dinheiro entrou (paidAt), não quando o
    // pedido foi criado — pra Pix/boleto os dois podem cair em dias diferentes.
    db.payment.aggregate({ _sum: { amount: true }, where: { status: "PAID", paidAt: { gte: from, lte: to } } }),
  ]);

  const [signupsData, registrationsData, couponUsage, couponPresence, events] = await Promise.all([
    getDailySignups(from, to),
    getDailyRegistrations(from, to, { eventId: eventId || undefined }),
    getDailyCouponUsageByCode(from, to, {}),
    getDailyRegistrationsByCouponPresence(from, to, { eventId: eventId || undefined }),
    db.event.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>

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
            {events.map((e) => (
              <option key={e.id} value={e.id}>{e.title}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary py-1 px-4 text-sm">Filtrar</button>
      </form>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card text-center">
          <p className="text-3xl font-bold text-primary-600">{totalUsers}</p>
          <p className="text-gray-600 text-sm mt-1">Novos usuários</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-blue-600">{totalEvents}</p>
          <p className="text-gray-600 text-sm mt-1">Novos eventos</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{totalOrders}</p>
          <p className="text-gray-600 text-sm mt-1">Pedidos pagos no período</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-purple-600">{formatCurrency(revenue._sum.amount ?? 0)}</p>
          <p className="text-gray-600 text-sm mt-1">Receita no período</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{confirmedRegistrations}</p>
          <p className="text-gray-600 text-sm mt-1">Inscrições efetivadas</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-yellow-600">{pendingRegistrations}</p>
          <p className="text-gray-600 text-sm mt-1">Inscrições pendentes</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-red-600">{cancelledRegistrations}</p>
          <p className="text-gray-600 text-sm mt-1">Inscrições canceladas</p>
        </div>
      </div>

      {pendingEvents > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center justify-between">
          <p className="text-yellow-800 font-medium">
            {pendingEvents} evento{pendingEvents > 1 ? "s" : ""} aguardando aprovação
          </p>
          <Link href="/admin/eventos?status=UNDER_REVIEW" className="btn-primary text-sm">
            Revisar
          </Link>
        </div>
      )}

      <div className="space-y-6">
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Novos cadastros</h2>
          <LineChart data={signupsData} color="#7c3aed" name="Novos cadastros" />
        </div>
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

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Atividade recente</h2>
        <div className="space-y-2 text-sm">
          {recentAuditLogs.map((log) => (
            <div key={log.id} className="flex items-center gap-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
              <span className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded text-xs">{ACTION_LABEL[log.action] ?? log.action}</span>
              <span className="text-gray-500 dark:text-gray-400">{ENTITY_LABEL[log.entityType] ?? log.entityType}{log.entityId ? `:${log.entityId.substring(0, 8)}` : ""}</span>
              <span className="text-gray-400 dark:text-gray-500 ml-auto text-xs">{log.createdAt.toLocaleString("pt-BR")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
