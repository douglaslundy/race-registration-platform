"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isValidCpf } from "@/lib/cpf";
import { isValidCep, fetchAddressByCep } from "@/lib/cep";
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
  const [phone, setPhone] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [noNumber, setNoNumber] = useState(false);
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const needsBirthDate = missingFields.includes("birthDate");
  const needsCpf = missingFields.includes("cpf");
  const needsPhone = missingFields.includes("phone");
  const needsPostalCode = missingFields.includes("postalCode");
  const needsStreet = missingFields.includes("street");
  const needsNumber = missingFields.includes("number");
  const needsNeighborhood = missingFields.includes("neighborhood");
  const needsCity = missingFields.includes("city");
  const needsState = missingFields.includes("state");
  const needsAnyAddress =
    needsPostalCode || needsStreet || needsNumber || needsNeighborhood || needsCity || needsState;

  async function handlePostalCodeBlur() {
    const address = await fetchAddressByCep(postalCode);
    if (address) {
      setStreet(address.street);
      setNeighborhood(address.neighborhood);
      setCity(address.city);
      setState(address.state);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (needsCpf && !isValidCpf(cpf)) {
      setError("Informe um CPF válido.");
      return;
    }

    if (needsPhone && phone.replace(/\D/g, "").length < 10) {
      setError("Informe um telefone válido.");
      return;
    }

    if (needsPostalCode && !isValidCep(postalCode)) {
      setError("Informe um CEP válido.");
      return;
    }

    if (needsNumber && !noNumber && !number) {
      setError("Informe o número ou marque 'Sem número'.");
      return;
    }

    setSaving(true);
    const body: Record<string, string> = {};
    if (needsBirthDate) body.birthDate = birthDate;
    if (needsCpf) body.cpf = cpf;
    if (needsPhone) body.phone = phone;
    if (needsPostalCode) body.postalCode = postalCode;
    if (needsStreet) body.street = street;
    if (needsNumber) body.number = noNumber ? "S/N" : number;
    if (complement) body.complement = complement;
    if (needsNeighborhood) body.neighborhood = neighborhood;
    if (needsCity) body.city = city;
    if (needsState) body.state = state;

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
      {needsPhone && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Telefone / WhatsApp *
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(11) 99999-9999"
            required
            className="input-field"
          />
        </div>
      )}
      {needsPostalCode && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CEP *</label>
          <input
            type="text"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            onBlur={handlePostalCodeBlur}
            placeholder="00000-000"
            maxLength={9}
            required
            className="input-field"
          />
        </div>
      )}
      {needsStreet && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Rua/Logradouro *
          </label>
          <input
            type="text"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            required
            className="input-field"
          />
        </div>
      )}
      {needsNumber && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Número *</label>
          <input
            type="text"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            disabled={noNumber}
            className="input-field disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
          />
          <label className="flex items-center gap-2 mt-1 text-sm text-gray-600 dark:text-gray-400">
            <input type="checkbox" checked={noNumber} onChange={(e) => setNoNumber(e.target.checked)} />
            Sem número
          </label>
        </div>
      )}
      {needsAnyAddress && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Complemento</label>
          <input
            type="text"
            value={complement}
            onChange={(e) => setComplement(e.target.value)}
            className="input-field"
          />
        </div>
      )}
      {needsNeighborhood && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bairro *</label>
          <input
            type="text"
            value={neighborhood}
            onChange={(e) => setNeighborhood(e.target.value)}
            required
            className="input-field"
          />
        </div>
      )}
      {needsCity && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cidade *</label>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            required
            className="input-field"
          />
        </div>
      )}
      {needsState && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Estado (UF) *</label>
          <input
            type="text"
            maxLength={2}
            value={state}
            onChange={(e) => setState(e.target.value.toUpperCase())}
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
