"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isValidCpf } from "@/lib/cpf";
import type { MissingAthleteField } from "@/lib/auth/profile-completion";

export default function CompletarCadastroForm({
  missingFields,
  callbackUrl,
}: {
  missingFields: MissingAthleteField[];
  callbackUrl?: string;
}) {
  const router = useRouter();
  const [birthDate, setBirthDate] = useState("");
  const [cpf, setCpf] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const needsBirthDate = missingFields.includes("birthDate");
  const needsCpf = missingFields.includes("cpf");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (needsCpf && !isValidCpf(cpf)) {
      setError("Informe um CPF válido.");
      return;
    }

    setSaving(true);
    const body: Record<string, string> = {};
    if (needsBirthDate) body.birthDate = birthDate;
    if (needsCpf) body.cpf = cpf;

    const res = await fetch("/api/athlete/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao salvar os dados.");
      setSaving(false);
      return;
    }

    router.push(callbackUrl || "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {needsBirthDate && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Data de nascimento *
          </label>
          <input
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            required
            className="input-field"
          />
        </div>
      )}
      {needsCpf && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CPF *</label>
          <input
            type="text"
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            placeholder="000.000.000-00"
            maxLength={14}
            required
            className="input-field"
          />
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}
      <button type="submit" disabled={saving} className="btn-primary w-full">
        {saving ? "Salvando..." : "Salvar e continuar"}
      </button>
    </form>
  );
}
