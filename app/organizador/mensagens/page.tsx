import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { listMessageLogs, resolveMessageOwnerUserId, type MessageLogStatus } from "@/lib/message-logs";
import MessageLogList, { type MessageLogRow } from "@/components/messages/MessageLogList";

export const metadata: Metadata = { title: "Mensagens" };
export const dynamic = "force-dynamic";

interface SearchParams {
  channel?: string;
  status?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
}

export default async function OrganizerMensagensPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requirePermission("messages.view");
  const params = await searchParams;

  const ownerUserId = (await resolveMessageOwnerUserId(session)) ?? "__none__";

  const channel = params.channel === "EMAIL" || params.channel === "WHATSAPP" ? params.channel : undefined;
  const status = params.status?.trim() || undefined;
  const q = params.q?.trim() || undefined;
  const dateFrom = params.dateFrom?.trim() || "";
  const dateTo = params.dateTo?.trim() || "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const { rows, total, totalPages } = await listMessageLogs({
    channel,
    recipientUserId: ownerUserId,
    status: status as MessageLogStatus | undefined,
    q,
    from: dateFrom ? new Date(dateFrom) : undefined,
    to: dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : undefined,
    page,
  });

  const buildFilterQuery = (overrides: Partial<SearchParams> = {}) => {
    const query = new URLSearchParams();
    const merged = { channel, status, q, dateFrom, dateTo, ...overrides };
    if (merged.channel) query.set("channel", merged.channel);
    if (merged.status) query.set("status", merged.status);
    if (merged.q) query.set("q", merged.q);
    if (merged.dateFrom) query.set("dateFrom", merged.dateFrom);
    if (merged.dateTo) query.set("dateTo", merged.dateTo);
    return query;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mensagens</h1>
        <p className="text-sm text-gray-500">{total} mensagem(ns) encontrada(s)</p>
      </div>

      <form method="GET" className="card grid gap-4 md:grid-cols-6">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Buscar</label>
          <input name="q" defaultValue={q ?? ""} placeholder="Nome, e-mail ou telefone" className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Canal</label>
          <select name="channel" defaultValue={channel ?? ""} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            <option value="EMAIL">E-mail</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select name="status" defaultValue={status ?? ""} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            <option value="SENT">Enviado</option>
            <option value="DELIVERED">Entregue</option>
            <option value="READ">Lido</option>
            <option value="FAILED">Falhou</option>
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
        <div className="flex items-end gap-2">
          <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
          <Link href="/organizador/mensagens" className="btn-secondary py-1.5 px-4 text-sm">
            Limpar
          </Link>
        </div>
      </form>

      <MessageLogList rows={rows as MessageLogRow[]} />

      {totalPages > 1 && (
        <div className="flex gap-2 justify-center flex-wrap">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
            const query = buildFilterQuery();
            query.set("page", String(p));
            return (
              <Link
                key={p}
                href={`/organizador/mensagens?${query.toString()}`}
                className={`text-sm px-3 py-1.5 rounded-lg border ${
                  p === page ? "bg-primary-600 text-white border-primary-600" : "border-gray-300 dark:border-gray-600"
                }`}
              >
                {p}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
