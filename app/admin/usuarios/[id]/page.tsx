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
};

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const user = await db.user.findUnique({
    where: { id },
    include: {
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

  return (
    <div className="space-y-6 max-w-3xl">
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
                  {r.status} · {formatCurrency(r.order.totalAmount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
