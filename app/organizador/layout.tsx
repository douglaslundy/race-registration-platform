import { requireOrganizer } from "@/lib/auth/rbac";
import { getAppName } from "@/lib/settings";
import OrganizerNav from "@/components/organizer/OrganizerNav";
import PageViewLogger from "@/components/audit/PageViewLogger";

export default async function OrganizerLayout({ children }: { children: React.ReactNode }) {
  const [session, appName] = await Promise.all([requireOrganizer(), getAppName()]);
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <PageViewLogger />
      <OrganizerNav userName={session.user.name} appName={appName} />
      <div className="max-w-7xl mx-auto px-4 py-8 print:max-w-none print:p-0">{children}</div>
    </div>
  );
}
