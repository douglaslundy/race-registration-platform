import { requireOrganizer } from "@/lib/auth/rbac";
import { formatCurrency } from "@/lib/format";
import { buildAbandonedCartWhere, buildAbandonedCartOrderBy, listAbandonedCarts } from "@/lib/alerts/abandoned-cart-query";
import SendAbandonedCartAlertButton from "@/components/alerts/SendAbandonedCartAlertButton";
import SendAllAbandonedCartsButton from "@/components/alerts/SendAllAbandonedCartsButton";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Carrinhos abandonados" };
export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  event?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

export default async function OrganizerAbandonedCartsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireOrganizer();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const event = params.event?.trim() ?? "";
  const dateFrom = params.dateFrom?.trim() ?? "";
  const dateTo = params.dateTo?.trim() ?? "";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const sortConfig = buildAbandonedCartOrderBy(params.sort?.trim() ?? "createdAt", params.dir?.trim() ?? "desc");
  const pageSize = 20;
  const where = buildAbandonedCartWhere({ q, event, dateFrom, dateTo }, { organizerUserId: session.user.id });

  const { rows, total } = await listAbandonedCarts(
    where,
    sortConfig.orderBy,
    (Math.max(1, requestedPage) - 1) * pageSize,
    pageSize,
  );

  const hasFilters = Boolean(q) || Boolean(event) || Boolean(dateFrom) || Boolean(dateTo);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Carrinhos abandonados</h1>
          <p className="text-sm text-gray-500">{total} pedido(s) pendente(s) encontrado(s)</p>
        </div>
        <SendAllAbandonedCartsButton
          endpoint="/api/organizer/abandoned-carts/notify"
          filters={{ q, event, dateFrom, dateTo }}
          count={total}
        />
      </div>

      <form method="GET" className="card grid gap-4 md:grid-cols-5">
        <div className="md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Buscar</label>
          <input name="q" defaultValue={q} placeholder="Comprador, e-mail ou evento" className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Evento</label>
          <input name="event" defaultValue={event} className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">De</label>
          <input type="date" name="dateFrom" defaultValue={dateFrom} className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Até</label>
          <input type="date" name="dateTo" defaultValue={dateTo} className="input-field text-sm py-1.5" />
        </div>
        <div className="md:col-span-5 flex flex-wrap gap-2">
          <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
          {hasFilters ? <Link href="/organizador/carrinhos-abandonados" className="btn-secondary py-1.5 px-4 text-sm">Limpar</Link> : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">Nenhum carrinho abandonado encontrado.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b dark:border-gray-700 text-xs uppercase">
                <th className="pb-2 pr-4">Comprador</th>
                <th className="pb-2 pr-4">Evento</th>
                <th className="pb-2 pr-4">Valor</th>
                <th className="pb-2 pr-4">Canais</th>
                <th className="pb-2 pr-4">Pendente há</th>
                <th className="pb-2 pr-4">Último alerta</th>
                <th className="pb-2">Ação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="py-2 pr-4">
                    <div>{row.buyerName}</div>
                    <div className="text-xs text-gray-400">{row.buyerEmail}</div>
                  </td>
                  <td className="py-2 pr-4 truncate max-w-xs">{row.eventTitle}</td>
                  <td className="py-2 pr-4 font-medium">{formatCurrency(row.subtotalAmount)}</td>
                  <td className="py-2 pr-4 text-xs text-gray-500">
                    E-mail{row.hasPhone ? " + WhatsApp" : ""}
                  </td>
                  <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">
                    {formatDistanceToNowStrict(row.createdAt, { locale: ptBR })}
                  </td>
                  <td className="py-2 pr-4 text-xs text-gray-400">
                    {row.lastAlertSentAt ? formatDistanceToNowStrict(row.lastAlertSentAt, { locale: ptBR, addSuffix: true }) : "Nunca"}
                  </td>
                  <td className="py-2">
                    <SendAbandonedCartAlertButton endpoint="/api/organizer/abandoned-carts/notify" orderId={row.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
