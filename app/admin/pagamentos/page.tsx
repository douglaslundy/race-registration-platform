import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pagamentos — Admin" };

const METHOD_LABEL: Record<string, string> = {
  PIX: "Pix", CREDIT_CARD: "Cartão", DEBIT_CARD: "Débito", BOLETO: "Boleto",
};
import { BADGE } from "@/lib/badge-colors";

const STATUS_COLOR: Record<string, string> = {
  PENDING:    BADGE.yellow,
  PAID:       BADGE.green,
  EXPIRED:    BADGE.gray,
  CANCELLED:  BADGE.red,
  REFUNDED:   BADGE.blue,
  CHARGEBACK: BADGE.purple,
};

export default async function AdminPagamentosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  await requireAdmin();
  const { status, page: pageStr } = await searchParams;
  const page = parseInt(pageStr ?? "1");
  const pageSize = 50;

  const where = status ? { status: status as never } : {};

  const [payments, total] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        order: {
          select: {
            id: true,
            totalAmount: true,
            registrations: { select: { event: { select: { title: true } } }, take: 1 },
          },
        },
      },
    }),
    db.payment.count({ where }),
  ]);

  const totalAmount = await db.payment.aggregate({
    _sum: { amount: true },
    where: { status: "PAID" },
  });

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pagamentos</h1>
        <p className="text-sm text-gray-500">Total pago: <strong className="text-green-700">{formatCurrency(totalAmount._sum.amount ?? 0)}</strong></p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {["", "PENDING", "PAID", "EXPIRED", "CANCELLED", "REFUNDED"].map((s) => (
          <Link key={s} href={`/admin/pagamentos${s ? `?status=${s}` : ""}`}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${(!status && !s) || status === s ? "bg-primary-600 text-white border-primary-600" : "border-gray-300 hover:border-primary-400"}`}>
            {s || "Todos"}
          </Link>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b text-xs uppercase">
              <th className="pb-2 pr-4">Evento</th>
              <th className="pb-2 pr-4">Método</th>
              <th className="pb-2 pr-4">Valor</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Data</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="py-2 pr-4 max-w-xs truncate">
                  {p.order.registrations[0]?.event.title ?? "—"}
                </td>
                <td className="py-2 pr-4 text-gray-600">{METHOD_LABEL[p.method] ?? p.method}</td>
                <td className="py-2 pr-4 font-medium">{formatCurrency(p.amount)}</td>
                <td className="py-2 pr-4">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[p.status] ?? ""}`}>
                    {p.status}
                  </span>
                </td>
                <td className="py-2 text-gray-500 text-xs">{p.createdAt.toLocaleDateString("pt-BR")}</td>
                <td className="py-2">
                  <Link href={`/admin/pagamentos/${p.id}`} className="text-xs text-primary-600 hover:underline">
                    Detalhes
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex gap-2 justify-center">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link key={p} href={`/admin/pagamentos?page=${p}${status ? `&status=${status}` : ""}`}
              className={`text-sm px-3 py-1.5 rounded-lg border ${p === page ? "bg-primary-600 text-white" : "border-gray-300"}`}>
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
