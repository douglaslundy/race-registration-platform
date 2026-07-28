"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function EditPrivateAdLinkForm({ id, currentUrl }: { id: string; currentUrl: string }) {
  const router = useRouter();
  const [targetUrl, setTargetUrl] = useState(currentUrl);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const domain = (() => {
    try {
      return new URL(targetUrl).hostname;
    } catch {
      return null;
    }
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch(`/api/admin/ads/private/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUrl }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao editar link");
      setSaving(false);
      return;
    }
    setSaved(true);
    setSaving(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <input
        type="url"
        value={targetUrl}
        onChange={(e) => setTargetUrl(e.target.value)}
        className="input-field w-full text-sm"
      />
      {domain && <p className="text-xs text-gray-500 dark:text-gray-400">Domínio: {domain}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {saved && <p className="text-xs text-green-600">Link atualizado!</p>}
      <button type="submit" disabled={saving} className="btn-secondary text-xs py-1 px-3 disabled:opacity-50">
        {saving ? "Salvando..." : "Salvar link"}
      </button>
    </form>
  );
}
