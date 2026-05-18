import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";

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

  return (
    <div className="space-y-8">
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
          <p className="text-gray-600 mt-1">Inscrições</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-blue-600">{formatCurrency(totalRevenue)}</p>
          <p className="text-gray-600 mt-1">Receita total</p>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Meus Eventos</h2>
        {organizer.events.length === 0 ? (
          <p className="text-gray-500 text-center py-8">Nenhum evento criado ainda</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Evento</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Inscrições</th>
                <th className="pb-2">Receita</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {organizer.events.map((event) => (
                <tr key={event.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-3 font-medium">{event.title}</td>
                  <td className="py-3">
                    <span className="text-xs bg-gray-100 px-2 py-1 rounded">{event.status}</span>
                  </td>
                  <td className="py-3">{event._count.registrations}</td>
                  <td className="py-3">{formatCurrency(event.orders.reduce((s, o) => s + o.totalAmount, 0))}</td>
                  <td className="py-3">
                    <Link href={`/organizador/eventos/${event.id}`} className="text-primary-600 hover:underline">
                      Gerenciar
                    </Link>
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
