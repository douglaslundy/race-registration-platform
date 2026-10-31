import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { organizerNavItems } from "@/lib/auth/organizer-access";
import { adminAssistantItems } from "@/lib/auth/admin-access";
import { getAppName } from "@/lib/settings";
import { getMissingAthleteProfileFields } from "@/lib/auth/profile-completion";
import { getProfileItems } from "@/lib/rating";
import DashboardNav from "@/components/dashboard/DashboardNav";
import PageViewLogger from "@/components/audit/PageViewLogger";
import ProfileCompletionNudge, { type PendingRatingItem } from "@/components/dashboard/ProfileCompletionNudge";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, appName] = await Promise.all([requireAuth(), getAppName()]);

  let pendingRating: PendingRatingItem[] = [];
  if (session.user.role === "ATHLETE") {
    const missing = await getMissingAthleteProfileFields(session.user.id);
    if (missing.length > 0) redirect("/completar-cadastro");
    // Só chega aqui quem já preencheu os obrigatórios: o modal convida a ganhar pontos pelo restante.
    pendingRating = (await getProfileItems(session.user.id, "ATHLETE")).filter((i) => !i.done);
  }

  // ASSISTANT não diz sozinho para onde vai — resolve o escopo pra oferecer o link certo da área
  // administrativa (era invisível pra ele, deixando quem só entrega kit sem caminho até a página).
  let staffArea: string | null = null;
  let staffLabel: string | undefined;
  if (session.user.role === "ADMIN") staffArea = "/admin";
  else if (session.user.role === "ORGANIZER") staffArea = "/organizador";
  else if (session.user.role === "ASSISTANT") {
    // Assistente vê só o atalho da 1ª função que ele de fato tem (ex.: "Entrega de kits"), nunca "Admin".
    const first = (await organizerNavItems(session))[0] ?? (await adminAssistantItems(session))[0];
    staffArea = first?.href ?? null;
    staffLabel = first?.label;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <PageViewLogger />
      <DashboardNav userName={session.user.name} userRole={session.user.role} appName={appName} staffArea={staffArea} staffLabel={staffLabel} />
      {pendingRating.length > 0 && <ProfileCompletionNudge pending={pendingRating} />}
      <div className="max-w-5xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
