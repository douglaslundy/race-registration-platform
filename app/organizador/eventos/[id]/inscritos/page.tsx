import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import ExportCsvButton from "@/components/organizer/ExportCsvButton";
import PrintButton from "@/components/ui/PrintButton";
import type { Metadata } from "next";
import { buildRegistrationOrderBy, buildRegistrationWhere } from "@/lib/organizer/registrations";
import { formatCurrency } from "@/lib/format";
import RefundRegistrationButton from "@/components/organizer/RefundRegistrationButton";
import CancellationDecisionButtons from "@/components/organizer/CancellationDecisionButtons";
import ManualConfirmButton from "@/components/organizer/ManualConfirmButton";
import ResendPaymentNotificationButton from "@/components/registrations/ResendPaymentNotificationButton";
import RegistrationsTable from "@/components/registrations/RegistrationsTable";

export const metadata: Metadata = { title: "Inscritos" };

import { BADGE } from "@/lib/badge-colors";

const REGISTRATION_STATUS: Record<string, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: BADGE.yellow },
  CONFIRMED:       { label: "Confirmada", color: BADGE.green },
  CANCELLED:       { label: "Cancelada", color: BADGE.red },
  TRANSFERRED:     { label: "Transferida", color: BADGE.blue },
  WAITLISTED:      { label: "Lista de espera", color: BADGE.gray },
  CANCELLATION_REQUESTED: { label: "Cancelamento solicitado", color: BADGE.orange },
};

interface SearchParams {
  status?: string;
  sort?: string;
  dir?: string;
  q?: string;
}

function buildInscritosUrl(id: string, params: { status?: string; sort?: string; dir?: string; q?: string }) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.sort) query.set("sort", params.sort);
  if (params.dir) query.set("dir", params.dir);
  if (params.q) query.set("q", params.q);
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
  const sortConfig = buildRegistrationOrderBy(sp.sort?.trim() ?? "", sp.dir?.trim() ?? "");

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    select: { id: true, title: true },
  });
  if (!event) notFound();

  const registrations = await db.registration.findMany({
    where: buildRegistrationWhere(id, status, q),
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
          payments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { method: true, paidAt: true, status: true, providerPaymentId: true },
          },
        },
      },
    },
    orderBy: sortConfig.orderBy,
  });

  const totalAmount = registrations.reduce((s, r) => s + r.order.totalAmount, 0);

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
          <p className="text-sm text-gray-500">
            {registrations.length} inscrições · Total de pagamentos: <strong className="text-gray-700 dark:text-gray-300">{formatCurrency(totalAmount)}</strong>
          </p>
        </div>
        <div className="flex gap-2">
          <ExportCsvButton eventId={id} />
          <PrintButton label="Imprimir PDF" />
        </div>
      </div>

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
            {Object.entries(REGISTRATION_STATUS).map(([value, info]) => (
              <option key={value} value={value}>{info.label}</option>
            ))}
          </select>
        </div>
        <input type="hidden" name="sort" value={sortConfig.normalizedSort} />
        <input type="hidden" name="dir" value={sortConfig.normalizedDir} />
        <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
        {status || q ? (
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
          href={buildInscritosUrl(id, { status, q, sort: "name", dir: nameDir })}
          className={sortConfig.normalizedSort === "name" ? activeButtonClass : inactiveButtonClass}
        >
          Ordem alfabética {sortConfig.normalizedSort === "name" ? (sortConfig.normalizedDir === "asc" ? "↑" : "↓") : ""}
        </Link>
        <Link
          href={buildInscritosUrl(id, { status, q, sort: "date", dir: dateDir })}
          className={sortConfig.normalizedSort === "date" ? activeButtonClass : inactiveButtonClass}
        >
          Ordem cronológica {sortConfig.normalizedSort === "date" ? (sortConfig.normalizedDir === "asc" ? "↑" : "↓") : ""}
        </Link>
      </div>

      {registrations.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">Nenhuma inscrição ainda.</div>
      ) : (
        <RegistrationsTable
          registrations={registrations}
          editEndpoint={(r) => `/api/organizer/registrations/${r.id}/athlete`}
          renderActions={(r) => {
            const payment = r.order.payments[0];
            return (
              <>
                {payment?.status === "PAID" && <RefundRegistrationButton registrationId={r.id} />}
                {r.status === "CANCELLATION_REQUESTED" && <CancellationDecisionButtons registrationId={r.id} />}
                {r.status === "PENDING_PAYMENT" && <ManualConfirmButton registrationId={r.id} />}
                {(payment?.status === "EXPIRED" || payment?.status === "CANCELLED") && (
                  <ResendPaymentNotificationButton
                    endpoint={`/api/organizer/registrations/${r.id}/resend-payment-notification`}
                  />
                )}
                {r.status === "CONFIRMED" && !r.order.confirmationEmailSentAt && (
                  <ResendPaymentNotificationButton
                    endpoint={`/api/organizer/registrations/${r.id}/resend-confirmation-email`}
                    label="Enviar e-mail de confirmação"
                    loadingLabel="Enviando..."
                  />
                )}
              </>
            );
          }}
        />
      )}
    </div>
  );
}
