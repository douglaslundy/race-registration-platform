import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { listMessageLogs, resolveMessageOwnerUserId, type MessageLogStatus } from "@/lib/message-logs";
import MessageLogList, { type MessageLogRow } from "@/components/messages/MessageLogList";

export const metadata: Metadata = { title: "Mensagens" };
export const dynamic = "force-dynamic";

interface SearchParams {
  tab?: string;
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

  const channel = params.tab === "whatsapp" ? "WHATSAPP" : "EMAIL";
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

  const buildTabUrl = (tab: "email" | "whatsapp") => `/organizador/mensagens?tab=${tab}`;

  const buildFilterQuery = (overrides: Partial<SearchParams> = {}) => {
    const query = new URLSearchParams();
    query.set("tab", params.tab === "whatsapp" ? "whatsapp" : "email");
    const merged = { status, q, dateFrom, dateTo, ...overrides };
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

      <div className="flex gap-2 border-b dark:border-gray-700">
        <Link
          href={buildTabUrl("email")}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            channel === "EMAIL" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500"
          }`}
        >
          E-mail
        </Link>
        <Link
          href={buildTabUrl("whatsapp")}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            channel === "WHATSAPP" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500"
          }`}
        >
          WhatsApp
        </Link>
      </div>

      <form method="GET" className="card grid gap-4 md:grid-cols-5">
        <input type="hidden" name="tab" value={params.tab === "whatsapp" ? "whatsapp" : "email"} />
        <div>
          <label className="block text-xs text-gray-500 mb-1">Buscar</label>
          <input name="q" defaultValue={q ?? ""} placeholder="Nome, e-mail ou telefone" className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select name="status" defaultValue={status ?? ""} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            <option value="SENT">Enviado</option>
            {channel === "WHATSAPP" && <option value="DELIVERED">Entregue</option>}
            {channel === "WHATSAPP" && <option value="READ">Lido</option>}
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
          <Link href={buildTabUrl(channel === "WHATSAPP" ? "whatsapp" : "email")} className="btn-secondary py-1.5 px-4 text-sm">
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
