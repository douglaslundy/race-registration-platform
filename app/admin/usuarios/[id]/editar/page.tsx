import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import UserForm from "@/components/admin/UserForm";

export const metadata: Metadata = { title: "Editar Usuário — Admin" };

export default async function EditAdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, active: true },
  });

  if (!user) notFound();

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/admin/usuarios" className="hover:text-primary-600">
          ← Usuários
        </Link>
        <span>•</span>
        <Link href={`/admin/usuarios/${user.id}`} className="hover:text-primary-600">
          Detalhes
        </Link>
      </div>

      <div className="card space-y-2">
        <h1 className="text-xl font-bold">Editar usuário</h1>
        <p className="text-sm text-gray-500">Atualize nome, e-mail, perfil, status e senha de acesso.</p>
      </div>

      <UserForm
        mode="edit"
        initialUser={user}
        successRedirect={`/admin/usuarios/${user.id}`}
      />
    </div>
  );
}
