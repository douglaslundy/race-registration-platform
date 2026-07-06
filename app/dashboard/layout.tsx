import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { getAppName } from "@/lib/settings";
import { getMissingAthleteProfileFields } from "@/lib/auth/profile-completion";
import DashboardNav from "@/components/dashboard/DashboardNav";
import PageViewLogger from "@/components/audit/PageViewLogger";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, appName] = await Promise.all([requireAuth(), getAppName()]);

  if (session.user.role === "ATHLETE") {
    const missing = await getMissingAthleteProfileFields(session.user.id);
    if (missing.length > 0) redirect("/completar-cadastro");
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <PageViewLogger />
      <DashboardNav userName={session.user.name} userRole={session.user.role} appName={appName} />
      <div className="max-w-5xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
