import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/rbac";
import UserForm from "@/components/admin/UserForm";

export const metadata: Metadata = { title: "Novo Usuário — Admin" };

export default async function NewAdminUserPage() {
  await requireAdmin();

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/admin/usuarios" className="hover:text-primary-600">
          ← Usuários
        </Link>
      </div>

      <div className="card space-y-2">
        <h1 className="text-xl font-bold">Cadastrar usuário</h1>
        <p className="text-sm text-gray-500">Crie credenciais para um novo usuário administrativo, organizador ou atleta.</p>
      </div>

      <UserForm mode="create" successRedirect="/admin/usuarios" />
    </div>
  );
}
