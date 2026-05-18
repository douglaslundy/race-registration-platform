import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Repasses — Admin" };

export default async function AdminRepassesPage() {
  await requireAdmin();

  const payouts = await db.transferPayout.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      event: { select: { title: true } },
      organizer: { include: { user: { select: { name: true } } } },
    },
  });

  const pending = payouts.filter((p) => p.status === "PENDING");
  const completed = payouts.filter((p) => p.status === "COMPLETED");
  const totalCompleted = completed.reduce((s, p) => s + p.grossAmount, 0);
  const totalPending = pending.reduce((s, p) => s + p.grossAmount, 0);

  const STATUS_COLOR: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-700",
    PROCESSING: "bg-blue-100 text-blue-700",
    COMPLETED: "bg-green-100 text-green-700",
    FAILED: "bg-red-100 text-red-600",
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Repasses</h1>

      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-yellow-600">{formatCurrency(totalPending)}</p>
          <p className="text-gray-500 text-sm">Pendentes ({pending.length})</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-green-600">{formatCurrency(totalCompleted)}</p>
          <p className="text-gray-500 text-sm">Realizados ({completed.length})</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold">{payouts.length}</p>
          <p className="text-gray-500 text-sm">Total</p>
        </div>
      </div>

      {payouts.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">Nenhum repasse gerado ainda.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b text-xs uppercase">
                <th className="pb-2 pr-4">Evento</th>
                <th className="pb-2 pr-4">Organizador</th>
                <th className="pb-2 pr-4">Bruto</th>
                <th className="pb-2 pr-4">Taxa</th>
                <th className="pb-2 pr-4">Líquido</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Data</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 pr-4 truncate max-w-xs">{p.event.title}</td>
                  <td className="py-2 pr-4 text-gray-600">{p.organizer.user.name}</td>
                  <td className="py-2 pr-4 font-medium">{formatCurrency(p.grossAmount)}</td>
                  <td className="py-2 pr-4 text-red-500">-{formatCurrency(p.platformFee)}</td>
                  <td className="py-2 pr-4 font-bold text-green-700">{formatCurrency(p.netAmount)}</td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[p.status] ?? ""}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="py-2 text-gray-400 text-xs">{formatDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
