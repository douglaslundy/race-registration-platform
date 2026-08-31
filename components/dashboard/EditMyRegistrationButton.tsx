"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ErrorModal from "@/components/ui/ErrorModal";

const GENDERS = [
  { value: "M", label: "Masculino" },
  { value: "F", label: "Feminino" },
  { value: "NB", label: "Não-binário" },
  { value: "OTHER", label: "Prefiro não informar" },
];

const SHIRT_SIZES = ["PP", "P", "M", "G", "GG", "XGG"] as const;

interface EditMyRegistrationButtonProps {
  registrationId: string;
  deadline: string | null;
  canEdit: boolean;
  participantName: string;
  participantPhone: string | null;
  participantBirthDate: string | null;
  participantGender: string | null;
  shirtSize: string | null;
  teamName: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

interface FormState {
  name: string;
  phone: string;
  birthDate: string;
  gender: string;
  shirtSize: string;
  teamName: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
}

function toDateInputValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().split("T")[0];
}

export default function EditMyRegistrationButton({
  registrationId,
  deadline,
  canEdit,
  participantName,
  participantPhone,
  participantBirthDate,
  participantGender,
  shirtSize,
  teamName,
  emergencyContactName,
  emergencyContactPhone,
}: EditMyRegistrationButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const initialForm: FormState = {
    name: participantName ?? "",
    phone: participantPhone ?? "",
    birthDate: toDateInputValue(participantBirthDate),
    gender: participantGender ?? "",
    shirtSize: shirtSize ?? "",
    teamName: teamName ?? "",
    emergencyContactName: emergencyContactName ?? "",
    emergencyContactPhone: emergencyContactPhone ?? "",
  };

  const [form, setForm] = useState<FormState>(initialForm);

  if (!canEdit || !deadline || new Date(deadline) <= new Date()) return null;

  function openModal() {
    setForm(initialForm);
    setInlineError(null);
    setOpen(true);
  }

  function setField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setInlineError(null);

    const body: Record<string, string | null> = {};

    const trimmedName = form.name.trim();
    if (trimmedName !== (participantName ?? "").trim()) {
      if (!trimmedName) {
        setInlineError("O nome não pode ficar em branco.");
        return;
      }
      body.name = trimmedName;
    }

    const optional: {
      key: keyof FormState;
      apiKey: string;
      initial: string;
    }[] = [
      { key: "phone", apiKey: "phone", initial: initialForm.phone },
      { key: "gender", apiKey: "gender", initial: initialForm.gender },
      { key: "shirtSize", apiKey: "shirtSize", initial: initialForm.shirtSize },
      { key: "teamName", apiKey: "teamName", initial: initialForm.teamName },
      { key: "emergencyContactName", apiKey: "emergencyContactName", initial: initialForm.emergencyContactName },
      { key: "emergencyContactPhone", apiKey: "emergencyContactPhone", initial: initialForm.emergencyContactPhone },
    ];

    for (const { key, apiKey, initial } of optional) {
      const current = form[key].trim();
      if (current !== initial.trim()) {
        body[apiKey] = current === "" ? null : current;
      }
    }

    if (form.birthDate !== initialForm.birthDate) {
      body.birthDate = form.birthDate || null;
    }

    if (Object.keys(body).length === 0) {
      setInlineError("Nenhuma alteração para salvar.");
      return;
    }

    setSaving(true);
    const res = await fetch(`/api/athlete/registrations/${registrationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao salvar os dados da inscrição.");
      return;
    }

    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={openModal} className="flex-1 btn-secondary text-sm">
        Editar meus dados da inscrição
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Editar meus dados da inscrição
            </h2>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Corrige apenas os dados do participante desta inscrição, enquanto o prazo de edição do evento
              estiver aberto.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Nome</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Telefone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                  placeholder="(11) 99999-9999"
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Nascimento</label>
                <input
                  type="date"
                  value={form.birthDate}
                  onChange={(e) => setField("birthDate", e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Gênero</label>
                <select
                  value={form.gender}
                  onChange={(e) => setField("gender", e.target.value)}
                  className="input-field"
                >
                  <option value="">Selecione</option>
                  {GENDERS.map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Camiseta</label>
                <select
                  value={form.shirtSize}
                  onChange={(e) => setField("shirtSize", e.target.value)}
                  className="input-field"
                >
                  <option value="">Selecione</option>
                  {SHIRT_SIZES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Equipe</label>
                <input
                  type="text"
                  value={form.teamName}
                  onChange={(e) => setField("teamName", e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Contato de emergência</label>
                <input
                  type="text"
                  value={form.emergencyContactName}
                  onChange={(e) => setField("emergencyContactName", e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Telefone de emergência</label>
                <input
                  type="tel"
                  value={form.emergencyContactPhone}
                  onChange={(e) => setField("emergencyContactPhone", e.target.value)}
                  placeholder="(11) 99999-9999"
                  className="input-field"
                />
              </div>
            </div>

            {inlineError && (
              <div className="mt-3 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm dark:bg-red-900/20 dark:border-red-900 dark:text-red-400">
                {inlineError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button type="button" onClick={handleSave} disabled={saving} className="btn-primary text-sm">
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
