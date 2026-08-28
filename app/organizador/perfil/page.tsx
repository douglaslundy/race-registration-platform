import { requireRole } from "@/lib/auth/rbac";
import PerfilClient from "./PerfilClient";

export default async function Page() {
  // Perfil do organizador (dados da empresa, resumo diário) — só titular.
  await requireRole(["ORGANIZER", "ADMIN"]);
  return <PerfilClient />;
}
