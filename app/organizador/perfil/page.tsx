"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import ChangePasswordForm from "@/components/profile/ChangePasswordForm";

type OrgProfileData = {
  companyName?: string | null;
  cnpj?: string | null;
  phone?: string | null;
  website?: string | null;
  bio?: string | null;
};

type AccountData = {
  name?: string;
  phone?: string | null;
  cpf?: string | null;
};

export default function OrganizerPerfilPage() {
  const { data: session } = useSession();
  const [orgForm, setOrgForm] = useState<OrgProfileData>({});
  const [accountForm, setAccountForm] = useState<AccountData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountSaved, setAccountSaved] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/organizer/profile").then((r) => r.json()),
      fetch("/api/organizer/account").then((r) => r.json()),
    ])
      .then(([{ profile }, { profile: account }]) => {
        if (profile) setOrgForm(profile);
        if (account) setAccountForm(account);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/organizer/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orgForm),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleAccountSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAccountSaving(true);
    setAccountError(null);
    try {
      const res = await fetch("/api/organizer/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: accountForm.name?.trim() ?? "",
          phone: accountForm.phone?.trim() || null,
          cpf: accountForm.cpf?.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        if (typeof data.error === "string") {
          setAccountError(data.error);
        } else {
          const fieldMessage = Object.values(data.error?.fieldErrors ?? {}).flat()[0];
          const formMessage = data.error?.formErrors?.[0];
          setAccountError((fieldMessage as string) ?? formMessage ?? "Erro ao salvar perfil.");
        }
        setAccountSaving(false);
        return;
      }
      setAccountSaved(true);
      setTimeout(() => setAccountSaved(false), 3000);
    } finally {
      setAccountSaving(false);
    }
  }

  function set(field: keyof OrgProfileData, value: string) {
    setOrgForm((prev) => ({ ...prev, [field]: value || null }));
  }

  function setAccount(field: keyof AccountData, value: string) {
    setAccountForm((prev) => ({ ...prev, [field]: value }));
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl space-y-6 mx-auto">
      <h1 className="text-2xl font-bold">Meus Dados</h1>

      <form onSubmit={handleAccountSubmit} className="card space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Dados pessoais</h2>
        {accountError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{accountError}</div>
        )}
        <p className="text-sm text-gray-600 dark:text-gray-400">{session?.user?.email}</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
            <input type="text" value={accountForm.name ?? ""} onChange={(e) => setAccount("name", e.target.value)} className="input w-full" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone pessoal</label>
            <input type="tel" value={accountForm.phone ?? ""} onChange={(e) => setAccount("phone", e.target.value)} className="input w-full" placeholder="(11) 99999-9999" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CPF</label>
            <input type="text" value={accountForm.cpf ?? ""} onChange={(e) => setAccount("cpf", e.target.value)} className="input w-full" placeholder="000.000.000-00" />
          </div>
        </div>
        <button type="submit" disabled={accountSaving} className="btn-primary w-full">
          {accountSaving ? "Salvando..." : accountSaved ? "Salvo!" : "Salvar dados pessoais"}
        </button>
      </form>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <h2 className="font-semibold text-gray-900">Dados da organização</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome da empresa / organização</label>
            <input type="text" value={orgForm.companyName ?? ""} onChange={(e) => set("companyName", e.target.value)} className="input w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CNPJ</label>
            <input type="text" value={orgForm.cnpj ?? ""} onChange={(e) => set("cnpj", e.target.value)} className="input w-full" placeholder="00.000.000/0000-00" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Telefone comercial</label>
            <input type="tel" value={orgForm.phone ?? ""} onChange={(e) => set("phone", e.target.value)} className="input w-full" placeholder="(11) 99999-9999" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Site</label>
            <input type="url" value={orgForm.website ?? ""} onChange={(e) => set("website", e.target.value)} className="input w-full" placeholder="https://..." />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Bio / Apresentação</label>
            <textarea rows={4} value={orgForm.bio ?? ""} onChange={(e) => set("bio", e.target.value)} className="input w-full resize-none" placeholder="Conte sobre sua organização..." />
          </div>
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar perfil"}
        </button>
      </form>

      <ChangePasswordForm />
    </div>
  );
}
