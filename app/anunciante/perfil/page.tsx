"use client";

import { useEffect, useState } from "react";

type AdvertiserProfileData = {
  companyName?: string;
  contactEmail?: string;
  contactPhone?: string;
};

export default function AdvertiserPerfilPage() {
  const [form, setForm] = useState<AdvertiserProfileData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/anunciante/profile")
      .then((r) => r.json())
      .then(({ profile }) => {
        if (profile) setForm(profile);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/anunciante/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const fieldMessage = Object.values(data.error?.fieldErrors ?? {}).flat()[0];
      setError((fieldMessage as string) ?? data.error ?? "Erro ao salvar dados.");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  function set(field: keyof AdvertiserProfileData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl space-y-6 mx-auto">
      <h1 className="text-2xl font-bold">Meus Dados</h1>

      <form onSubmit={handleSubmit} className="card space-y-4">
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Razão social *</label>
          <input
            type="text"
            value={form.companyName ?? ""}
            onChange={(e) => set("companyName", e.target.value)}
            className="input-field w-full"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">E-mail de contato *</label>
          <input
            type="email"
            value={form.contactEmail ?? ""}
            onChange={(e) => set("contactEmail", e.target.value)}
            className="input-field w-full"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone de contato *</label>
          <input
            type="tel"
            value={form.contactPhone ?? ""}
            onChange={(e) => set("contactPhone", e.target.value)}
            className="input-field w-full"
            placeholder="(11) 99999-9999"
            required
          />
        </div>
        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar dados"}
        </button>
      </form>
    </div>
  );
}
