import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import ExportCsvButton from "@/components/organizer/ExportCsvButton";
import PrintButton from "@/components/ui/PrintButton";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Metadata } from "next";
import { buildRegistrationOrderBy, buildRegistrationWhere } from "@/lib/organizer/registrations";

export const metadata: Metadata = { title: "Inscritos" };

import { BADGE } from "@/lib/badge-colors";

const REGISTRATION_STATUS: Record<string, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: BADGE.yellow },
  CONFIRMED:       { label: "Confirmada", color: BADGE.green },
  CANCELLED:       { label: "Cancelada", color: BADGE.red },
  TRANSFERRED:     { label: "Transferida", color: BADGE.blue },
  WAITLISTED:      { label: "Lista de espera", color: BADGE.gray },
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  PIX: "PIX",
  CREDIT_CARD: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  BOLETO: "Boleto",
};

interface SearchParams {
  status?: string;
  sort?: string;
  dir?: string;
}

function buildInscritosUrl(id: string, params: { status?: string; sort?: string; dir?: string }) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.sort) query.set("sort", params.sort);
  if (params.dir) query.set("dir", params.dir);
  const qs = query.toString();
  return `/organizador/eventos/${id}/inscritos${qs ? `?${qs}` : ""}`;
}

export default async function InscritosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireOrganizer();
  const { id } = await params;
  const sp = await searchParams;
  const status = sp.status?.trim() ?? "";
  const sortConfig = buildRegistrationOrderBy(sp.sort?.trim() ?? "", sp.dir?.trim() ?? "");

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    select: { id: true, title: true },
  });
  if (!event) notFound();

  const registrations = await db.registration.findMany({
    where: buildRegistrationWhere(id, status),
    include: {
      athlete: { select: { name: true, email: true } },
      route: { select: { name: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true } },
      order: {
        select: {
          totalAmount: true,
          payments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { method: true, paidAt: true, status: true },
          },
        },
      },
    },
    orderBy: sortConfig.orderBy,
  });

  const nameDir = sortConfig.normalizedSort === "name" && sortConfig.normalizedDir === "asc" ? "desc" : "asc";
  const dateDir = sortConfig.normalizedSort === "date" && sortConfig.normalizedDir === "asc" ? "desc" : "asc";
  const activeButtonClass = "text-sm px-3 py-1.5 rounded-lg border border-primary-500 text-primary-600";
  const inactiveButtonClass = "text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">← Voltar ao evento</Link>
          <h1 className="text-xl font-bold mt-1">Inscritos — {event.title}</h1>
          <p className="text-sm text-gray-500">{registrations.length} inscrições</p>
        </div>
        <div className="flex gap-2">
          <ExportCsvButton eventId={id} />
          <PrintButton label="Imprimir PDF" />
        </div>
      </div>

      <form method="GET" className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select name="status" defaultValue={status} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {Object.entries(REGISTRATION_STATUS).map(([value, info]) => (
              <option key={value} value={value}>{info.label}</option>
            ))}
          </select>
        </div>
        <input type="hidden" name="sort" value={sortConfig.normalizedSort} />
        <input type="hidden" name="dir" value={sortConfig.normalizedDir} />
        <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
        {status ? (
          <Link
            href={buildInscritosUrl(id, { sort: sortConfig.normalizedSort, dir: sortConfig.normalizedDir })}
            className="btn-secondary py-1.5 px-4 text-sm"
          >
            Limpar
          </Link>
        ) : null}
      </form>

      <div className="flex gap-2">
        <Link
          href={buildInscritosUrl(id, { status, sort: "name", dir: nameDir })}
          className={sortConfig.normalizedSort === "name" ? activeButtonClass : inactiveButtonClass}
        >
          Ordem alfabética {sortConfig.normalizedSort === "name" ? (sortConfig.normalizedDir === "asc" ? "↑" : "↓") : ""}
        </Link>
        <Link
          href={buildInscritosUrl(id, { status, sort: "date", dir: dateDir })}
          className={sortConfig.normalizedSort === "date" ? activeButtonClass : inactiveButtonClass}
        >
          Ordem cronológica {sortConfig.normalizedSort === "date" ? (sortConfig.normalizedDir === "asc" ? "↑" : "↓") : ""}
        </Link>
      </div>

      {registrations.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">Nenhuma inscrição ainda.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2 pr-4">Atleta</th>
                <th className="pb-2 pr-4">Percurso</th>
                <th className="pb-2 pr-4">Categoria</th>
                <th className="pb-2 pr-4">Lote</th>
                <th className="pb-2 pr-4">Camiseta</th>
                <th className="pb-2 pr-4">Pagamento</th>
                <th className="pb-2 pr-4">Valor</th>
                <th className="pb-2 pr-4">Data pag.</th>
                <th className="pb-2 pr-4">Data inscrição</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((r) => {
                const payment = r.order.payments[0];
                const statusInfo = REGISTRATION_STATUS[r.status];
                return (
                  <tr key={r.id} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="py-2 pr-4">
                      <p className="font-medium">{r.athlete.name}</p>
                      <p className="text-xs text-gray-500">{r.athlete.email}</p>
                    </td>
                    <td className="py-2 pr-4 text-gray-700">{r.route?.name ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-700">{r.category?.name ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-700">{r.ticketBatch.name}</td>
                    <td className="py-2 pr-4 text-gray-700">{r.shirtSize ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-700">
                      {payment ? PAYMENT_METHOD_LABEL[payment.method] ?? payment.method : "—"}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {formatCurrency(r.order.totalAmount)}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {payment?.paidAt ? formatDate(payment.paidAt, "dd/MM/yyyy HH:mm") : "—"}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {formatDate(r.createdAt, "dd/MM/yyyy HH:mm")}
                    </td>
                    <td className="py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusInfo?.color ?? ""}`}>
                        {statusInfo?.label ?? r.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
