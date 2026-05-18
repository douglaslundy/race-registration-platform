import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/format";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: "bg-yellow-100 text-yellow-700" },
  CONFIRMED:       { label: "Confirmada", color: "bg-green-100 text-green-700" },
  CANCELLED:       { label: "Cancelada", color: "bg-red-100 text-red-700" },
  TRANSFERRED:     { label: "Transferida", color: "bg-blue-100 text-blue-700" },
  WAITLISTED:      { label: "Lista de espera", color: "bg-gray-100 text-gray-600" },
};

export default async function DashboardHome() {
  const session = await requireAuth();

  const registrations = await db.registration.findMany({
    where: { athleteUserId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      event: { select: { title: true, slug: true, startAt: true, city: true, state: true } },
      ticketBatch: { select: { name: true, priceAmount: true } },
    },
  });

  const pendingPayments = registrations.filter((r) => r.status === "PENDING_PAYMENT").length;
  const confirmed = registrations.filter((r) => r.status === "CONFIRMED").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Olá, {session.user.name.split(" ")[0]}!</h1>
        <p className="text-gray-500 text-sm mt-1">Bem-vindo ao seu painel de atleta</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">{confirmed}</p>
          <p className="text-gray-600 text-sm mt-1">Inscrições confirmadas</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-yellow-600">{pendingPayments}</p>
          <p className="text-gray-600 text-sm mt-1">Pagamentos pendentes</p>
        </div>
        <div className="card text-center col-span-2 md:col-span-1">
          <p className="text-3xl font-bold text-primary-600">{registrations.length}</p>
          <p className="text-gray-600 text-sm mt-1">Total de inscrições</p>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">Inscrições recentes</h2>
          <Link href="/dashboard/inscricoes" className="text-sm text-primary-600 hover:underline">Ver todas</Link>
        </div>

        {registrations.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">Você ainda não tem inscrições.</p>
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
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{r.event.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatDate(r.event.startAt)} · {r.event.city}/{r.event.state}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm font-semibold text-primary-600 hidden sm:block">
                      {formatCurrency(r.ticketBatch.priceAmount)}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${badge?.color}`}>
                      {badge?.label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="card bg-primary-50 border-primary-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-primary-900">Próximos eventos</p>
            <p className="text-sm text-primary-700 mt-1">Encontre sua próxima corrida</p>
          </div>
          <Link href="/eventos" className="btn-primary text-sm">Ver eventos</Link>
        </div>
      </div>
    </div>
  );
}
