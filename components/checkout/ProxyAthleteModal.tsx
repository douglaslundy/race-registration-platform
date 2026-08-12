"use client";

import { useState } from "react";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";

export interface ProxyAthleteData {
  name: string;
  birthDate: string;
  cpf: string;
  phone: string;
  email?: string;
  routeId?: string;
  categoryId?: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  shirtSize?: string;
  teamName?: string;
  medicalNotes?: string;
}

export default function ProxyAthleteModal({
  open,
  routes,
  categories,
  allowedShirtSizes,
  onSave,
  onCancel,
}: {
  open: boolean;
  routes: { id: string; name: string; distanceKm: number }[];
  categories: { id: string; name: string }[];
  allowedShirtSizes: string[];
  onSave: (data: ProxyAthleteData) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Partial<ProxyAthleteData>>({});
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function set<K extends keyof ProxyAthleteData>(field: K, value: ProxyAthleteData[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSave() {
    setError(null);
    if (!form.name || form.name.trim().length < 2) return setError("Informe o nome do atleta.");
    if (!form.birthDate) return setError("Informe a data de nascimento.");
    if (!form.cpf || !isValidCpf(form.cpf)) return setError("Informe um CPF válido.");
    if (!form.phone || form.phone.replace(/\D/g, "").length < 10) return setError("Informe um telefone válido.");
    if (routes.length > 0 && !form.routeId) return setError("Selecione um percurso.");
    if (categories.length > 0 && !form.categoryId) return setError("Selecione uma categoria.");
    if (!form.emergencyContactName) return setError("Informe o contato de emergência.");
    if (!form.emergencyContactPhone) return setError("Informe o telefone de emergência.");

    onSave({
      name: form.name.trim(),
      birthDate: form.birthDate,
      cpf: normalizeCpf(form.cpf),
      phone: form.phone,
      email: form.email?.trim() || undefined,
      routeId: form.routeId,
      categoryId: form.categoryId,
      emergencyContactName: form.emergencyContactName,
      emergencyContactPhone: form.emergencyContactPhone,
      shirtSize: form.shirtSize,
      teamName: form.teamName,
      medicalNotes: form.medicalNotes,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm overflow-y-auto py-8"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-lg mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Dados do atleta</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome completo *</label>
            <input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data de nascimento *</label>
            <input type="date" value={form.birthDate ?? ""} onChange={(e) => set("birthDate", e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CPF *</label>
            <input value={form.cpf ?? ""} onChange={(e) => set("cpf", e.target.value)} placeholder="000.000.000-00" maxLength={14} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone *</label>
            <input type="tel" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="(11) 99999-9999" className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">E-mail</label>
            <input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} placeholder="Opcional" className="input-field" />
          </div>

          {routes.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Percurso *</label>
              <select value={form.routeId ?? ""} onChange={(e) => set("routeId", e.target.value)} className="input-field">
                <option value="">Selecione</option>
                {routes.map((r) => <option key={r.id} value={r.id}>{r.name} — {r.distanceKm}km</option>)}
              </select>
            </div>
          )}
          {categories.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria *</label>
              <select value={form.categoryId ?? ""} onChange={(e) => set("categoryId", e.target.value)} className="input-field">
                <option value="">Selecione</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome do contato de emergência *</label>
            <input value={form.emergencyContactName ?? ""} onChange={(e) => set("emergencyContactName", e.target.value)} placeholder="Nome" className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone emergência *</label>
            <input value={form.emergencyContactPhone ?? ""} onChange={(e) => set("emergencyContactPhone", e.target.value)} placeholder="(11) 99999-9999" className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Camiseta</label>
            <select value={form.shirtSize ?? ""} onChange={(e) => set("shirtSize", e.target.value)} className="input-field">
              <option value="">Selecione</option>
              {allowedShirtSizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Equipe / Assessoria</label>
            <input value={form.teamName ?? ""} onChange={(e) => set("teamName", e.target.value)} placeholder="Opcional" className="input-field" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Informações médicas</label>
            <textarea value={form.medicalNotes ?? ""} onChange={(e) => set("medicalNotes", e.target.value)} className="input-field" rows={2} placeholder="Alergias, condições médicas..." />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancelar
          </button>
          <button type="button" onClick={handleSave} className="btn-primary text-sm">
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
