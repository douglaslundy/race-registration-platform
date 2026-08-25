import { formatCurrency } from "@/lib/format";
import type { GeneralReportDashboard as GeneralReportDashboardData } from "@/lib/reports/general-report";

export default function GeneralReportDashboard({ dashboard }: { dashboard: GeneralReportDashboardData }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3 print:hidden">
      <div className="card">
        <p className="text-xs text-gray-500">Inscrições</p>
        <p className="text-3xl font-bold mt-1">{dashboard.totalRegistrations}</p>
        <div className="mt-3 space-y-1 text-sm">
          {dashboard.byRoute.length === 0 ? (
            <p className="text-gray-400">Nenhum percurso.</p>
          ) : (
            dashboard.byRoute.map((r) => (
              <div key={r.name} className="flex justify-between text-gray-600 dark:text-gray-300">
                <span>{r.name}</span>
                <span className="font-medium">{r.count}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <p className="text-xs text-gray-500">Camisetas</p>
        <p className="text-3xl font-bold mt-1">{dashboard.totalShirts}</p>
        <div className="mt-3 space-y-1 text-sm">
          {dashboard.byShirtSize.length === 0 ? (
            <p className="text-gray-400">Nenhum tamanho informado.</p>
          ) : (
            dashboard.byShirtSize.map((s) => (
              <div key={s.size} className="flex justify-between text-gray-600 dark:text-gray-300">
                <span>{s.size}</span>
                <span className="font-medium">{s.count}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <p className="text-xs text-gray-500">Valor Pago</p>
        <p className="text-3xl font-bold mt-1">{formatCurrency(dashboard.totalPaidAmount)}</p>
        <div className="mt-3 space-y-1 text-sm">
          {dashboard.byAmount.length === 0 ? (
            <p className="text-gray-400">Nenhum pagamento confirmado ainda.</p>
          ) : (
            dashboard.byAmount.map((a) => (
              <div key={a.amount} className="flex justify-between text-gray-600 dark:text-gray-300">
                <span>{a.count} × {formatCurrency(a.amount)}</span>
                <span className="font-medium">{formatCurrency(a.subtotal)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
