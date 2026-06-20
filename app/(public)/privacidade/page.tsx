import type { Metadata } from "next";
import { getAppName, getLegalPrivacy } from "@/lib/settings";
import { DEFAULT_LEGAL_PRIVACY, LEGAL_CONTENT_UPDATED_AT } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Política de Privacidade" };
export const dynamic = "force-dynamic";

export default async function PrivacidadePage() {
  const [appName, { content, updatedAt }] = await Promise.all([
    getAppName(),
    getLegalPrivacy(),
  ]);

  const html = content || DEFAULT_LEGAL_PRIVACY;
  const date = updatedAt || LEGAL_CONTENT_UPDATED_AT;

  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold mb-2">Política de Privacidade</h1>
      <p className="text-sm text-gray-500 mb-8">Última atualização: {date} — {appName}</p>
      <div
        className="prose prose-gray max-w-none space-y-6 text-gray-700 dark:text-gray-300 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-gray-900 dark:[&_h2]:text-gray-100 [&_h2]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </main>
  );
}
