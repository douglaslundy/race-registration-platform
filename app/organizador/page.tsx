import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import DeleteEventButton from "@/components/organizer/DeleteEventButton";
import { BADGE } from "@/lib/badge-colors";

export const dynamic = "force-dynamic";

const EVENT_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT:                 { label: "Rascunho",             cls: BADGE.gray },
  UNDER_REVIEW:          { label: "Em análise",           cls: BADGE.yellow },
  PUBLISHED:             { label: "Publicado",            cls: BADGE.blue },
  REGISTRATIONS_OPEN:    { label: "Inscrições abertas",   cls: BADGE.green },
  SOLD_OUT:              { label: "Esgotado",             cls: BADGE.orange },
  REGISTRATIONS_CLOSED:  { label: "Inscrições encerradas",cls: BADGE.gray },
  COMPLETED:             { label: "Concluído",            cls: BADGE.green },
  CANCELLED:             { label: "Cancelado",            cls: BADGE.red },
};

export default async function OrganizerDashboard() {
  const session = await requireOrganizer();

  const organizer = await db.organizerProfile.findUnique({
    where: { userId: session.user.id },
    include: {
      events: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          _count: { select: { registrations: true } },
          orders: {
            where: { status: "PAID" },
            select: { totalAmount: true },
          },
        },
      },
    },
  });

  if (!organizer) {
    return (
      <div className="text-center py-16">
        <h1 className="text-2xl font-bold mb-4">Configure seu perfil de organizador</h1>
        <Link href="/organizador/perfil" className="btn-primary">Configurar perfil</Link>
      </div>
    );
  }

  const totalRevenue = organizer.events.reduce(
    (sum, e) => sum + e.orders.reduce((s, o) => s + o.totalAmount, 0),
    0
  );
  const totalRegistrations = organizer.events.reduce((sum, e) => sum + e._count.registrations, 0);

  const [confirmedRegistrations, pendingRegistrations, cancelledRegistrations] = await Promise.all([
    db.registration.count({ where: { event: { organizerId: organizer.id }, status: "CONFIRMED" } }),
    db.registration.count({ where: { event: { organizerId: organizer.id }, status: "PENDING_PAYMENT" } }),
    db.registration.count({ where: { event: { organizerId: organizer.id }, status: "CANCELLED" } }),
  ]);

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link href="/organizador/eventos/novo" className="btn-primary">+ Novo Evento</Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card text-center">
          <p className="text-3xl font-bold text-primary-600">{organizer.events.length}</p>
          <p className="text-gray-600 mt-1">Eventos</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{totalRegistrations}</p>
          <p className="text-gray-600 mt-1">Total de inscrições</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-blue-600">{formatCurrency(totalRevenue)}</p>
          <p className="text-gray-600 mt-1">Receita total</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{confirmedRegistrations}</p>
          <p className="text-gray-600 mt-1 text-sm">Inscrições efetivadas</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-yellow-600">{pendingRegistrations}</p>
          <p className="text-gray-600 mt-1 text-sm">Inscrições pendentes</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-red-600">{cancelledRegistrations}</p>
          <p className="text-gray-600 mt-1 text-sm">Inscrições canceladas</p>
        </div>
      </div>

      <div className="card" id="meus-eventos">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold">Meus Eventos</h2>
          <p className="text-xs text-gray-500">Abra um evento para editar, criar lotes e cupons.</p>
        </div>
        {organizer.events.length === 0 ? (
          <p className="text-gray-500 text-center py-8">Nenhum evento criado ainda</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b dark:border-gray-700">
                <th className="pb-2">Evento</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Inscrições</th>
                <th className="pb-2">Receita</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {organizer.events.map((event) => (
                <tr key={event.id} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="py-3 font-medium">{event.title}</td>
                  <td className="py-3">
                    {(() => { const s = EVENT_STATUS[event.status] ?? { label: event.status, cls: BADGE.gray }; return (
                      <span className={`text-xs px-2 py-1 rounded font-medium ${s.cls}`}>{s.label}</span>
                    ); })()}
                  </td>
                  <td className="py-3">{event._count.registrations}</td>
                  <td className="py-3">{formatCurrency(event.orders.reduce((s, o) => s + o.totalAmount, 0))}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      <Link href={`/organizador/eventos/${event.id}`} className="text-primary-600 hover:underline">
                        Gerenciar
                      </Link>
                      {["DRAFT", "CANCELLED"].includes(event.status) && (
                        <DeleteEventButton eventId={event.id} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
