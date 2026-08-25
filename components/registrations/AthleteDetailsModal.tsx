"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";
import { REGISTRATION_STATUS } from "@/lib/registration-status";

const GENDERS = [
  { value: "M", label: "Masculino" },
  { value: "F", label: "Feminino" },
  { value: "NB", label: "Não-binário" },
  { value: "OTHER", label: "Prefiro não informar" },
];

const SHIRT_SIZES = ["PP", "P", "M", "G", "GG", "XGG"] as const;

interface AthleteProfileData {
  cpf: string | null;
  birthDate: Date | string | null;
  phone: string | null;
  gender: string | null;
  city: string | null;
  state: string | null;
  teamName: string | null;
  preferredShirtSize: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface RegistrationContextData {
  status: string;
  createdAt: Date | string;
  routeName: string | null;
  categoryName: string | null;
  ticketBatchName: string;
  shirtSize: string | null;
  teamName: string | null;
  orderId: string;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  medicalNotes: string | null;
  notes: string | null;
}

interface AthleteDetailsModalProps {
  athleteName: string;
  athleteEmail: string;
  profile: AthleteProfileData | null;
  registrationContext?: RegistrationContextData;
  editEndpoint?: string;
  /** Presente sempre que o modal é aberto a partir de uma inscrição real (não usado em telas que
   * só mostram o perfil do atleta sem contexto de inscrição) — habilita o download do QR code. */
  registrationId?: string;
}

interface EditFormState {
  name: string;
  email: string;
  cpf: string;
  birthDate: string;
  phone: string;
  gender: string;
  city: string;
  state: string;
  teamName: string;
  preferredShirtSize: string;
}

function toDateInputValue(value: Date | string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().split("T")[0];
}

export default function AthleteDetailsModal({
  athleteName,
  athleteEmail,
  profile,
  registrationContext,
  editEndpoint,
  registrationId,
}: AthleteDetailsModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [form, setForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setForm({
      name: athleteName,
      email: athleteEmail,
      cpf: profile?.cpf ?? "",
      birthDate: toDateInputValue(profile?.birthDate ?? null),
      phone: profile?.phone ?? "",
      gender: profile?.gender ?? "",
      city: profile?.city ?? "",
      state: profile?.state ?? "",
      teamName: profile?.teamName ?? "",
      preferredShirtSize: profile?.preferredShirtSize ?? "",
    });
    setError(null);
    setMode("edit");
  }

  function cancelEdit() {
    setMode("view");
    setError(null);
  }

  function setField(field: keyof EditFormState, value: string) {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  async function handleSave() {
    if (!form || !editEndpoint) return;
    setError(null);

    if (form.cpf && !isValidCpf(form.cpf)) {
      setError("CPF inválido.");
      return;
    }

    setSaving(true);
    const res = await fetch(editEndpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        email: form.email,
        cpf: form.cpf ? normalizeCpf(form.cpf) : undefined,
        birthDate: form.birthDate || undefined,
        phone: form.phone || null,
        gender: form.gender || null,
        city: form.city || null,
        state: form.state || null,
        teamName: form.teamName || null,
        preferredShirtSize: form.preferredShirtSize || null,
      }),
    });
    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao salvar os dados.");
      return;
    }

    setMode("view");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-primary-600 hover:underline"
      >
        Ver dados do atleta
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {mode === "view" ? (
              <>
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{athleteName}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{athleteEmail}</p>

                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
                    Perfil do atleta
                  </h3>
                  {profile ? (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <dt className="text-xs text-gray-500">CPF</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.cpf ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Nascimento</dt>
                        <dd className="text-gray-800 dark:text-gray-200">
                          {profile.birthDate ? formatDate(profile.birthDate, "dd/MM/yyyy") : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Telefone</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.phone ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Gênero</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.gender ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Cidade</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.city ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Estado</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.state ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Equipe</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.teamName ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Camiseta preferida</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.preferredShirtSize ?? "—"}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Este atleta ainda não preencheu o perfil.
                    </p>
                  )}
                </div>

                {registrationContext && (
                  <div className="mt-4">
                    <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
                      Dados desta inscrição
                    </h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <dt className="text-xs text-gray-500">Status</dt>
                        <dd className="text-gray-800 dark:text-gray-200">
                          {REGISTRATION_STATUS[registrationContext.status]?.label ?? registrationContext.status}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Data da inscrição</dt>
                        <dd className="text-gray-800 dark:text-gray-200">
                          {formatDate(registrationContext.createdAt, "dd/MM/yyyy HH:mm")}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Percurso</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{registrationContext.routeName ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Categoria</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{registrationContext.categoryName ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Lote</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{registrationContext.ticketBatchName}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Camiseta</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{registrationContext.shirtSize ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Equipe</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{registrationContext.teamName ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Nº do pedido</dt>
                        <dd className="text-gray-800 dark:text-gray-200 font-mono">{registrationContext.orderId}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Contato de emergência</dt>
                        <dd className="text-gray-800 dark:text-gray-200">
                          {registrationContext.emergencyContactName ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Telefone de emergência</dt>
                        <dd className="text-gray-800 dark:text-gray-200">
                          {registrationContext.emergencyContactPhone ?? "—"}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-gray-500">Observações médicas</dt>
                        <dd className="text-gray-800 dark:text-gray-200">
                          {registrationContext.medicalNotes ?? "—"}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-gray-500">Observação</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{registrationContext.notes ?? "—"}</dd>
                      </div>
                    </dl>
                  </div>
                )}

                {registrationId && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <a
                      href={`/api/registrations/${registrationId}/qrcode?format=png`}
                      className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      Baixar QR Code — PNG
                    </a>
                    <a
                      href={`/api/registrations/${registrationId}/qrcode?format=pdf`}
                      className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      Baixar QR Code — PDF
                    </a>
                  </div>
                )}

                {profile && (
                  <p className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
                    Cadastrado em {formatDate(profile.createdAt, "dd/MM/yyyy HH:mm")} · Última atualização em{" "}
                    {formatDate(profile.updatedAt, "dd/MM/yyyy HH:mm")}
                  </p>
                )}

                <div className="mt-5 flex justify-end gap-2">
                  {editEndpoint && (
                    <button
                      type="button"
                      onClick={startEdit}
                      className="px-4 py-2 text-sm rounded-lg border border-primary-500 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                    >
                      Editar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    Fechar
                  </button>
                </div>
              </>
            ) : (
              form && (
                <>
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Editar dados do atleta</h2>

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
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">E-mail</label>
                      <input
                        type="email"
                        value={form.email}
                        onChange={(e) => setField("email", e.target.value)}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">CPF</label>
                      <input
                        type="text"
                        value={form.cpf}
                        onChange={(e) => setField("cpf", e.target.value)}
                        placeholder="000.000.000-00"
                        maxLength={14}
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
                      <label className="block text-xs text-gray-500 mb-1">Cidade</label>
                      <input
                        type="text"
                        value={form.city}
                        onChange={(e) => setField("city", e.target.value)}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Estado (UF)</label>
                      <input
                        type="text"
                        maxLength={2}
                        value={form.state}
                        onChange={(e) => setField("state", e.target.value.toUpperCase())}
                        placeholder="SP"
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Equipe</label>
                      <input
                        type="text"
                        value={form.teamName}
                        onChange={(e) => setField("teamName", e.target.value)}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Camiseta</label>
                      <select
                        value={form.preferredShirtSize}
                        onChange={(e) => setField("preferredShirtSize", e.target.value)}
                        className="input-field"
                      >
                        <option value="">Selecione</option>
                        {SHIRT_SIZES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {error && (
                    <div className="mt-3 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm dark:bg-red-900/20 dark:border-red-900 dark:text-red-400">
                      {error}
                    </div>
                  )}

                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={saving}
                      className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      className="btn-primary text-sm"
                    >
                      {saving ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                </>
              )
            )}
          </div>
        </div>
      )}
    </>
  );
}
