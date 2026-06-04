import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";
import type { EventModality, EventStatus } from "@prisma/client";
import ApproveEventButton from "@/components/admin/ApproveEventButton";
import UserDensityToggle from "@/components/admin/UserDensityToggle";
import { buildAdminEventOrderBy, buildAdminEventWhere } from "@/lib/admin/events";

export const metadata: Metadata = { title: "Eventos — Admin" };

const STATUS_OPTIONS: Array<{ value: "ALL" | EventStatus; label: string }> = [
  { value: "ALL", label: "Todos" },
  { value: "UNDER_REVIEW", label: "Em análise" },
  { value: "PUBLISHED", label: "Publicados" },
  { value: "DRAFT", label: "Rascunhos" },
  { value: "CANCELLED", label: "Cancelados" },
];

const MODALITY_OPTIONS: Array<{ value: "ALL" | EventModality; label: string }> = [
  { value: "ALL", label: "Todas" },
  { value: "ROAD_RACE", label: "Corrida de rua" },
  { value: "TRAIL_RUN", label: "Trail run" },
  { value: "MTB", label: "MTB" },
  { value: "CYCLING", label: "Ciclismo" },
  { value: "WALK", label: "Caminhada" },
  { value: "TRIATHLON", label: "Triatlo" },
  { value: "OTHER", label: "Outras" },
];

interface SearchParams {
  q?: string;
  status?: string;
  modality?: string;
  city?: string;
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

export default async function AdminEventosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireAdmin();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const status = params.status?.trim() ?? "ALL";
  const modality = params.modality?.trim() ?? "ALL";
  const city = params.city?.trim() ?? "";
  const dateFrom = params.dateFrom?.trim() ?? "";
  const dateTo = params.dateTo?.trim() ?? "";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const sortParam = params.sort?.trim() ?? "createdAt";
  const dirParam = params.dir?.trim() ?? "desc";
  const sortConfig = buildAdminEventOrderBy(sortParam, dirParam);
  const userSettings = await db.user.findUnique({
    where: { id: session.user.id },
    select: { uiDensity: true },
  });
  const compact = params.compact ? params.compact === "1" : userSettings?.uiDensity === "compact";
  const pageSize = 20;
  const where = buildAdminEventWhere({ q, status, modality, city, dateFrom, dateTo });

  const total = await db.event.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, totalPages) : 1;

  const events = await db.event.findMany({
    where,
    orderBy: sortConfig.orderBy,
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      organizer: { include: { user: { select: { name: true, email: true } } } },
      _count: { select: { registrations: true } },
    },
  });

  const hasFilters = Boolean(q) || status !== "ALL" || modality !== "ALL" || Boolean(city) || Boolean(dateFrom) || Boolean(dateTo);

  const buildQuery = (targetPage: number, overrides: Partial<Record<"sort" | "dir" | "compact", string>> = {}) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (status !== "ALL") query.set("status", status);
    if (modality !== "ALL") query.set("modality", modality);
    if (city) query.set("city", city);
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

  const buildPageUrl = (targetPage: number, overrides: Partial<Record<"sort" | "dir" | "compact", string>> = {}) =>
    `/admin/eventos${buildQuery(targetPage, overrides).toString() ? `?${buildQuery(targetPage, overrides).toString()}` : ""}`;

  const buildExportUrl = () => {
    const query = buildQuery(1);
    query.set("format", "csv");
    query.delete("page");
    return `/api/admin/events/export${query.toString() ? `?${query.toString()}` : ""}`;
  };

  const sortHeader = (column: string) => {
    const isActive = sortConfig.normalizedSort === column;
    const nextDir = isActive && sortConfig.normalizedDir === "asc" ? "desc" : "asc";
    return buildPageUrl(1, { sort: column, dir: nextDir });
  };

  const rowClass = compact ? "border-b last:border-0 hover:bg-gray-50 align-top text-xs" : "border-b last:border-0 hover:bg-gray-50 align-top";
  const cellPadding = compact ? "py-2 pr-3" : "py-3 pr-4";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-bold">Eventos ({total})</h1>
          <p className="text-sm text-gray-500">Filtre, ordene e exporte a fila de eventos da plataforma.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <UserDensityToggle currentDensity={compact ? "compact" : "comfortable"} />
          <Link href={buildExportUrl()} className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
            Exportar CSV
          </Link>
        </div>
      </div>

      <form method="GET" className="card grid gap-4 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Buscar</label>
          <input name="q" defaultValue={q} className="input-field" placeholder="Título, slug ou organizador" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select name="status" defaultValue={status} className="input-field">
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Modalidade</label>
          <select name="modality" defaultValue={modality} className="input-field">
            {MODALITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Cidade</label>
          <input name="city" defaultValue={city} className="input-field" placeholder="Ex.: São Paulo" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">De</label>
          <input type="date" name="dateFrom" defaultValue={dateFrom} className="input-field" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Até</label>
          <input type="date" name="dateTo" defaultValue={dateTo} className="input-field" />
        </div>
        <div className="md:col-span-6 flex flex-wrap gap-2">
          <button type="submit" className="btn-primary text-sm">
            Filtrar
          </button>
          {hasFilters ? (
            <Link href="/admin/eventos" className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
              Limpar
            </Link>
          ) : null}
        </div>
      </form>

      <div className="card overflow-x-auto">
        <table className={`w-full ${compact ? "text-xs" : "text-sm"}`}>
          <thead>
            <tr className={`text-left text-gray-500 border-b ${compact ? "text-[10px] uppercase" : "text-xs uppercase"}`}>
              <th className="pb-2 pr-4">
                <SortLink label="Evento" column="title" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("title")} />
              </th>
              <th className="pb-2 pr-4">Organizador</th>
              <th className="pb-2 pr-4">
                <SortLink label="Status" column="status" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("status")} />
              </th>
              <th className="pb-2 pr-4">
                <SortLink label="Inscrições" column="registrations" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("registrations")} />
              </th>
              <th className="pb-2 pr-4">
                <SortLink label="Cidade" column="city" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("city")} />
              </th>
              <th className="pb-2 pr-4">
                <SortLink label="Data" column="startAt" currentSort={sortConfig.normalizedSort} currentDir={sortConfig.normalizedDir} href={sortHeader("startAt")} />
              </th>
              <th className="pb-2 pr-4">Ações</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-gray-500">
                  Nenhum evento encontrado com os filtros atuais.
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event.id} className={rowClass}>
                  <td className={cellPadding + " font-medium"}>
                    <div className="space-y-1">
                      <div>{event.title}</div>
                      <div className="text-[11px] text-gray-400">{event.slug}</div>
                    </div>
                  </td>
                  <td className={cellPadding + " text-gray-600"}>
                    <div className="space-y-1">
                      <div>{event.organizer.user.name}</div>
                      <div className="text-[11px] text-gray-400">{event.organizer.user.email}</div>
                    </div>
                  </td>
                  <td className={cellPadding}>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100">{event.status}</span>
                  </td>
                  <td className={cellPadding + " text-center"}>{event._count.registrations}</td>
                  <td className={cellPadding + " text-gray-500"}>{event.city}/{event.state}</td>
                  <td className={cellPadding + " text-gray-500"}>{event.startAt.toLocaleDateString("pt-BR")}</td>
                  <td className={cellPadding}>
                    <div className="flex flex-wrap items-center gap-2">
                      {event.status === "UNDER_REVIEW" ? <ApproveEventButton eventId={event.id} /> : null}
                      <Link href={`/admin/eventos/${event.id}`} className="text-xs text-primary-600 hover:underline">
                        Detalhes
                      </Link>
                    </div>
                  </td>
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
              page === 1 ? "pointer-events-none border-gray-200 text-gray-300" : "border-gray-300 hover:border-primary-400"
            }`}
          >
            Anterior
          </Link>
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={buildPageUrl(p)}
              className={`text-sm px-3 py-1.5 rounded-lg border ${
                p === page ? "bg-primary-600 text-white border-primary-600" : "border-gray-300 hover:border-primary-400"
              }`}
            >
              {p}
            </Link>
          ))}
          <Link
            href={buildPageUrl(Math.min(totalPages, page + 1))}
            aria-disabled={page === totalPages}
            className={`text-sm px-3 py-1.5 rounded-lg border ${
              page === totalPages ? "pointer-events-none border-gray-200 text-gray-300" : "border-gray-300 hover:border-primary-400"
            }`}
          >
            Próxima
          </Link>
        </div>
      ) : null}
    </div>
  );
}
