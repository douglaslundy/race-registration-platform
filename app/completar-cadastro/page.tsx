import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { requireAuth } from "@/lib/auth/rbac";
import { getMissingAthleteProfileFields } from "@/lib/auth/profile-completion";
import CompletarCadastroForm from "./CompletarCadastroForm";

const ROLE_HOME: Record<UserRole, string> = {
  ATHLETE: "/dashboard",
  ORGANIZER: "/organizador",
  ADMIN: "/admin",
  SUPPORT: "/admin",
  PARTNER: "/dashboard",
  ASSISTANT: "/dashboard",
};

export default async function CompletarCadastroPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await requireAuth();
  const { callbackUrl } = await searchParams;

  if (session.user.role !== "ATHLETE") {
    redirect(ROLE_HOME[session.user.role as UserRole] ?? "/dashboard");
  }

  const missing = await getMissingAthleteProfileFields(session.user.id);
  if (missing.length === 0) {
    redirect(callbackUrl || "/dashboard");
  }

  return (
    <div className="card space-y-4">
      <h1 className="text-xl font-bold">Complete seu cadastro</h1>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Para continuar usando a plataforma, precisamos que você complete os dados obrigatórios abaixo.
      </p>
      <CompletarCadastroForm missingFields={missing} callbackUrl={callbackUrl} />
    </div>
  );
}
