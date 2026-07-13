import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/format";
import { BADGE } from "@/lib/badge-colors";
import { buildAdminPayoutOrderBy, buildAdminPayoutWhere, hasPostPayoutRefund } from "@/lib/admin/payouts";
import UserDensityToggle from "@/components/admin/UserDensityToggle";
import UpdatePayoutStatusButton from "@/components/admin/UpdatePayoutStatusButton";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Repasses — Admin" };
export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  status?: string;
  event?: string;
  organizer?: string;
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

export default async function AdminRepassesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireAdmin();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const status = params.status?.trim() ?? "";
  const event = params.event?.trim() ?? "";
  const organizer = params.organizer?.trim() ?? "";
  const dateFrom = params.dateFrom?.trim() ?? "";
  const dateTo = params.dateTo?.trim() ?? "";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const sortParam = params.sort?.trim() ?? "createdAt";
  const dirParam = params.dir?.trim() ?? "desc";
  const sortConfig = buildAdminPayoutOrderBy(sortParam, dirParam);
  const userSettings = await db.user.findUnique({
    where: { id: session.user.id },
    select: { uiDensity: true },
  });
  const compact = params.compact ? params.compact === "1" : userSettings?.uiDensity === "compact";
  const pageSize = 50;
  const where = buildAdminPayoutWhere({ q, status, event, organizer, dateFrom, dateTo });

  const [payouts, total, distinctStatuses] = await Promise.all([
    db.transferPayout.findMany({
      where,
      orderBy: sortConfig.orderBy,
      skip: (Math.max(1, requestedPage) - 1) * pageSize,
      take: pageSize,
      include: {
        event: { select: { title: true } },
        organizer: { include: { user: { select: { name: true } } } },
        orders: { where: { status: "REFUNDED" }, select: { id: true, status: true } },
      },
    }),
    db.transferPayout.count({ where }),
    db.transferPayout.findMany({
      select: { status: true },
      distinct: ["status"],
      orderBy: { status: "asc" },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, totalPages) : 1;
  const pendingTotal = payouts.filter((p) => p.status === "PENDING").reduce((sum, p) => sum + p.grossAmount, 0);
  const completedTotal = payouts.filter((p) => p.status === "COMPLETED").reduce((sum, p) => sum + p.grossAmount, 0);
  const totalNet = payouts.reduce((sum, p) => sum + p.netAmount, 0);
  const hasFilters = Boolean(q) || Boolean(status) || Boolean(event) || Boolean(organizer) || Boolean(dateFrom) || Boolean(dateTo);

  const buildQuery = (targetPage: number, overrides: Partial<Record<"sort" | "dir" | "compact", string>> = {}) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (status) query.set("status", status);
    if (event) query.set("event", event);
    if (organizer) query.set("organizer", organizer);
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
    return `/admin/repasses${query.toString() ? `?${query.toString()}` : ""}`;
  };

  const buildExportUrl = () => {
    const query = buildQuery(1);
    query.set("format", "csv");
    query.delete("page");
    return `/api/admin/payouts/export${query.toString() ? `?${query.toString()}` : ""}`;
  };

  const sortHeader = (column: string) => {
    const isActive = sortConfig.normalizedSort === column;
    const nextDir = isActive && sortConfig.normalizedDir === "asc" ? "desc" : "asc";
    return buildPageUrl(1, { sort: column, dir: nextDir });
  };

  const rowClass = compact ? "border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-xs" : "border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40";
  const cellPadding = compact ? "py-2 pr-3" : "py-2 pr-4";
  const STATUS_COLOR: Record<string, string> = {
    PENDING: BADGE.yellow,
    PROCESSING: BADGE.blue,
    COMPLETED: BADGE.green,
    FAILED: BADGE.red,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Repasses</h1>
          <p className="text-sm text-gray-500">{total} registros encontrados</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <UserDensityToggle currentDensity={compact ? "compact" : "comfortable"} />
          <Link href={buildExportUrl()} className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Exportar CSV
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-yellow-600">{formatCurrency(pendingTotal)}</p>
          <p className="text-gray-500 text-sm">Pendentes</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-green-600">{formatCurrency(completedTotal)}</p>
          <p className="text-gray-500 text-sm">Concluídos</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalNet)}</p>
          <p className="text-gray-500 text-sm">Líquido nesta página</p>
        </div>
      </div>

      <form method="GET" className="card grid gap-4 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Buscar</label>
          <input name="q" defaultValue={q} placeholder="Evento ou organizador" className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select name="status" defaultValue={status} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {distinctStatuses.map((row) => (
              <option key={row.status} value={row.status}>
                {row.status}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Evento</label>
          <input name="event" defaultValue={event} className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Organizador</label>
          <input name="organizer" defaultValue={organizer} className="input-field text-sm py-1.5" />
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
          {hasFilters ? <Link href="/admin/repasses" className="btn-secondary py-1.5 px-4 text-sm">Limpar</Link> : null}
        </div>
      </form>

      {payouts.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">Nenhum repasse encontrado.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className={`w-full ${compact ? "text-xs" : "text-sm"}`}>
            <thead>
              <tr className={`text-left text-gray-500 border-b dark:border-gray-700 ${compact ? "text-[10px] uppercase" : "text-xs uppercase"}`}>
                <th className="pb-2 pr-4">
                  <SortLink label="Evento" column="event" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("event")} />
                </th>
                <th className="pb-2 pr-4">
                  <SortLink label="Organizador" column="organizer" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("organizer")} />
                </th>
                <th className="pb-2 pr-4">
                  <SortLink label="Bruto" column="grossAmount" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("grossAmount")} />
                </th>
                <th className="pb-2 pr-4">Taxa</th>
                <th className="pb-2 pr-4">
                  <SortLink label="Líquido" column="netAmount" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("netAmount")} />
                </th>
                <th className="pb-2 pr-4">
                  <SortLink label="Status" column="status" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("status")} />
                </th>
                <th className="pb-2">
                  <SortLink label="Data" column="createdAt" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("createdAt")} />
                </th>
                <th className="pb-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id} className={rowClass}>
                  <td className={cellPadding + " truncate max-w-xs"}>{p.event.title}</td>
                  <td className={cellPadding + " text-gray-600 dark:text-gray-400"}>{p.organizer.user.name}</td>
                  <td className={cellPadding + " font-medium"}>{formatCurrency(p.grossAmount)}</td>
                  <td className={cellPadding + " text-red-500"}>-{formatCurrency(p.platformFee)}</td>
                  <td className={cellPadding + " font-bold text-green-700"}>{formatCurrency(p.netAmount)}</td>
                  <td className={cellPadding}>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[p.status] ?? ""}`}>{p.status}</span>
                    {hasPostPayoutRefund(p.orders) && (
                      <span className="ml-1 text-xs text-red-600" title="Um ou mais pedidos deste repasse foram estornados depois">⚠</span>
                    )}
                  </td>
                  <td className={cellPadding + " text-gray-400 text-xs whitespace-nowrap"}>{formatDate(p.createdAt)}</td>
                  <td className={cellPadding}>
                    <UpdatePayoutStatusButton payoutId={p.id} status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
