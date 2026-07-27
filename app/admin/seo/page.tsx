import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/rbac";
import { getSetting } from "@/lib/settings";
import SeoSettingsForm from "@/components/admin/SeoSettingsForm";

export const metadata: Metadata = { title: "SEO — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminSeoPage() {
  await requireAdmin();

  const [defaultTitle, defaultDescription, defaultOgImage, brandContext, googleSiteVerification, googleAnalyticsId] =
    await Promise.all([
      getSetting("seo_default_title"),
      getSetting("seo_default_description"),
      getSetting("seo_default_og_image"),
      getSetting("seo_brand_context"),
      getSetting("seo_google_site_verification"),
      getSetting("seo_google_analytics_id"),
    ]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">SEO</h1>
      <div className="card">
        <SeoSettingsForm
          defaultTitle={defaultTitle ?? ""}
          defaultDescription={defaultDescription ?? ""}
          defaultOgImage={defaultOgImage ?? ""}
          brandContext={brandContext ?? ""}
          googleSiteVerification={googleSiteVerification ?? ""}
          googleAnalyticsId={googleAnalyticsId ?? ""}
        />
      </div>
    </div>
  );
}
