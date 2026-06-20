"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

type ProfileData = {
  companyName?: string | null;
  cnpj?: string | null;
  phone?: string | null;
  website?: string | null;
  bio?: string | null;
};

export default function OrganizerPerfilPage() {
  const { data: session } = useSession();
  const [form, setForm] = useState<ProfileData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/organizer/profile")
      .then((r) => r.json())
      .then(({ profile }) => { if (profile) setForm(profile); })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/organizer/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  function set(field: keyof ProfileData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value || null }));
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl space-y-6 mx-auto">
      <h1 className="text-2xl font-bold">Perfil do Organizador</h1>

      <div className="card">
        <p className="text-sm text-gray-600">{session?.user?.name} · {session?.user?.email}</p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <h2 className="font-semibold text-gray-900">Dados da organização</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome da empresa / organização</label>
            <input type="text" value={form.companyName ?? ""} onChange={(e) => set("companyName", e.target.value)} className="input w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CNPJ</label>
            <input type="text" value={form.cnpj ?? ""} onChange={(e) => set("cnpj", e.target.value)} className="input w-full" placeholder="00.000.000/0000-00" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Telefone comercial</label>
            <input type="tel" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} className="input w-full" placeholder="(11) 99999-9999" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Site</label>
            <input type="url" value={form.website ?? ""} onChange={(e) => set("website", e.target.value)} className="input w-full" placeholder="https://..." />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Bio / Apresentação</label>
            <textarea rows={4} value={form.bio ?? ""} onChange={(e) => set("bio", e.target.value)} className="input w-full resize-none" placeholder="Conte sobre sua organização..." />
          </div>
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar perfil"}
        </button>
      </form>
    </div>
  );
}
