import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/format";
import ChangeUserRoleButton from "@/components/admin/ChangeUserRoleButton";
import ToggleUserActiveButton from "@/components/admin/ToggleUserActiveButton";
import UserDeleteButton from "@/components/admin/UserDeleteButton";
import type { Metadata } from "next";
import type { UserRole } from "@prisma/client";

export const metadata: Metadata = { title: "Detalhe do Usuário — Admin" };

const ROLE_LABELS: Record<UserRole, string> = {
  ATHLETE: "Atleta",
  ORGANIZER: "Organizador",
  ADMIN: "Admin",
  SUPPORT: "Suporte",
  PARTNER: "Parceiro",
  ASSISTANT: "Assistente",
  ADVERTISER: "Anunciante",
};

const REGISTRATION_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Pagamento pendente",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
  TRANSFERRED: "Transferida",
  WAITLISTED: "Lista de espera",
};

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const user = await db.user.findUnique({
    where: { id },
    include: {
      organizerProfile: { select: { id: true } },
      registrations: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          event: { select: { title: true, startAt: true } },
          order: { select: { totalAmount: true, status: true } },
        },
      },
      orders: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, status: true, totalAmount: true, createdAt: true },
      },
    },
  });

  if (!user) notFound();

  // Estatísticas de eventos quando o usuário é organizador.
  let eventStats: { total: number; completed: number; ongoing: number; cancelled: number } | null = null;
  if (user.organizerProfile) {
    const grouped = await db.event.groupBy({
      by: ["status"],
      where: { organizerId: user.organizerProfile.id },
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = Object.fromEntries(
      grouped.map((g) => [g.status, g._count._all])
    );
    const total = grouped.reduce((s, g) => s + g._count._all, 0);
    const completed = byStatus.COMPLETED ?? 0;
    const cancelled = byStatus.CANCELLED ?? 0;
    eventStats = { total, completed, cancelled, ongoing: total - completed - cancelled };
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/admin/usuarios" className="hover:text-primary-600">
          ← Usuários
        </Link>
        <span>•</span>
        <Link href={`/admin/usuarios/${user.id}/editar`} className="hover:text-primary-600">
          Editar
        </Link>
        <Link href={`/api/admin/users/${user.id}/export`} className="hover:text-primary-600">
          Exportar CSV
        </Link>
      </div>

      <div className="card space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">{user.name}</h1>
            <p className="text-gray-500 text-sm">{user.email}</p>
            <p className="text-xs text-gray-400 mt-1">Cadastrado em {formatDate(user.createdAt)}</p>
          </div>
          <div className="flex flex-col gap-2 items-end">
            <Link href={`/api/admin/users/${user.id}/export`} className="text-xs text-primary-600 hover:underline">
              Exportar inscrições CSV
            </Link>
            <ChangeUserRoleButton userId={user.id} currentRole={user.role} />
            <ToggleUserActiveButton userId={user.id} active={user.active} />
            <UserDeleteButton userId={user.id} userName={user.name} />
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded">
            Role: <strong>{ROLE_LABELS[user.role]}</strong>
          </span>
          <span
            className={`px-2 py-1 rounded ${
              user.active
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
            }`}
          >
            {user.active ? "Ativo" : "Bloqueado"}
          </span>
        </div>
      </div>

      {eventStats && (
        <div className="card space-y-3">
          <h2 className="font-semibold">Eventos do organizador</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border dark:border-gray-700 p-3 text-center">
              <p className="text-2xl font-bold">{eventStats.total}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Total realizados</p>
            </div>
            <div className="rounded-lg border dark:border-gray-700 p-3 text-center">
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{eventStats.completed}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Concluídos</p>
            </div>
            <div className="rounded-lg border dark:border-gray-700 p-3 text-center">
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{eventStats.ongoing}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Em andamento</p>
            </div>
            <div className="rounded-lg border dark:border-gray-700 p-3 text-center">
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">{eventStats.cancelled}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Cancelados</p>
            </div>
          </div>
        </div>
      )}

      <div className="card space-y-3">
        <h2 className="font-semibold">Inscrições ({user.registrations.length})</h2>
        {user.registrations.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma inscrição</p>
        ) : (
          <div className="space-y-1 text-sm">
            {user.registrations.map((r) => (
              <div key={r.id} className="flex justify-between py-1 border-b last:border-0">
                <span className="truncate max-w-xs">{r.event.title}</span>
                <span className="text-gray-500 text-xs ml-2">
                  {REGISTRATION_STATUS_LABEL[r.status] ?? r.status} · {formatCurrency(r.order.totalAmount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
