import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { getAppName } from "@/lib/settings";
import {
  getMissingAthleteProfileFields,
  getSuggestedAthleteProfileFields,
  type SuggestedAthleteField,
} from "@/lib/auth/profile-completion";
import DashboardNav from "@/components/dashboard/DashboardNav";
import PageViewLogger from "@/components/audit/PageViewLogger";
import ProfileCompletionNudge from "@/components/dashboard/ProfileCompletionNudge";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, appName] = await Promise.all([requireAuth(), getAppName()]);

  let suggestedFields: SuggestedAthleteField[] = [];
  if (session.user.role === "ATHLETE") {
    const missing = await getMissingAthleteProfileFields(session.user.id);
    if (missing.length > 0) redirect("/completar-cadastro");
    suggestedFields = await getSuggestedAthleteProfileFields(session.user.id);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <PageViewLogger />
      <DashboardNav userName={session.user.name} userRole={session.user.role} appName={appName} />
      {suggestedFields.length > 0 && <ProfileCompletionNudge suggestedFields={suggestedFields} />}
      <div className="max-w-5xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
