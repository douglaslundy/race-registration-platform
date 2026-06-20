"use client";

import { useState } from "react";

interface Props {
  type: "terms" | "privacy";
  label: string;
  initialContent: string;
  initialUpdatedAt: string;
}

export default function LegalContentForm({ type, label, initialContent, initialUpdatedAt }: Props) {
  const [content, setContent] = useState(initialContent);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/legal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, content, updatedAt }),
      });
      if (!res.ok) throw new Error("Erro ao salvar");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Erro ao salvar conteúdo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Data da última atualização
        </label>
        <input
          type="text"
          value={updatedAt}
          onChange={(e) => setUpdatedAt(e.target.value)}
          placeholder="ex: junho de 2025"
          className="input w-full max-w-xs text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Conteúdo HTML de {label}
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Use tags HTML padrão: &lt;h2&gt;, &lt;p&gt;, &lt;ul&gt;, &lt;li&gt;, &lt;strong&gt; etc. O conteúdo é renderizado diretamente na página pública.
        </p>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={24}
          className="input w-full font-mono text-xs"
          required
        />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="btn-primary text-sm disabled:opacity-50">
          {saving ? "Salvando…" : "Salvar"}
        </button>
        {saved && <span className="text-green-600 text-sm font-medium">Salvo com sucesso!</span>}
        {error && <span className="text-red-600 text-sm">{error}</span>}
      </div>
    </form>
  );
}
