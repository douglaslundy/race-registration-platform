import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/format";
import ApproveEventButton from "@/components/admin/ApproveEventButton";
import { EVENT_STATUS_LABEL, MODALITY_LABEL } from "@/lib/admin/labels";
import { computeRegistrationStatusBreakdown } from "@/lib/organizer/event-metrics";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Detalhe do Evento — Admin" };

export default async function AdminEventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const event = await db.event.findUnique({
    where: { id },
    include: {
      organizer: { include: { user: { select: { id: true, name: true, email: true } } } },
      routes: true,
      categories: true,
      ticketBatches: true,
      orders: { where: { status: "PAID" }, select: { totalAmount: true } },
    },
  });

  if (!event) notFound();

  const revenue = event.orders.reduce((s, o) => s + o.totalAmount, 0);

  const statusCounts = await db.registration.groupBy({
    by: ["status"],
    where: { eventId: id },
    _count: { id: true },
  });
  const breakdown = computeRegistrationStatusBreakdown(
    statusCounts.map((s) => ({ status: s.status, count: s._count.id }))
  );

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/admin/eventos" className="hover:text-primary-600">← Eventos</Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <p className="text-sm text-gray-500 mt-1">{MODALITY_LABEL[event.modality] ?? event.modality} · {formatDate(event.startAt)} · {event.city}/{event.state}</p>
          <span className="text-xs bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 px-2 py-0.5 rounded mt-1 inline-block">{EVENT_STATUS_LABEL[event.status] ?? event.status}</span>
        </div>
        {event.status === "UNDER_REVIEW" && (
          <ApproveEventButton eventId={event.id} />
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-primary-600">{breakdown.paid}</p>
          <p className="text-gray-500 text-sm">Inscrições confirmadas</p>
          <p className="text-xs text-gray-400 mt-1">{breakdown.pending} pendentes · {breakdown.cancelled} canceladas</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-green-600">{formatCurrency(revenue)}</p>
          <p className="text-gray-500 text-sm">Receita</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold">{event.ticketBatches.reduce((s, b) => s + b.capacity, 0)}</p>
          <p className="text-gray-500 text-sm">Vagas totais</p>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Organizador</h2>
        <div className="flex items-center justify-between text-sm">
          <div>
            <p className="font-medium">{event.organizer.user.name}</p>
            <p className="text-gray-500">{event.organizer.user.email}</p>
            {event.organizer.companyName && <p className="text-gray-500">{event.organizer.companyName}</p>}
          </div>
          <Link href={`/admin/usuarios/${event.organizer.userId}`} className="text-xs text-primary-600 hover:underline">
            Ver perfil
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Lotes</h2>
          {event.ticketBatches.map((b) => (
            <div key={b.id} className="flex justify-between text-xs border-b pb-1 last:border-0">
              <span>{b.name}</span>
              <span className="text-gray-500">{b.soldCount}/{b.capacity} · {formatCurrency(b.priceAmount)}</span>
            </div>
          ))}
        </div>
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Percursos</h2>
          {event.routes.map((r) => (
            <div key={r.id} className="flex justify-between text-xs border-b pb-1 last:border-0">
              <span>{r.name}</span>
              <span className="text-gray-500">{r.distanceKm}km</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <Link href={`/admin/eventos/${event.id}/inscritos`} className="btn-secondary text-sm">
          Ver inscritos
        </Link>
        <Link href={`/api/events/${event.id}/registrations?format=csv`} className="btn-secondary text-sm">
          Exportar inscritos CSV
        </Link>
        <Link href={`/eventos/${event.slug}`} target="_blank" className="btn-secondary text-sm">
          Ver página pública
        </Link>
      </div>
    </div>
  );
}
