import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const [totalUsers, totalEvents, totalOrders, pendingEvents, recentAuditLogs] = await Promise.all([
    db.user.count(),
    db.event.count(),
    db.order.count({ where: { status: "PAID" } }),
    db.event.count({ where: { status: "UNDER_REVIEW" } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  const revenue = await db.payment.aggregate({
    _sum: { amount: true },
    where: { status: "PAID" },
  });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Painel Administrativo</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card text-center">
          <p className="text-3xl font-bold text-primary-600">{totalUsers}</p>
          <p className="text-gray-600 text-sm mt-1">Usuários</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-blue-600">{totalEvents}</p>
          <p className="text-gray-600 text-sm mt-1">Eventos</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{totalOrders}</p>
          <p className="text-gray-600 text-sm mt-1">Pedidos pagos</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-purple-600">{formatCurrency(revenue._sum.amount ?? 0)}</p>
          <p className="text-gray-600 text-sm mt-1">Receita</p>
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

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Audit Log (recente)</h2>
        <div className="space-y-2 text-sm">
          {recentAuditLogs.map((log) => (
            <div key={log.id} className="flex items-center gap-3 py-2 border-b last:border-0">
              <span className="bg-gray-100 px-2 py-0.5 rounded font-mono text-xs">{log.action}</span>
              <span className="text-gray-500">{log.entityType}:{log.entityId?.substring(0, 8)}</span>
              <span className="text-gray-400 ml-auto text-xs">{log.createdAt.toLocaleString("pt-BR")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
