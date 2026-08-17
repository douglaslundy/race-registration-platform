import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { listMessageLogs, MESSAGE_TYPE_LABEL, type MessageLogStatus } from "@/lib/message-logs";
import MessageLogList, { type MessageLogRow } from "@/components/messages/MessageLogList";

export const metadata: Metadata = { title: "Mensagens — Admin" };
export const dynamic = "force-dynamic";

/** Janela de páginas ao redor da atual (+ primeira/última), com "..." nos vãos — evita renderizar
 * um botão por página quando totalPages é grande (ex.: 29 páginas viravam 29 links sem limite). */
function getPaginationRange(current: number, total: number): (number | "...")[] {
  const siblingCount = 1;
  const totalVisible = siblingCount * 2 + 5; // primeira + última + atual + 2 vizinhos + 2 reticências
  if (total <= totalVisible) return Array.from({ length: total }, (_, i) => i + 1);

  const leftSibling = Math.max(current - siblingCount, 1);
  const rightSibling = Math.min(current + siblingCount, total);
  const showLeftDots = leftSibling > 2;
  const showRightDots = rightSibling < total - 1;

  if (!showLeftDots && showRightDots) {
    const leftRange = Array.from({ length: 3 + siblingCount * 2 }, (_, i) => i + 1);
    return [...leftRange, "...", total];
  }
  if (showLeftDots && !showRightDots) {
    const rightCount = 3 + siblingCount * 2;
    const rightRange = Array.from({ length: rightCount }, (_, i) => total - rightCount + i + 1);
    return [1, "...", ...rightRange];
  }
  const middleRange = Array.from({ length: rightSibling - leftSibling + 1 }, (_, i) => leftSibling + i);
  return [1, "...", ...middleRange, "...", total];
}

interface SearchParams {
  channel?: string;
  type?: string;
  status?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
}

export default async function AdminMensagensPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("messages.view");
  const params = await searchParams;

  const channel = params.channel === "EMAIL" || params.channel === "WHATSAPP" ? params.channel : undefined;
  const messageType = params.type?.trim() || undefined;
  const status = params.status?.trim() || undefined;
  const q = params.q?.trim() || undefined;
  const dateFrom = params.dateFrom?.trim() || "";
  const dateTo = params.dateTo?.trim() || "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const { rows, total, totalPages } = await listMessageLogs({
    channel,
    messageType,
    status: status as MessageLogStatus | undefined,
    q,
    from: dateFrom ? new Date(dateFrom) : undefined,
    to: dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : undefined,
    page,
  });

  const buildFilterQuery = (overrides: Partial<SearchParams> = {}) => {
    const query = new URLSearchParams();
    const merged = { channel, type: messageType, status, q, dateFrom, dateTo, ...overrides };
    if (merged.channel) query.set("channel", merged.channel);
    if (merged.type) query.set("type", merged.type);
    if (merged.status) query.set("status", merged.status);
    if (merged.q) query.set("q", merged.q);
    if (merged.dateFrom) query.set("dateFrom", merged.dateFrom);
    if (merged.dateTo) query.set("dateTo", merged.dateTo);
    return query;
  };

  const pageHref = (p: number) => {
    const query = buildFilterQuery();
    query.set("page", String(p));
    return `/admin/mensagens?${query.toString()}`;
  };
  const pagerButtonClass = (disabledOrInactive: boolean, active = false) =>
    `text-sm px-3 py-1.5 rounded-lg border transition-colors ${
      active
        ? "bg-primary-600 text-white border-primary-600"
        : disabledOrInactive
          ? "pointer-events-none border-gray-200 text-gray-300 dark:border-gray-700 dark:text-gray-600"
          : "border-gray-300 hover:border-primary-400 hover:text-primary-600 dark:border-gray-600 dark:text-gray-200 dark:hover:border-primary-500"
    }`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mensagens</h1>
        <p className="text-sm text-gray-500">{total} mensagem(ns) encontrada(s)</p>
      </div>

      <form method="GET" className="card grid gap-4 md:grid-cols-7">
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
          <label className="block text-xs text-gray-500 mb-1">Tipo</label>
          <select name="type" defaultValue={messageType ?? ""} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {Object.entries(MESSAGE_TYPE_LABEL).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
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
          <Link href="/admin/mensagens" className="btn-secondary py-1.5 px-4 text-sm">
            Limpar
          </Link>
        </div>
      </form>

      <MessageLogList rows={rows as MessageLogRow[]} />

      {totalPages > 1 && (
        <div className="flex justify-end">
          <nav className="flex items-center justify-end gap-1.5 flex-wrap" aria-label="Paginação">
            <Link href={pageHref(Math.max(1, page - 1))} aria-disabled={page === 1} className={pagerButtonClass(page === 1)}>
              ‹ Anterior
            </Link>
            {getPaginationRange(page, totalPages).map((p, i) =>
              p === "..." ? (
                <span key={`ellipsis-${i}`} className="px-1 text-sm text-gray-400 select-none">
                  …
                </span>
              ) : (
                <Link key={p} href={pageHref(p)} className={pagerButtonClass(false, p === page)}>
                  {p}
                </Link>
              ),
            )}
            <Link
              href={pageHref(Math.min(totalPages, page + 1))}
              aria-disabled={page === totalPages}
              className={pagerButtonClass(page === totalPages)}
            >
              Próxima ›
            </Link>
          </nav>
        </div>
      )}
    </div>
  );
}
