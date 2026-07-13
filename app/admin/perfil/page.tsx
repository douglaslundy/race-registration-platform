"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import ChangePasswordForm from "@/components/profile/ChangePasswordForm";

type ProfileData = {
  name?: string;
  phone?: string | null;
  cpf?: string | null;
  dailySummaryEmailEnabled?: boolean;
  dailySummaryWhatsappEnabled?: boolean;
};

export default function AdminPerfilPage() {
  const { data: session } = useSession();
  const [form, setForm] = useState<ProfileData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/profile")
      .then((res) => {
        if (!res.ok) throw new Error("Erro ao carregar perfil");
        return res.json();
      })
      .then(({ profile }) => { if (profile) setForm(profile); })
      .catch(() => setLoadError("Erro ao carregar perfil."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name?.trim() ?? "",
          phone: form.phone?.trim() || null,
          cpf: form.cpf?.trim() || null,
          dailySummaryEmailEnabled: form.dailySummaryEmailEnabled ?? true,
          dailySummaryWhatsappEnabled: form.dailySummaryWhatsappEnabled ?? true,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        if (typeof data.error === "string") {
          setSaveError(data.error);
        } else {
          const fieldMessage = Object.values(data.error?.fieldErrors ?? {}).flat()[0];
          const formMessage = data.error?.formErrors?.[0];
          setSaveError((fieldMessage as string) ?? formMessage ?? "Erro ao salvar perfil.");
        }
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
  if (loadError) return <div className="text-sm text-red-600">{loadError}</div>;

  return (
    <div className="max-w-2xl space-y-6 mx-auto">
      <h1 className="text-2xl font-bold">Meus Dados</h1>

      <div className="card">
        <p className="text-sm text-gray-600 dark:text-gray-400">{session?.user?.email}</p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Dados pessoais</h2>
        {saveError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{saveError}</div>
        )}
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

        <div className="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Notificações</h3>
          <p className="text-xs text-gray-500">Resumo diário de atividade da plataforma, enviado toda manhã.</p>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.dailySummaryEmailEnabled ?? true}
              onChange={(e) => setForm((prev) => ({ ...prev, dailySummaryEmailEnabled: e.target.checked }))}
            />
            Receber resumo diário por e-mail
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.dailySummaryWhatsappEnabled ?? true}
              onChange={(e) => setForm((prev) => ({ ...prev, dailySummaryWhatsappEnabled: e.target.checked }))}
            />
            Receber resumo diário por WhatsApp
          </label>
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar"}
        </button>
      </form>

      <ChangePasswordForm />
    </div>
  );
}
