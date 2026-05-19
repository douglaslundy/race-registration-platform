import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/format";
import PublishEventButton from "@/components/organizer/PublishEventButton";
import DuplicateEventButton from "@/components/organizer/DuplicateEventButton";
import ArchiveEventButton from "@/components/organizer/ArchiveEventButton";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Gerenciar Evento" };

import { BADGE } from "@/lib/badge-colors";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  DRAFT:                { label: "Rascunho", color: BADGE.gray },
  UNDER_REVIEW:         { label: "Em análise", color: BADGE.yellow },
  PUBLISHED:            { label: "Publicado", color: BADGE.blue },
  REGISTRATIONS_OPEN:   { label: "Inscrições abertas", color: BADGE.green },
  SOLD_OUT:             { label: "Esgotado", color: BADGE.orange },
  REGISTRATIONS_CLOSED: { label: "Inscrições encerradas", color: BADGE.gray },
  COMPLETED:            { label: "Concluído", color: BADGE.green },
  CANCELLED:            { label: "Cancelado", color: BADGE.red },
};

export default async function OrganizerEventPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrganizer();
  const { id } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    include: {
      routes: { orderBy: { distanceKm: "asc" } },
      categories: { orderBy: { name: "asc" } },
      ticketBatches: { orderBy: { startAt: "asc" } },
      coupons: true,
      _count: { select: { registrations: true } },
      orders: { where: { status: "PAID" }, select: { totalAmount: true } },
    },
  });

  if (!event) notFound();

  const revenue = event.orders.reduce((s, o) => s + o.totalAmount, 0);
  const statusInfo = STATUS_LABEL[event.status] ?? STATUS_LABEL.DRAFT;
  const canPublish = event.status === "DRAFT";

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href="/organizador" className="hover:text-primary-600">← Dashboard</Link>
          </div>
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusInfo.color}`}>
              {statusInfo.label}
            </span>
            <span className="text-sm text-gray-500">{formatDate(event.startAt)}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Link href={`/organizador/eventos/${id}/editar`} className="btn-secondary text-sm">
            Editar evento
          </Link>
          {canPublish && <PublishEventButton eventId={id} />}
          <DuplicateEventButton eventId={id} />
          {!["COMPLETED", "CANCELLED"].includes(event.status) && <ArchiveEventButton eventId={id} />}
          <Link href={`/eventos/${event.slug}`} target="_blank" className="btn-secondary text-sm">
            Ver página →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-3xl font-bold text-primary-600">{event._count.registrations}</p>
          <p className="text-gray-500 text-sm mt-1">Inscrições</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{formatCurrency(revenue)}</p>
          <p className="text-gray-500 text-sm mt-1">Receita (pago)</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold">{event.ticketBatches.reduce((s, b) => s + b.capacity, 0)}</p>
          <p className="text-gray-500 text-sm mt-1">Vagas totais</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Lotes */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Lotes de inscrição</h2>
            <Link href={`/organizador/eventos/${id}/lotes`} className="text-xs text-primary-600 hover:underline">
              Gerenciar
            </Link>
          </div>
          {event.ticketBatches.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum lote criado</p>
          ) : (
            <div className="space-y-2">
              {event.ticketBatches.map((b) => (
                <div key={b.id} className="flex justify-between text-sm border-b pb-2 last:border-0">
                  <span className="font-medium">{b.name}</span>
                  <span className="text-gray-500">{b.soldCount}/{b.capacity} · {formatCurrency(b.priceAmount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Percursos */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Percursos</h2>
            <Link href={`/organizador/eventos/${id}/percursos`} className="text-xs text-primary-600 hover:underline">
              Gerenciar
            </Link>
          </div>
          {event.routes.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum percurso cadastrado</p>
          ) : (
            <div className="space-y-1">
              {event.routes.map((r) => (
                <div key={r.id} className="flex justify-between text-sm border-b pb-1 last:border-0">
                  <span>{r.name}</span>
                  <span className="text-gray-500">{r.distanceKm}km</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Categorias */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Categorias</h2>
            <Link href={`/organizador/eventos/${id}/categorias`} className="text-xs text-primary-600 hover:underline">
              Gerenciar
            </Link>
          </div>
          {event.categories.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhuma categoria cadastrada</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {event.categories.map((c) => (
                <span key={c.id} className="text-xs bg-gray-100 px-2 py-1 rounded">{c.name}</span>
              ))}
            </div>
          )}
        </div>

        {/* Cupons */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Cupons de desconto</h2>
            <Link href={`/organizador/eventos/${id}/cupons`} className="text-xs text-primary-600 hover:underline">
              Gerenciar
            </Link>
          </div>
          {event.coupons.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum cupom criado</p>
          ) : (
            <div className="space-y-1">
              {event.coupons.map((c) => (
                <div key={c.id} className="flex justify-between text-sm border-b pb-1 last:border-0">
                  <span className="font-mono font-medium">{c.code}</span>
                  <span className="text-gray-500">
                    {c.discountType === "PERCENT" ? `${c.discountValue}%` : formatCurrency(c.discountValue)}
                    {" · "}{c.usedCount}/{c.maxUses ?? "∞"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <Link href={`/organizador/eventos/${id}/inscritos`} className="btn-secondary flex-1 text-center">
          Ver inscritos
        </Link>
        <Link href={`/organizador/eventos/${id}/resultados`} className="btn-secondary flex-1 text-center">
          Importar resultados
        </Link>
      </div>
    </div>
  );
}
