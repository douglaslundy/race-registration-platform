import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import Link from "next/link";
import type { UserRole } from "@prisma/client";
import type { Metadata } from "next";
import { BADGE } from "@/lib/badge-colors";

export const metadata: Metadata = { title: "Usuários — Admin" };

const ROLE_LABELS: Record<UserRole, string> = {
  ATHLETE: "Atleta",
  ORGANIZER: "Organizador",
  ADMIN: "Admin",
  SUPPORT: "Suporte",
  PARTNER: "Parceiro",
};

const ROLE_COLOR: Record<UserRole, string> = {
  ATHLETE:   BADGE.gray,
  ORGANIZER: BADGE.blue,
  ADMIN:     BADGE.red,
  SUPPORT:   BADGE.yellow,
  PARTNER:   BADGE.purple,
};

export default async function AdminUsuariosPage() {
  await requireAdmin();

  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
      _count: { select: { registrations: true, orders: true } },
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Usuários ({users.length})</h1>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b text-xs uppercase">
              <th className="pb-2 pr-4">Nome</th>
              <th className="pb-2 pr-4">Email</th>
              <th className="pb-2 pr-4">Perfil</th>
              <th className="pb-2 pr-4">Inscrições</th>
              <th className="pb-2 pr-4">Ativo</th>
              <th className="pb-2 pr-4">Cadastro</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="py-2 pr-4 font-medium">{u.name}</td>
                <td className="py-2 pr-4 text-gray-500 text-xs">{u.email}</td>
                <td className="py-2 pr-4">
                  <span className={`text-xs px-2 py-0.5 rounded ${ROLE_COLOR[u.role]}`}>{ROLE_LABELS[u.role]}</span>
                </td>
                <td className="py-2 pr-4 text-center">{u._count.registrations}</td>
                <td className="py-2 pr-4 text-center">{u.active ? "✅" : "❌"}</td>
                <td className="py-2 pr-4 text-gray-400 text-xs">{u.createdAt.toLocaleDateString("pt-BR")}</td>
                <td className="py-2">
                  <Link href={`/admin/usuarios/${u.id}`} className="text-xs text-primary-600 hover:underline">
                    Detalhes
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
