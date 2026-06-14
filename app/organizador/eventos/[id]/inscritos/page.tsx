import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import ExportCsvButton from "@/components/organizer/ExportCsvButton";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Metadata } from "next";

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

export default async function InscritosPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrganizer();
  const { id } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    select: { id: true, title: true },
  });
  if (!event) notFound();

  const registrations = await db.registration.findMany({
    where: { eventId: id },
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
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">← Voltar ao evento</Link>
          <h1 className="text-xl font-bold mt-1">Inscritos — {event.title}</h1>
          <p className="text-sm text-gray-500">{registrations.length} inscrições</p>
        </div>
        <ExportCsvButton eventId={id} />
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
                      {payment?.paidAt ? formatDate(payment.paidAt) : "—"}
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
