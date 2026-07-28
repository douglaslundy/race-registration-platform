import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/rbac";
import { getSetting } from "@/lib/settings";
import SeoSettingsForm from "@/components/admin/SeoSettingsForm";
import AiProviderSettingsForm from "@/components/admin/AiProviderSettingsForm";

export const metadata: Metadata = { title: "SEO — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminSeoPage() {
  await requireAdmin();

  const [defaultTitle, defaultDescription, defaultOgImage, brandContext, googleSiteVerification, googleAnalyticsId, aiProvider, claudeKey, openaiKey, googleKey] =
    await Promise.all([
      getSetting("seo_default_title"),
      getSetting("seo_default_description"),
      getSetting("seo_default_og_image"),
      getSetting("seo_brand_context"),
      getSetting("seo_google_site_verification"),
      getSetting("seo_google_analytics_id"),
      getSetting("ai_provider"),
      getSetting("ai_claude_api_key"),
      getSetting("ai_openai_api_key"),
      getSetting("ai_google_api_key"),
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
      <div className="card">
        <h2 className="font-semibold mb-3">Geração por IA</h2>
        <AiProviderSettingsForm
          currentProvider={(aiProvider === "OPENAI" || aiProvider === "GOOGLE" ? aiProvider : "CLAUDE") as "CLAUDE" | "OPENAI" | "GOOGLE"}
          claudeConfigured={Boolean(claudeKey)}
          openaiConfigured={Boolean(openaiKey)}
          googleConfigured={Boolean(googleKey)}
        />
      </div>
    </div>
  );
}
