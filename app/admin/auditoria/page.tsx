import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";
import { BADGE } from "@/lib/badge-colors";
import UserDensityToggle from "@/components/admin/UserDensityToggle";
import { buildAdminAuditOrderBy, buildAdminAuditWhere } from "@/lib/admin/audit";
import { ACTION_LABEL, ENTITY_LABEL } from "@/lib/admin/labels";

export const metadata: Metadata = { title: "Auditoria — Admin" };
export const dynamic = "force-dynamic";

const ACTION_COLOR: Record<string, string> = {
  EVENT_CREATED: BADGE.blue,
  EVENT_UPDATED: BADGE.yellow,
  EVENT_CANCELLED: BADGE.red,
  EVENT_APPROVED: BADGE.green,
  EVENT_REJECTED: BADGE.red,
  EVENT_FEE_UPDATED: BADGE.purple,
  REGISTRATION_CANCELLED: BADGE.red,
  USER_CREATED: BADGE.green,
  USER_UPDATED: BADGE.yellow,
  USER_DELETED: BADGE.red,
  USER_ROLE_CHANGED: BADGE.purple,
  USER_DEACTIVATED: BADGE.red,
  USER_ACTIVATED: BADGE.green,
  CHECKOUT_COMPLETED: BADGE.green,
  PAGE_VIEWED: BADGE.gray,
  CART_ABANDONED: BADGE.yellow,
};

interface SearchParams {
  action?: string;
  entity?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  environment?: string;
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

export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireAdmin();
  const params = await searchParams;
  const action = params.action?.trim() ?? "";
  const entity = params.entity?.trim() ?? "";
  const userId = params.userId?.trim() ?? "";
  const dateFrom = params.dateFrom?.trim() ?? "";
  const dateTo = params.dateTo?.trim() ?? "";
  const environment = params.environment?.trim() ?? "";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const sortParam = params.sort?.trim() ?? "createdAt";
  const dirParam = params.dir?.trim() ?? "desc";
  const sortConfig = buildAdminAuditOrderBy(sortParam, dirParam);
  const userSettings = await db.user.findUnique({
    where: { id: session.user.id },
    select: { uiDensity: true },
  });
  const compact = params.compact ? params.compact === "1" : userSettings?.uiDensity === "compact";
  const pageSize = 50;
  const where = buildAdminAuditWhere({
    action,
    entity,
    userId,
    dateFrom,
    dateTo,
    environment: environment ? (environment as "ADMIN" | "ORGANIZER" | "ATHLETE" | "SYSTEM") : undefined,
  });

  const [logs, total, distinctActions] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: sortConfig.orderBy,
      skip: (Math.max(1, requestedPage) - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { name: true, email: true } },
      },
    }),
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      select: { action: true },
      distinct: ["action"],
      orderBy: { action: "asc" },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, totalPages) : 1;
  const hasFilters = Boolean(action) || Boolean(entity) || Boolean(userId) || Boolean(dateFrom) || Boolean(dateTo) || Boolean(environment);

  const buildQuery = (targetPage: number, overrides: Partial<Record<"sort" | "dir" | "compact", string>> = {}) => {
    const query = new URLSearchParams();
    if (action) query.set("action", action);
    if (entity) query.set("entity", entity);
    if (userId) query.set("userId", userId);
    if (dateFrom) query.set("dateFrom", dateFrom);
    if (dateTo) query.set("dateTo", dateTo);
    if (environment) query.set("environment", environment);
    if (compact) query.set("compact", "1");
    query.set("sort", overrides.sort ?? sortConfig.normalizedSort);
    query.set("dir", overrides.dir ?? sortConfig.normalizedDir);
    if (targetPage > 1) query.set("page", String(targetPage));
    if (overrides.compact === "0") query.delete("compact");
    if (overrides.compact === "1") query.set("compact", "1");
    return query;
  };

  const buildPageUrl = (targetPage: number, overrides: Partial<Record<"sort" | "dir" | "compact", string>> = {}) =>
    `/admin/auditoria${(() => {
      const query = buildQuery(targetPage, overrides);
      return query.toString() ? `?${query.toString()}` : "";
    })()}`;

  const buildExportUrl = () => {
    const query = buildQuery(1);
    query.set("format", "csv");
    query.delete("page");
    return `/api/admin/audit/export${query.toString() ? `?${query.toString()}` : ""}`;
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
          <h1 className="text-2xl font-bold">Log de Auditoria</h1>
          <p className="text-sm text-gray-500">{total} registros encontrados</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <UserDensityToggle currentDensity={compact ? "compact" : "comfortable"} />
          <Link href={buildExportUrl()} className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Exportar CSV
          </Link>
        </div>
      </div>

      <form method="GET" className="card grid gap-4 md:grid-cols-6">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Ação</label>
          <select name="action" defaultValue={action} className="input-field text-sm py-1.5">
            <option value="">Todas</option>
            {distinctActions.map((a) => (
              <option key={a.action} value={a.action}>{ACTION_LABEL[a.action] ?? a.action}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Entidade</label>
          <select name="entity" defaultValue={entity} className="input-field text-sm py-1.5">
            <option value="">Todas</option>
            {["Event", "Registration", "User", "Order", "Payment", "Page"].map((e) => (
              <option key={e} value={e}>{ENTITY_LABEL[e] ?? e}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Ambiente</label>
          <select name="environment" defaultValue={environment} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            <option value="ADMIN">Admin</option>
            <option value="ORGANIZER">Organizador</option>
            <option value="ATHLETE">Atleta</option>
            <option value="SYSTEM">Sistema</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">User ID</label>
          <input name="userId" defaultValue={userId} placeholder="cuid..." className="input-field text-sm py-1.5" />
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
          {hasFilters ? <Link href="/admin/auditoria" className="btn-secondary py-1.5 px-4 text-sm">Limpar</Link> : null}
        </div>
      </form>

      <div className="card overflow-x-auto">
        <table className={`w-full ${compact ? "text-xs" : "text-sm"}`}>
          <thead>
            <tr className={`text-left text-gray-500 border-b dark:border-gray-700 ${compact ? "text-[10px] uppercase" : "text-xs uppercase"}`}>
              <th className="pb-2 pr-4">
                <SortLink label="Data" column="createdAt" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("createdAt")} />
              </th>
              <th className="pb-2 pr-4">
                <SortLink label="Usuário" column="user" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("user")} />
              </th>
              <th className="pb-2 pr-4">
                <SortLink label="Ação" column="action" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("action")} />
              </th>
              <th className="pb-2 pr-4">
                <SortLink label="Entidade" column="entityType" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("entityType")} />
              </th>
              <th className="pb-2">ID da entidade</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm text-gray-500">Nenhum registro encontrado.</td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className={rowClass}>
                  <td className={cellPadding + " text-gray-400 whitespace-nowrap"}>{log.createdAt.toLocaleString("pt-BR")}</td>
                  <td className={cellPadding}>
                    {log.user ? (
                      <Link href={`/admin/usuarios/${log.userId}`} className="hover:underline text-primary-700">
                        {log.user.name}
                      </Link>
                    ) : (
                      <span className="text-gray-400">Sistema</span>
                    )}
                  </td>
                  <td className={cellPadding}>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLOR[log.action] ?? BADGE.gray}`}>
                      {ACTION_LABEL[log.action] ?? log.action}
                    </span>
                  </td>
                  <td className={cellPadding + " text-gray-600 dark:text-gray-400"}>{ENTITY_LABEL[log.entityType] ?? log.entityType}</td>
                  <td className={cellPadding + " font-mono text-gray-500 truncate max-w-[12rem]"}>{log.entityId ?? "—"}</td>
                </tr>
              ))
            )}
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
