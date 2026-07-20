import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { getAppName } from "@/lib/settings";
import AdvertiserNav from "@/components/advertiser/AdvertiserNav";
import PageViewLogger from "@/components/audit/PageViewLogger";

export default async function AdvertiserLayout({ children }: { children: React.ReactNode }) {
  const [session, appName] = await Promise.all([requireAuth(), getAppName()]);

  if (session.user.role !== "ADVERTISER") {
    redirect("/acesso-negado");
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <PageViewLogger />
      <AdvertiserNav userName={session.user.name} appName={appName} />
      <div className="max-w-7xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
