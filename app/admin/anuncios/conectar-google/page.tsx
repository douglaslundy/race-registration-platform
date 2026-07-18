import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/rbac";
import { getSetting } from "@/lib/settings";
import GoogleAdsConnectionPanel from "@/components/admin/GoogleAdsConnectionPanel";

export const metadata: Metadata = { title: "Conectar Google AdSense — Admin" };
export const dynamic = "force-dynamic";

export default async function ConectarGooglePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const [accessToken, publisherId] = await Promise.all([
    getSetting("google_adsense_access_token"),
    getSetting("google_adsense_publisher_id"),
  ]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Conectar Google AdSense</h1>
      <div className="card">
        <GoogleAdsConnectionPanel
          connected={Boolean(accessToken)}
          publisherId={publisherId}
          hasError={params.error === "1"}
        />
      </div>
    </div>
  );
}
