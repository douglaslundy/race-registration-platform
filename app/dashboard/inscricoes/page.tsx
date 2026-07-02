import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/format";
import type { RegistrationStatus } from "@prisma/client";
import { BADGE } from "@/lib/badge-colors";

const STATUS_LABEL: Record<RegistrationStatus, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: BADGE.yellow },
  CONFIRMED:       { label: "Confirmada", color: BADGE.green },
  CANCELLED:       { label: "Cancelada", color: BADGE.red },
  TRANSFERRED:     { label: "Transferida", color: BADGE.blue },
  WAITLISTED:      { label: "Lista de espera", color: BADGE.gray },
  CANCELLATION_REQUESTED: { label: "Cancelamento solicitado", color: BADGE.yellow },
};

export default async function InscricoesPage() {
  const session = await requireAuth();

  const registrations = await db.registration.findMany({
    where: { athleteUserId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      event: { select: { title: true, slug: true, startAt: true, city: true, state: true, bannerUrl: true } },
      route: { select: { name: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true, priceAmount: true } },
      order: { select: { status: true, totalAmount: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Minhas Inscrições</h1>
        <Link href="/eventos" className="btn-primary text-sm">+ Nova inscrição</Link>
      </div>

      {registrations.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-4xl mb-4">🏁</p>
          <p className="text-gray-500 mb-4">Você não tem nenhuma inscrição ainda.</p>
          <Link href="/eventos" className="btn-primary">Explorar eventos</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {registrations.map((r) => {
            const badge = STATUS_LABEL[r.status];
            return (
              <Link
                key={r.id}
                href={`/dashboard/inscricoes/${r.id}`}
                className="card block hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${badge.color}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{r.event.title}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-1">
                      <span>📅 {formatDate(r.event.startAt)}</span>
                      <span>📍 {r.event.city}/{r.event.state}</span>
                      {r.route && <span>🏃 {r.route.name}</span>}
                      {r.category && <span>🏷️ {r.category.name}</span>}
                      {r.shirtSize && <span>👕 {r.shirtSize}</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Lote: {r.ticketBatch.name}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-primary-600">{formatCurrency(r.order.totalAmount)}</p>
                    {r.bibNumber && (
                      <p className="text-xs text-gray-500 mt-1">Nº {r.bibNumber}</p>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
