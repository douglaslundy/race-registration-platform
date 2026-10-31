import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOrganizer } from "@/lib/auth/rbac";
import { resolveOrganizerAccess, organizerNavItems } from "@/lib/auth/organizer-access";
import { db } from "@/lib/db";
import { getAppName } from "@/lib/settings";
import OrganizerNav from "@/components/organizer/OrganizerNav";
import PageViewLogger from "@/components/audit/PageViewLogger";

export default async function OrganizerLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOrganizer();
  const pathname = (await headers()).get("x-pathname") ?? "";
  const [appName, allowed, navItems] = await Promise.all([
    getAppName(),
    resolveOrganizerAccess(session, pathname),
    organizerNavItems(session),
  ]);
  if (!allowed) redirect("/acesso-negado");
  const rating =
    session.user.role === "ORGANIZER"
      ? await db.user.findUnique({ where: { id: session.user.id }, select: { ratingPoints: true } })
      : null;
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <PageViewLogger />
      <OrganizerNav userName={session.user.name} appName={appName} items={navItems} ratingPoints={rating?.ratingPoints ?? null} />
      <div className="max-w-7xl mx-auto px-4 py-8 print:max-w-none print:p-0">{children}</div>
    </div>
  );
}
