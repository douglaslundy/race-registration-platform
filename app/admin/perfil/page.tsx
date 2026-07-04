"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import ChangePasswordForm from "@/components/profile/ChangePasswordForm";

type ProfileData = {
  name?: string;
  phone?: string | null;
  cpf?: string | null;
};

export default function AdminPerfilPage() {
  const { data: session } = useSession();
  const [form, setForm] = useState<ProfileData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/profile")
      .then((res) => {
        if (!res.ok) throw new Error("Erro ao carregar perfil");
        return res.json();
      })
      .then(({ profile }) => { if (profile) setForm(profile); })
      .catch(() => setError("Erro ao carregar perfil."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name?.trim() ?? "",
          phone: form.phone?.trim() || null,
          cpf: form.cpf?.trim() || null,
        }),
      });
      if (!res.ok) {
        setError("Erro ao salvar perfil.");
        setSaving(false);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  function set(field: keyof ProfileData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;

  return (
    <div className="max-w-2xl space-y-6 mx-auto">
      <h1 className="text-2xl font-bold">Meus Dados</h1>

      <div className="card">
        <p className="text-sm text-gray-600 dark:text-gray-400">{session?.user?.email}</p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Dados pessoais</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
          <input
            type="text"
            value={form.name ?? ""}
            onChange={(e) => set("name", e.target.value)}
            className="input-field w-full"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone (WhatsApp)</label>
          <input
            type="tel"
            value={form.phone ?? ""}
            onChange={(e) => set("phone", e.target.value)}
            className="input-field w-full"
            placeholder="(11) 99999-9999"
          />
          <p className="text-xs text-gray-500 mt-1">Usado para receber alertas de conciliação de pagamentos por WhatsApp.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CPF</label>
          <input
            type="text"
            value={form.cpf ?? ""}
            onChange={(e) => set("cpf", e.target.value)}
            className="input-field w-full"
            placeholder="000.000.000-00"
          />
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar"}
        </button>
      </form>

      <ChangePasswordForm />
    </div>
  );
}
