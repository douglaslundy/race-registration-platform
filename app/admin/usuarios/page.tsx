import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";
import type { UserRole } from "@prisma/client";
import { BADGE } from "@/lib/badge-colors";
import ChangeUserRoleButton from "@/components/admin/ChangeUserRoleButton";
import UserDensityToggle from "@/components/admin/UserDensityToggle";
import ToggleUserActiveButton from "@/components/admin/ToggleUserActiveButton";
import UserDeleteButton from "@/components/admin/UserDeleteButton";
import AthleteDetailsModal from "@/components/registrations/AthleteDetailsModal";
import { buildAdminUserOrderBy, buildAdminUserWhere } from "@/lib/admin/users";
import { computeRegistrationStatusBreakdown } from "@/lib/organizer/event-metrics";

export const metadata: Metadata = { title: "Usuários — Admin" };

const ROLE_LABELS: Record<UserRole, string> = {
  ATHLETE: "Atleta",
  ORGANIZER: "Organizador",
  ADMIN: "Admin",
  SUPPORT: "Suporte",
  PARTNER: "Parceiro",
  ASSISTANT: "Assistente",
  ADVERTISER: "Anunciante",
};

const ROLE_COLOR: Record<UserRole, string> = {
  ATHLETE: BADGE.gray,
  ORGANIZER: BADGE.blue,
  ADMIN: BADGE.red,
  SUPPORT: BADGE.yellow,
  PARTNER: BADGE.purple,
  ASSISTANT: BADGE.green,
  ADVERTISER: BADGE.orange,
};

const ROLE_OPTIONS: Array<{ value: "ALL" | UserRole; label: string }> = [
  { value: "ALL", label: "Todos" },
  { value: "ATHLETE", label: "Atleta" },
  { value: "ORGANIZER", label: "Organizador" },
  { value: "ADMIN", label: "Admin" },
  { value: "SUPPORT", label: "Suporte" },
  { value: "PARTNER", label: "Parceiro" },
];

interface SearchParams {
  q?: string;
  role?: string;
  status?: string;
  page?: string;
  sort?: string;
  dir?: string;
  createdFrom?: string;
  createdTo?: string;
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
  const isActive = currentSort === column;
  const arrow = isActive ? (currentDir === "asc" ? "↑" : "↓") : "";
  return (
    <Link href={href} className="inline-flex items-center gap-1 hover:text-primary-600">
      <span>{label}</span>
      <span className="text-[10px]">{arrow}</span>
    </Link>
  );
}

export default async function AdminUsuariosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireAdmin();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const role = params.role?.trim() ?? "ALL";
  const status = params.status?.trim() ?? "ALL";
  const createdFrom = params.createdFrom?.trim() ?? "";
  const createdTo = params.createdTo?.trim() ?? "";
  const userSettings = await db.user.findUnique({
    where: { id: session.user.id },
    select: { uiDensity: true },
  });
  const compact = params.compact ? params.compact === "1" : userSettings?.uiDensity === "compact";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const sortParam = params.sort?.trim() ?? "createdAt";
  const dirParam = params.dir?.trim() ?? "desc";
  const sortConfig = buildAdminUserOrderBy(sortParam, dirParam);
  const pageSize = 20;
  const where = buildAdminUserWhere({ q, role, status, createdFrom, createdTo });

  const total = await db.user.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, totalPages) : 1;

  const users = await db.user.findMany({
    where,
    orderBy: sortConfig.orderBy,
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
      _count: { select: { orders: true } },
      athleteProfile: {
        select: {
          cpf: true,
          birthDate: true,
          phone: true,
          gender: true,
          city: true,
          state: true,
          teamName: true,
          preferredShirtSize: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  const statusGroups = await db.registration.groupBy({
    by: ["athleteUserId", "status"],
    where: { athleteUserId: { in: users.map((u) => u.id) } },
    _count: { id: true },
  });
  const statusCountsByUser = new Map<string, { status: string; count: number }[]>();
  for (const g of statusGroups) {
    const arr = statusCountsByUser.get(g.athleteUserId) ?? [];
    arr.push({ status: g.status, count: g._count.id });
    statusCountsByUser.set(g.athleteUserId, arr);
  }

  const hasFilters = Boolean(q) || role !== "ALL" || status !== "ALL" || Boolean(createdFrom) || Boolean(createdTo);

  const buildQuery = (
    overrides: Partial<Record<"page" | "sort" | "dir" | "compact", string>> = {},
    includePage = true,
  ) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (role !== "ALL") query.set("role", role);
    if (status !== "ALL") query.set("status", status);
    if (createdFrom) query.set("createdFrom", createdFrom);
    if (createdTo) query.set("createdTo", createdTo);
    if (params.compact === "1") query.set("compact", "1");
    if (params.compact === "0") query.set("compact", "0");

    const sortValue = overrides.sort ?? sortConfig.normalizedSort;
    const dirValue = overrides.dir ?? sortConfig.normalizedDir;
    const pageValue = overrides.page;

    if (sortValue) query.set("sort", sortValue);
    if (dirValue) query.set("dir", dirValue);
    if (includePage && pageValue) {
      query.set("page", pageValue);
    }
    if (overrides.compact === "0") {
      query.delete("compact");
    }
    if (overrides.compact === "1") {
      query.set("compact", "1");
    }
    return query;
  };

  const buildPageUrl = (targetPage: number, overrides: Partial<Record<"sort" | "dir" | "compact", string>> = {}) => {
    const query = buildQuery(
      {
        page: targetPage > 1 ? String(targetPage) : undefined,
        sort: overrides.sort,
        dir: overrides.dir,
        compact: overrides.compact,
      },
      true,
    );
    return `/admin/usuarios${query.toString() ? `?${query.toString()}` : ""}`;
  };

  const buildExportUrl = () => {
    const query = buildQuery({ page: undefined }, false);
    query.set("format", "csv");
    return `/api/admin/users${query.toString() ? `?${query.toString()}` : ""}`;
  };

  const sortHeader = (column: string) => {
    const isActive = sortConfig.normalizedSort === column;
    const nextDir = isActive && sortConfig.normalizedDir === "asc" ? "desc" : "asc";
    return buildPageUrl(1, { sort: column, dir: nextDir });
  };

  const rowClass = compact ? "border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40 align-top text-xs" : "border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40 align-top";
  const cellPadding = compact ? "py-2 pr-3" : "py-3 pr-4";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-bold">Usuários ({total})</h1>
          <p className="text-sm text-gray-500">Cadastre, edite, bloqueie ou exclua contas da plataforma.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <UserDensityToggle currentDensity={compact ? "compact" : "comfortable"} />
          <Link href={buildExportUrl()} className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Exportar CSV
          </Link>
          <Link href="/admin/usuarios/novo" className="btn-primary text-sm w-fit">
            + Novo usuário
          </Link>
        </div>
      </div>

      <form method="GET" className="card grid gap-4 md:grid-cols-6">
        <input type="hidden" name="sort" value={sortConfig.normalizedSort} />
        <input type="hidden" name="dir" value={sortConfig.normalizedDir} />
        {compact ? <input type="hidden" name="compact" value="1" /> : null}
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Buscar</label>
          <input name="q" defaultValue={q} className="input-field" placeholder="Nome, e-mail ou CPF" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Perfil</label>
          <select name="role" defaultValue={role} className="input-field">
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select name="status" defaultValue={status} className="input-field">
            <option value="ALL">Todos</option>
            <option value="ACTIVE">Ativos</option>
            <option value="BLOCKED">Bloqueados</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Cadastro de</label>
          <input type="date" name="createdFrom" defaultValue={createdFrom} className="input-field" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Cadastro até</label>
          <input type="date" name="createdTo" defaultValue={createdTo} className="input-field" />
        </div>
        <div className="md:col-span-6 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary text-sm">
            Filtrar
          </button>
          {hasFilters ? (
            <Link href="/admin/usuarios" className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
              Limpar
            </Link>
          ) : null}
        </div>
      </form>

      <div className="card overflow-x-auto">
        <table className={`w-full ${compact ? "text-xs" : "text-sm"}`}>
          <thead>
            <tr className={`text-left text-gray-500 border-b dark:border-gray-700 ${compact ? "text-[10px] uppercase" : "text-xs uppercase"}`}>
              <th className="pb-2 pr-4">
                <SortLink label="Nome" column="name" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("name")} />
              </th>
              <th className="pb-2 pr-4">
                <SortLink label="Email" column="email" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("email")} />
              </th>
              <th className="pb-2 pr-4">
                <SortLink label="Perfil" column="role" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("role")} />
              </th>
              <th className="pb-2 pr-4">
                <SortLink label="Inscrições" column="registrations" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("registrations")} />
              </th>
              <th className="pb-2 pr-4">
                <SortLink label="Pedidos" column="orders" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("orders")} />
              </th>
              <th className="pb-2 pr-4">
                <SortLink label="Status" column="active" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("active")} />
              </th>
              <th className="pb-2 pr-4">
                <SortLink label="Cadastro" column="createdAt" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("createdAt")} />
              </th>
              <th className="pb-2 pr-4">Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sm text-gray-500">
                  Nenhum usuário encontrado com os filtros atuais.
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const breakdown = computeRegistrationStatusBreakdown(statusCountsByUser.get(u.id) ?? []);
                return (
                <tr key={u.id} className={rowClass}>
                  <td className={cellPadding + " font-medium"}>{u.name}</td>
                  <td className={cellPadding + " text-gray-500 text-xs"}>{u.email}</td>
                  <td className={cellPadding}>
                    <span className={`text-xs px-2 py-0.5 rounded ${ROLE_COLOR[u.role]}`}>
                      {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td className={cellPadding + " text-center"}>
                    <div>{breakdown.paid} confirmadas</div>
                    <div className="text-[11px] text-gray-400">{breakdown.pending} pendentes · {breakdown.cancelled} canceladas</div>
                  </td>
                  <td className={cellPadding + " text-center"}>{u._count.orders}</td>
                  <td className={cellPadding + " text-center"}>
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        u.active
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      }`}
                    >
                      {u.active ? "Ativo" : "Bloqueado"}
                    </span>
                  </td>
                  <td className={cellPadding + " text-gray-400 text-xs"}>{u.createdAt.toLocaleDateString("pt-BR")}</td>
                  <td className={cellPadding}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/usuarios/${u.id}`} className="text-xs text-primary-600 hover:underline">
                        Detalhes
                      </Link>
                      <AthleteDetailsModal
                        athleteName={u.name}
                        athleteEmail={u.email}
                        profile={u.athleteProfile}
                        editEndpoint={`/api/admin/users/${u.id}`}
                      />
                      <Link href={`/admin/usuarios/${u.id}/editar`} className="text-xs text-primary-600 hover:underline">
                        Editar
                      </Link>
                      <ChangeUserRoleButton userId={u.id} currentRole={u.role} />
                      <ToggleUserActiveButton userId={u.id} active={u.active} />
                      <UserDeleteButton userId={u.id} userName={u.name} />
                    </div>
                  </td>
                </tr>
                );
              })
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
              page === totalPages
                ? "pointer-events-none border-gray-200 text-gray-300"
                : "border-gray-300 dark:border-gray-600 hover:border-primary-400"
            }`}
          >
            Próxima
          </Link>
        </div>
      ) : null}
    </div>
  );
}
