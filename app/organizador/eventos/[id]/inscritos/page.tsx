import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import ExportCsvButton from "@/components/organizer/ExportCsvButton";
import type { Metadata } from "next";
import { buildRegistrationOrderBy, buildRegistrationWhere } from "@/lib/organizer/registrations";
import { formatCurrency } from "@/lib/format";
import RefundRegistrationButton from "@/components/organizer/RefundRegistrationButton";
import CancellationDecisionButtons from "@/components/organizer/CancellationDecisionButtons";
import ManualConfirmButton from "@/components/organizer/ManualConfirmButton";
import ResendPaymentNotificationButton from "@/components/registrations/ResendPaymentNotificationButton";
import CancelPendingRegistrationButton from "@/components/registrations/CancelPendingRegistrationButton";
import CancelConfirmedRegistrationButton from "@/components/registrations/CancelConfirmedRegistrationButton";
import RegistrationsTable from "@/components/registrations/RegistrationsTable";
import { PAYMENT_METHOD_LABEL } from "@/components/registrations/RegistrationsTable";
import AutoPrint from "@/components/ui/AutoPrint";
import { canCancelPendingRegistration } from "@/lib/registrations/pending-cancellation";

export const metadata: Metadata = { title: "Inscritos" };

import { BADGE } from "@/lib/badge-colors";
import { REGISTRATION_STATUS } from "@/lib/registration-status";

const FILTER_STATUS_OPTIONS: Record<string, { label: string; color: string }> = {
  ...REGISTRATION_STATUS,
  REFUNDED:        { label: "Estornado", color: BADGE.purple },
  REFUND_PENDING:  { label: "Cancelado — reembolso pendente", color: BADGE.orange },
};

interface SearchParams {
  status?: string;
  sort?: string;
  dir?: string;
  q?: string;
  categoryId?: string;
  routeId?: string;
  ticketBatchId?: string;
  couponId?: string;
  paymentMethod?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
  print?: string;
}

const PAGE_SIZE = 50;

function buildInscritosUrl(
  id: string,
  params: {
    status?: string;
    sort?: string;
    dir?: string;
    q?: string;
    categoryId?: string;
    routeId?: string;
    ticketBatchId?: string;
    couponId?: string;
    paymentMethod?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
  },
) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.sort) query.set("sort", params.sort);
  if (params.dir) query.set("dir", params.dir);
  if (params.q) query.set("q", params.q);
  if (params.categoryId) query.set("categoryId", params.categoryId);
  if (params.routeId) query.set("routeId", params.routeId);
  if (params.ticketBatchId) query.set("ticketBatchId", params.ticketBatchId);
  if (params.couponId) query.set("couponId", params.couponId);
  if (params.paymentMethod) query.set("paymentMethod", params.paymentMethod);
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  if (params.page && params.page > 1) query.set("page", String(params.page));
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
  const q = sp.q?.trim() ?? "";
  const categoryId = sp.categoryId?.trim() ?? "";
  const routeId = sp.routeId?.trim() ?? "";
  const ticketBatchId = sp.ticketBatchId?.trim() ?? "";
  const couponId = sp.couponId?.trim() ?? "";
  const paymentMethod = sp.paymentMethod?.trim() ?? "";
  const dateFrom = sp.dateFrom?.trim() ?? "";
  const dateTo = sp.dateTo?.trim() ?? "";
  const sortConfig = buildRegistrationOrderBy(sp.sort?.trim() ?? "", sp.dir?.trim() ?? "");
  const requestedPage = Number.parseInt(sp.page ?? "1", 10);
  const printMode = sp.print === "1";

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    select: {
      id: true,
      title: true,
      categories: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      routes: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      ticketBatches: { select: { id: true, name: true }, orderBy: { startAt: "asc" } },
      coupons: { select: { id: true, code: true }, orderBy: { code: "asc" } },
    },
  });
  if (!event) notFound();

  const where = buildRegistrationWhere(id, { status, q, categoryId, routeId, ticketBatchId, couponId, paymentMethod, dateFrom, dateTo });

  const [total, totalAmountRows] = await Promise.all([
    db.registration.count({ where }),
    // Select mínimo (só o totalAmount do pedido via join) — evita carregar os includes pesados
    // (perfil do atleta, pagamentos etc.) só pra somar o total de todas as inscrições filtradas,
    // já que essa soma precisa considerar o filtro inteiro, não só a página atual.
    db.registration.findMany({ where, select: { order: { select: { totalAmount: true } } } }),
  ]);
  const totalAmount = totalAmountRows.reduce((s, r) => s + r.order.totalAmount, 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, totalPages) : 1;

  const registrations = await db.registration.findMany({
    where,
    include: {
      athlete: {
        select: {
          id: true,
          name: true,
          email: true,
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
      },
      route: { select: { name: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true } },
      order: {
        select: {
          id: true,
          totalAmount: true,
          confirmationEmailSentAt: true,
        },
      },
    },
    orderBy: sortConfig.orderBy,
    ...(printMode ? {} : { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  });

  // Busca o último pagamento de cada pedido em UMA query (IN), em vez do include aninhado com
  // take:1 por pedido — que o Prisma resolve como uma query separada por pedido (N+1 real).
  const orderIds = registrations.map((r) => r.order.id);
  const latestPayments = orderIds.length
    ? await db.payment.findMany({
        where: { orderId: { in: orderIds } },
        orderBy: { createdAt: "desc" },
        select: { orderId: true, method: true, paidAt: true, status: true, providerPaymentId: true },
      })
    : [];
  const latestPaymentByOrder = new Map<string, { method: string; paidAt: Date | null; status: string; providerPaymentId: string | null }>();
  for (const p of latestPayments) {
    if (p.orderId && !latestPaymentByOrder.has(p.orderId)) {
      latestPaymentByOrder.set(p.orderId, { method: p.method, paidAt: p.paidAt, status: p.status, providerPaymentId: p.providerPaymentId });
    }
  }
  const registrationsWithPayment = registrations.map((r) => ({
    ...r,
    order: { ...r.order, payments: latestPaymentByOrder.has(r.order.id) ? [latestPaymentByOrder.get(r.order.id)!] : [] },
  }));
  const paidOrderIds = new Set(latestPayments.filter((p) => p.status === "PAID" && p.orderId).map((p) => p.orderId!));

  const nameDir = sortConfig.normalizedSort === "name" && sortConfig.normalizedDir === "asc" ? "desc" : "asc";
  const dateDir = sortConfig.normalizedSort === "date" && sortConfig.normalizedDir === "asc" ? "desc" : "asc";
  const activeButtonClass = "text-sm px-3 py-1.5 rounded-lg border border-primary-500 text-primary-600";
  const inactiveButtonClass = "text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700";
  const filteredUrl = buildInscritosUrl(id, { status, q, categoryId, routeId, ticketBatchId, couponId, paymentMethod, dateFrom, dateTo, sort: sortConfig.normalizedSort, dir: sortConfig.normalizedDir });
  const printUrl = `${filteredUrl}${filteredUrl.includes("?") ? "&" : "?"}print=1`;

  return (
    <div className="space-y-6">
      {printMode && <AutoPrint />}
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600 print:hidden">← Voltar ao evento</Link>
          <h1 className="text-xl font-bold mt-1">Inscritos — {event.title}</h1>
          <p className="text-sm text-gray-500">
            {total} inscrições · Total de pagamentos: <strong className="text-gray-700 dark:text-gray-300">{formatCurrency(totalAmount)}</strong>
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <ExportCsvButton eventId={id} />
          <a href={printUrl} target="_blank" rel="noopener" className="btn-secondary text-sm">Imprimir PDF</a>
        </div>
      </div>

      {!printMode && (
      <>
      <form method="GET" className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Buscar por pedido, nome, e-mail ou CPF</label>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Nº do pedido, nome, e-mail ou CPF"
            className="input-field text-sm py-1.5"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select name="status" defaultValue={status} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {Object.entries(FILTER_STATUS_OPTIONS).map(([value, info]) => (
              <option key={value} value={value}>{info.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Categoria</label>
          <select name="categoryId" defaultValue={categoryId} className="input-field text-sm py-1.5">
            <option value="">Todas</option>
            {event.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Percurso</label>
          <select name="routeId" defaultValue={routeId} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {event.routes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Lote</label>
          <select name="ticketBatchId" defaultValue={ticketBatchId} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {event.ticketBatches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Cupom</label>
          <select name="couponId" defaultValue={couponId} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            <option value="none">Sem cupom</option>
            {event.coupons.map((c) => (
              <option key={c.id} value={c.id}>{c.code}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tipo de pagamento</label>
          <select name="paymentMethod" defaultValue={paymentMethod} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Inscrito de</label>
          <input type="date" name="dateFrom" defaultValue={dateFrom} className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Inscrito até</label>
          <input type="date" name="dateTo" defaultValue={dateTo} className="input-field text-sm py-1.5" />
        </div>
        <input type="hidden" name="sort" value={sortConfig.normalizedSort} />
        <input type="hidden" name="dir" value={sortConfig.normalizedDir} />
        <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
        {status || q || categoryId || routeId || ticketBatchId || couponId || paymentMethod || dateFrom || dateTo ? (
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
          href={buildInscritosUrl(id, { status, q, categoryId, routeId, ticketBatchId, couponId, paymentMethod, dateFrom, dateTo, sort: "name", dir: nameDir })}
          className={sortConfig.normalizedSort === "name" ? activeButtonClass : inactiveButtonClass}
        >
          Ordem alfabética {sortConfig.normalizedSort === "name" ? (sortConfig.normalizedDir === "asc" ? "↑" : "↓") : ""}
        </Link>
        <Link
          href={buildInscritosUrl(id, { status, q, categoryId, routeId, ticketBatchId, couponId, paymentMethod, dateFrom, dateTo, sort: "date", dir: dateDir })}
          className={sortConfig.normalizedSort === "date" ? activeButtonClass : inactiveButtonClass}
        >
          Ordem cronológica {sortConfig.normalizedSort === "date" ? (sortConfig.normalizedDir === "asc" ? "↑" : "↓") : ""}
        </Link>
      </div>
      </>
      )}

      {total === 0 ? (
        <div className="card text-center py-12 text-gray-500">Nenhuma inscrição ainda.</div>
      ) : (
        <>
          <RegistrationsTable
            registrations={registrationsWithPayment}
            editEndpoint={(r) => `/api/organizer/registrations/${r.id}/athlete`}
            renderActions={(r) => {
              const payment = r.order.payments[0];
              return (
                <>
                  {payment?.status === "PAID" && <RefundRegistrationButton registrationId={r.id} />}
                  {r.status === "CANCELLATION_REQUESTED" && (
                    <CancellationDecisionButtons
                      cancellationReason={r.cancellationReason}
                      endpoint={`/api/organizer/registrations/${r.id}/cancellation-decision`}
                      requestCodeEndpoint={`/api/organizer/registrations/${r.id}/cancellation-decision/request-code`}
                      hasPaidPayment={paidOrderIds.has(r.order.id)}
                    />
                  )}
                  {r.status === "PENDING_PAYMENT" && <ManualConfirmButton registrationId={r.id} />}
                  {canCancelPendingRegistration(r, payment) && (
                    <CancelPendingRegistrationButton endpoint={`/api/organizer/registrations/${r.id}/cancel-pending`} />
                  )}
                  {((payment?.status === "EXPIRED" || payment?.status === "CANCELLED") || (r.status === "CANCELLED" && !payment)) && (
                    <ResendPaymentNotificationButton
                      endpoint={`/api/organizer/registrations/${r.id}/resend-payment-notification`}
                    />
                  )}
                  {r.status === "CONFIRMED" && (
                    <>
                      <ResendPaymentNotificationButton
                        endpoint={`/api/organizer/registrations/${r.id}/resend-confirmation-email`}
                        label="Reenviar confirmação"
                        loadingLabel="Enviando..."
                      />
                      <CancelConfirmedRegistrationButton
                        endpoint={`/api/organizer/registrations/${r.id}/cancel-confirmed`}
                        requestCodeEndpoint={`/api/organizer/registrations/${r.id}/cancel-confirmed/request-code`}
                      />
                    </>
                  )}
                </>
              );
            }}
          />
          {!printMode && totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <Link
                href={buildInscritosUrl(id, { status, q, categoryId, routeId, ticketBatchId, couponId, paymentMethod, dateFrom, dateTo, sort: sortConfig.normalizedSort, dir: sortConfig.normalizedDir, page: Math.max(1, page - 1) })}
                aria-disabled={page === 1}
                className={`text-sm px-3 py-1.5 rounded-lg border ${page === 1 ? "pointer-events-none border-gray-200 text-gray-300 dark:border-gray-700 dark:text-gray-600" : "border-gray-300 hover:border-primary-400 dark:border-gray-600 dark:text-gray-200 dark:hover:border-primary-500"}`}
              >
                Anterior
              </Link>
              <span className="text-sm text-gray-500">Página {page} de {totalPages}</span>
              <Link
                href={buildInscritosUrl(id, { status, q, categoryId, routeId, ticketBatchId, couponId, paymentMethod, dateFrom, dateTo, sort: sortConfig.normalizedSort, dir: sortConfig.normalizedDir, page: Math.min(totalPages, page + 1) })}
                aria-disabled={page === totalPages}
                className={`text-sm px-3 py-1.5 rounded-lg border ${page === totalPages ? "pointer-events-none border-gray-200 text-gray-300 dark:border-gray-700 dark:text-gray-600" : "border-gray-300 hover:border-primary-400 dark:border-gray-600 dark:text-gray-200 dark:hover:border-primary-500"}`}
              >
                Próxima
              </Link>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
