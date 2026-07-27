"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  defaultTitle: string;
  defaultDescription: string;
  defaultOgImage: string;
  brandContext: string;
  googleSiteVerification: string;
  googleAnalyticsId: string;
}

async function saveSetting(key: string, value: string) {
  const res = await fetch("/api/admin/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
}

export default function SeoSettingsForm({
  defaultTitle,
  defaultDescription,
  defaultOgImage,
  brandContext,
  googleSiteVerification,
  googleAnalyticsId,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);
  const [ogImage, setOgImage] = useState(defaultOgImage);
  const [context, setContext] = useState(brandContext);
  const [siteVerification, setSiteVerification] = useState(googleSiteVerification);
  const [analyticsId, setAnalyticsId] = useState(googleAnalyticsId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await Promise.all([
        saveSetting("seo_default_title", title),
        saveSetting("seo_default_description", description),
        saveSetting("seo_default_og_image", ogImage),
        saveSetting("seo_brand_context", context),
        saveSetting("seo_google_site_verification", siteVerification),
        saveSetting("seo_google_analytics_id", analyticsId),
      ]);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar configurações de SEO");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {saved && (
        <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded px-3 py-2">
          Configurações de SEO salvas com sucesso!
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Título padrão do site</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={70} className="input-field w-full" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição padrão do site</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={160} rows={3} className="input-field w-full" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Imagem padrão de compartilhamento (URL)</label>
        <input value={ogImage} onChange={(e) => setOgImage(e.target.value)} className="input-field w-full" placeholder="https://..." />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Objetivo/posicionamento do site</label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
          Contexto de marca usado como fallback e injetado nos prompts de geração por IA.
        </p>
        <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={3} className="input-field w-full" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Verificação Google Search Console</label>
          <input value={siteVerification} onChange={(e) => setSiteVerification(e.target.value)} className="input-field w-full" placeholder="Código de verificação" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Google Analytics (GA4)</label>
          <input value={analyticsId} onChange={(e) => setAnalyticsId(e.target.value)} className="input-field w-full" placeholder="G-XXXXXXX" />
        </div>
      </div>

      <button type="submit" disabled={saving} className="btn-primary px-6 disabled:opacity-50">
        {saving ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}
