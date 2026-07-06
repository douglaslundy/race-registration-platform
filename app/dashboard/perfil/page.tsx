"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

const SHIRT_SIZES = ["PP", "P", "M", "G", "GG", "XGG"] as const;
const GENDERS = [
  { value: "M", label: "Masculino" },
  { value: "F", label: "Feminino" },
  { value: "NB", label: "Não-binário" },
  { value: "OTHER", label: "Prefiro não informar" },
];

type ProfileData = {
  birthDate?: string | null;
  cpf?: string | null;
  phone?: string | null;
  gender?: string | null;
  city?: string | null;
  state?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  medicalNotes?: string | null;
  preferredShirtSize?: string | null;
  teamName?: string | null;
};

export default function PerfilPage() {
  const { data: session } = useSession();
  const [form, setForm] = useState<ProfileData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/athlete/profile")
      .then((r) => r.json())
      .then(({ profile }) => {
        if (profile) {
          setForm({
            ...profile,
            birthDate: profile.birthDate ? new Date(profile.birthDate).toISOString().split("T")[0] : "",
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/athlete/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (pwForm.next !== pwForm.confirm) {
      setPwError("A nova senha e a confirmação não coincidem.");
      return;
    }
    if (pwForm.next.length < 8) {
      setPwError("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }
    setPwSaving(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
    });
    const data = await res.json();
    setPwSaving(false);
    if (!res.ok) {
      setPwError(data.error ?? "Erro ao alterar senha.");
    } else {
      setPwSuccess(true);
      setPwForm({ current: "", next: "", confirm: "" });
      setTimeout(() => setPwSuccess(false), 4000);
    }
  }

  function set(field: keyof ProfileData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value || null }));
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Meus Dados</h1>

      <div className="card">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Dados da conta</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">{session?.user?.name} · {session?.user?.email}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Dados pessoais</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data de nascimento *</label>
              <input type="date" value={form.birthDate ?? ""} onChange={(e) => set("birthDate", e.target.value)}
                className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                CPF {!form.cpf && "*"}
              </label>
              <input
                type="text"
                value={form.cpf ?? ""}
                onChange={(e) => set("cpf", e.target.value)}
                placeholder="000.000.000-00"
                maxLength={14}
                disabled={Boolean(form.cpf)}
                className="input w-full disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed disabled:text-gray-500"
              />
              {form.cpf && (
                <p className="text-xs text-gray-500 mt-1">
                  CPF confirmado não pode ser alterado. Em caso de erro, contate o suporte.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Gênero</label>
              <select value={form.gender ?? ""} onChange={(e) => set("gender", e.target.value)} className="input w-full">
                <option value="">Selecione</option>
                {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone / WhatsApp</label>
              <input type="tel" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)}
                placeholder="(11) 99999-9999" className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cidade</label>
              <input type="text" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)}
                className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Estado (UF)</label>
              <input type="text" maxLength={2} value={form.state ?? ""} onChange={(e) => set("state", e.target.value.toUpperCase())}
                placeholder="SP" className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Equipe / Clube</label>
              <input type="text" value={form.teamName ?? ""} onChange={(e) => set("teamName", e.target.value)}
                className="input w-full" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tamanho de camiseta preferido</label>
            <div className="flex gap-2 flex-wrap">
              {SHIRT_SIZES.map((s) => (
                <button key={s} type="button"
                  onClick={() => set("preferredShirtSize", s)}
                  className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                    form.preferredShirtSize === s
                      ? "bg-primary-600 text-white border-primary-600"
                      : "border-gray-300 dark:border-gray-600 hover:border-primary-400"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Contato de emergência</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
              <input type="text" value={form.emergencyName ?? ""} onChange={(e) => set("emergencyName", e.target.value)}
                className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone</label>
              <input type="tel" value={form.emergencyPhone ?? ""} onChange={(e) => set("emergencyPhone", e.target.value)}
                placeholder="(11) 99999-9999" className="input w-full" />
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Informações médicas</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Estas informações são confidenciais e visíveis apenas para você e organizadores do evento em caso de emergência.</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Condições médicas, alergias, medicamentos</label>
            <textarea rows={4} value={form.medicalNotes ?? ""} onChange={(e) => set("medicalNotes", e.target.value)}
              placeholder="Ex: hipertensão controlada, alergia a dipirona..." className="input w-full resize-none" />
          </div>
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "Salvando..." : saved ? "Salvo com sucesso!" : "Salvar dados"}
        </button>
      </form>

      <form onSubmit={handlePasswordChange} className="card space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Alterar senha</h2>
        {pwError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{pwError}</div>
        )}
        {pwSuccess && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">Senha alterada com sucesso!</div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Senha atual</label>
          <input
            type="password"
            value={pwForm.current}
            onChange={(e) => setPwForm((p) => ({ ...p, current: e.target.value }))}
            className="input w-full"
            required
            autoComplete="current-password"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nova senha</label>
          <input
            type="password"
            value={pwForm.next}
            onChange={(e) => setPwForm((p) => ({ ...p, next: e.target.value }))}
            className="input w-full"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirmar nova senha</label>
          <input
            type="password"
            value={pwForm.confirm}
            onChange={(e) => setPwForm((p) => ({ ...p, confirm: e.target.value }))}
            className="input w-full"
            required
            autoComplete="new-password"
          />
        </div>
        <button type="submit" disabled={pwSaving} className="btn-primary w-full">
          {pwSaving ? "Alterando..." : "Alterar senha"}
        </button>
      </form>
    </div>
  );
}
