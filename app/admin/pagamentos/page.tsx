import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/format";
import Link from "next/link";
import type { Metadata } from "next";
import { BADGE } from "@/lib/badge-colors";
import { buildAdminPaymentOrderBy, buildAdminPaymentWhere } from "@/lib/admin/payments";
import { PAYMENT_STATUS_LABEL } from "@/lib/admin/labels";
import UserDensityToggle from "@/components/admin/UserDensityToggle";
import PrintButton from "@/components/ui/PrintButton";

export const metadata: Metadata = { title: "Pagamentos — Admin" };
export const dynamic = "force-dynamic";

const METHOD_LABEL: Record<string, string> = {
  PIX: "Pix",
  CREDIT_CARD: "Cartão",
  DEBIT_CARD: "Débito",
  BOLETO: "Boleto",
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: BADGE.yellow,
  PAID: BADGE.green,
  EXPIRED: BADGE.gray,
  CANCELLED: BADGE.red,
  REFUNDED: BADGE.blue,
  CHARGEBACK: BADGE.purple,
};

interface SearchParams {
  q?: string;
  status?: string;
  method?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
  sort?: string;
  dir?: string;
  compact?: string;
}

function SortLink({
  label,
  column,
  currentSort,
  currentDir,
  href,
}: {
  label: string;
  column: string;
  currentSort: string;
  currentDir: "asc" | "desc";
  href: string;
}) {
  const active = currentSort === column;
  const arrow = active ? (currentDir === "asc" ? "↑" : "↓") : "";
  return (
    <Link href={href} className="inline-flex items-center gap-1 hover:text-primary-600">
      <span>{label}</span>
      <span className="text-[10px]">{arrow}</span>
    </Link>
  );
}

export default async function AdminPagamentosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireAdmin();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const status = params.status?.trim() ?? "";
  const method = params.method?.trim() ?? "";
  const dateFrom = params.dateFrom?.trim() ?? "";
  const dateTo = params.dateTo?.trim() ?? "";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const sortParam = params.sort?.trim() ?? "createdAt";
  const dirParam = params.dir?.trim() ?? "desc";
  const sortConfig = buildAdminPaymentOrderBy(sortParam, dirParam);
  const userSettings = await db.user.findUnique({
    where: { id: session.user.id },
    select: { uiDensity: true },
  });
  const compact = params.compact ? params.compact === "1" : userSettings?.uiDensity === "compact";
  const pageSize = 50;
  const where = buildAdminPaymentWhere({ q, status, method, dateFrom, dateTo });

  const [payments, total, distinctMethods] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: sortConfig.orderBy,
      skip: (Math.max(1, requestedPage) - 1) * pageSize,
      take: pageSize,
      include: {
        order: {
          select: {
            id: true,
            totalAmount: true,
            buyer: { select: { name: true, email: true } },
            registrations: { select: { event: { select: { title: true } } }, take: 1 },
          },
        },
      },
    }),
    db.payment.count({ where }),
    db.payment.findMany({ select: { method: true }, distinct: ["method"], orderBy: { method: "asc" } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, totalPages) : 1;
  const totalAmount = await db.payment.aggregate({
    _sum: { amount: true },
    where: {
      AND: [
        buildAdminPaymentWhere({ q, method, dateFrom, dateTo, status: "PAID" }),
        { order: { status: "PAID" } },
      ],
    },
  });

  const hasFilters = Boolean(q) || Boolean(status) || Boolean(method) || Boolean(dateFrom) || Boolean(dateTo);

  const buildQuery = (targetPage: number, overrides: Partial<Record<"sort" | "dir" | "compact", string>> = {}) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (status) query.set("status", status);
    if (method) query.set("method", method);
    if (dateFrom) query.set("dateFrom", dateFrom);
    if (dateTo) query.set("dateTo", dateTo);
    if (compact) query.set("compact", "1");
    query.set("sort", overrides.sort ?? sortConfig.normalizedSort);
    query.set("dir", overrides.dir ?? sortConfig.normalizedDir);
    if (targetPage > 1) query.set("page", String(targetPage));
    if (overrides.compact === "0") query.delete("compact");
    if (overrides.compact === "1") query.set("compact", "1");
    return query;
  };

  const buildPageUrl = (targetPage: number, overrides: Partial<Record<"sort" | "dir" | "compact", string>> = {}) => {
    const query = buildQuery(targetPage, overrides);
    return `/admin/pagamentos${query.toString() ? `?${query.toString()}` : ""}`;
  };

  const buildExportUrl = () => {
    const query = buildQuery(1);
    query.set("format", "csv");
    query.delete("page");
    return `/api/admin/payments/export${query.toString() ? `?${query.toString()}` : ""}`;
  };

  const sortHeader = (column: string) => {
    const isActive = sortConfig.normalizedSort === column;
    const nextDir = isActive && sortConfig.normalizedDir === "asc" ? "desc" : "asc";
    return buildPageUrl(1, { sort: column, dir: nextDir });
  };

  const rowClass = compact ? "border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-xs" : "border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40";
  const cellPadding = compact ? "py-2 pr-3" : "py-2 pr-4";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pagamentos</h1>
          <p className="text-sm text-gray-500">{total} registros encontrados</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-gray-500">
            Total pago: <strong className="text-green-700">{formatCurrency(totalAmount._sum.amount ?? 0)}</strong>
          </p>
          <UserDensityToggle currentDensity={compact ? "compact" : "comfortable"} />
          <Link href={buildExportUrl()} className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Exportar CSV
          </Link>
          <PrintButton />
        </div>
      </div>

      <form method="GET" className="card grid gap-4 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Buscar</label>
          <input name="q" defaultValue={q} placeholder="Comprador, e-mail, evento ou transação" className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select name="status" defaultValue={status} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {Object.entries(PAYMENT_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Método</label>
          <select name="method" defaultValue={method} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {distinctMethods.map((row) => (
              <option key={row.method} value={row.method}>
                {METHOD_LABEL[row.method] ?? row.method}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">De</label>
          <input type="date" name="dateFrom" defaultValue={dateFrom} className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Até</label>
          <input type="date" name="dateTo" defaultValue={dateTo} className="input-field text-sm py-1.5" />
        </div>
        <div className="md:col-span-6 flex flex-wrap gap-2">
          <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
          {hasFilters ? <Link href="/admin/pagamentos" className="btn-secondary py-1.5 px-4 text-sm">Limpar</Link> : null}
        </div>
      </form>

      <div className="card overflow-x-auto">
        <table className={`w-full ${compact ? "text-xs" : "text-sm"}`}>
          <thead>
            <tr className={`text-left text-gray-500 border-b dark:border-gray-700 ${compact ? "text-[10px] uppercase" : "text-xs uppercase"}`}>
              <th className="pb-2 pr-4">Evento</th>
              <th className="pb-2 pr-4">
                <SortLink label="Método" column="method" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("method")} />
              </th>
              <th className="pb-2 pr-4">
                <SortLink label="Valor" column="amount" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("amount")} />
              </th>
              <th className="pb-2 pr-4">
                <SortLink label="Status" column="status" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("status")} />
              </th>
              <th className="pb-2 pr-4">Comprador</th>
              <th className="pb-2 pr-4">
                <SortLink label="Data" column="createdAt" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("createdAt")} />
              </th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => {
              if (!p.order) {
                // Pagamentos exibidos nesta lista são sempre de Order (checkout) — se algum dia um
                // pagamento de AdPurchase aparecer aqui, falha alto em vez de quebrar silenciosamente.
                throw new Error(`Payment ${p.id} sem order associado (admin pagamentos list)`);
              }
              return (
                <tr key={p.id} className={rowClass}>
                  <td className={cellPadding + " max-w-xs truncate"}>{p.order.registrations[0]?.event.title ?? "—"}</td>
                  <td className={cellPadding + " text-gray-600"}>{METHOD_LABEL[p.method] ?? p.method}</td>
                  <td className={cellPadding + " font-medium"}>{formatCurrency(p.amount)}</td>
                  <td className={cellPadding}>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[p.status] ?? ""}`}>{PAYMENT_STATUS_LABEL[p.status] ?? p.status}</span>
                  </td>
                  <td className={cellPadding + " text-gray-600"}>
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-700">{p.order.buyer.name}</span>
                      <span className="text-xs text-gray-400">{p.order.buyer.email}</span>
                    </div>
                  </td>
                  <td className={cellPadding + " text-gray-500 text-xs whitespace-nowrap"}>{formatDate(p.createdAt, "dd/MM/yyyy HH:mm")}</td>
                  <td className={cellPadding}>
                    <Link href={`/admin/pagamentos/${p.id}`} className="text-xs text-primary-600 hover:underline">
                      Detalhes
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="flex gap-2 justify-center flex-wrap">
          <Link
            href={buildPageUrl(Math.max(1, page - 1))}
            aria-disabled={page === 1}
            className={`text-sm px-3 py-1.5 rounded-lg border ${
              page === 1 ? "pointer-events-none border-gray-200 text-gray-300" : "border-gray-300 dark:border-gray-600 hover:border-primary-400"
            }`}
          >
            Anterior
          </Link>
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={buildPageUrl(p)}
              className={`text-sm px-3 py-1.5 rounded-lg border ${
                p === page ? "bg-primary-600 text-white border-primary-600" : "border-gray-300 dark:border-gray-600 hover:border-primary-400"
              }`}
            >
              {p}
            </Link>
          ))}
          <Link
            href={buildPageUrl(Math.min(totalPages, page + 1))}
            aria-disabled={page === totalPages}
            className={`text-sm px-3 py-1.5 rounded-lg border ${
              page === totalPages ? "pointer-events-none border-gray-200 text-gray-300" : "border-gray-300 dark:border-gray-600 hover:border-primary-400"
            }`}
          >
            Próxima
          </Link>
        </div>
      ) : null}
    </div>
  );
}
