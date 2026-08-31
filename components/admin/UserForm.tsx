"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@prisma/client";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";
import { useSensitiveActionVerification } from "@/lib/hooks/use-sensitive-action-verification";

const ROLES: UserRole[] = ["ATHLETE", "ORGANIZER", "ADMIN", "SUPPORT", "PARTNER"];

const ROLE_LABELS: Record<UserRole, string> = {
  ATHLETE: "Atleta",
  ORGANIZER: "Organizador",
  ADMIN: "Admin",
  SUPPORT: "Suporte",
  PARTNER: "Parceiro",
  ASSISTANT: "Assistente",
  ADVERTISER: "Anunciante",
};

type Mode = "create" | "edit";

type InitialUser = {
  id?: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  athleteProfile?: { cpf: string | null; birthDate: Date | string | null } | null;
  organizerProfile?: { campaignsEnabled: boolean } | null;
};

export default function UserForm({
  mode,
  initialUser,
  successRedirect,
}: {
  mode: Mode;
  initialUser?: InitialUser;
  successRedirect: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialUser?.name ?? "");
  const [email, setEmail] = useState(initialUser?.email ?? "");
  const [role, setRole] = useState<UserRole>(initialUser?.role ?? "ATHLETE");
  const [active, setActive] = useState(initialUser?.active ?? true);
  const [cpf, setCpf] = useState(initialUser?.athleteProfile?.cpf ?? "");
  const [birthDate, setBirthDate] = useState(
    initialUser?.athleteProfile?.birthDate
      ? new Date(initialUser.athleteProfile.birthDate).toISOString().split("T")[0]
      : "",
  );
  const [campaignsEnabled, setCampaignsEnabled] = useState(
    initialUser?.organizerProfile?.campaignsEnabled ?? false,
  );
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = mode === "edit";

  const verification = useSensitiveActionVerification({
    requestCodeEndpoint: `/api/admin/users/${initialUser?.id}/request-code`,
    confirmEndpoint: `/api/admin/users/${initialUser?.id}`,
    confirmMethod: "PATCH",
  });

  function buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      name: name.trim(),
      email: email.trim(),
      role,
      active,
    };

    if (!isEdit || password.trim()) {
      payload.password = password.trim();
    }

    if (isEdit && role === "ATHLETE") {
      if (cpf.trim()) payload.cpf = cpf.trim();
      if (birthDate) payload.birthDate = birthDate;
    }

    if (isEdit && role === "ORGANIZER") {
      payload.campaignsEnabled = campaignsEnabled;
    }

    return payload;
  }

  // M1: mudança de perfil / status / senha num usuário existente exige 2FA.
  function securityFieldsChanged(): boolean {
    if (!isEdit || !initialUser) return false;
    return (
      role !== initialUser.role ||
      active !== initialUser.active ||
      password.trim().length > 0
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload = buildPayload();

    if (securityFieldsChanged()) {
      await verification.start();
      return;
    }

    setSaving(true);
    const res = await fetch(isEdit ? `/api/admin/users/${initialUser?.id}` : "/api/admin/users", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Erro ao salvar usuário");
      setSaving(false);
      return;
    }

    router.push(successRedirect);
    router.refresh();
  }

  async function handleSubmitCode(code: string) {
    const result = await verification.submitCode(code, buildPayload());
    if (result.ok) {
      router.push(successRedirect);
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nome</label>
          <input
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={100}
            placeholder="Nome do usuário"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">E-mail</label>
          <input
            type="email"
            className="input-field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="usuario@exemplo.com"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Perfil</label>
          <select className="input-field" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
          <label className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-3">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">{active ? "Usuário ativo" : "Usuário bloqueado"}</span>
          </label>
        </div>
      </div>

      {isEdit && role === "ATHLETE" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">CPF</label>
            <input
              className="input-field"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              placeholder="000.000.000-00"
              maxLength={14}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Data de nascimento</label>
            <input
              type="date"
              className="input-field"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
          </div>
        </div>
      )}

      {isEdit && role === "ORGANIZER" && (
        <div className="space-y-1">
          <label className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-3">
            <input
              type="checkbox"
              checked={campaignsEnabled}
              onChange={(e) => setCampaignsEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Habilitar campanhas de WhatsApp pra este organizador
            </span>
          </label>
        </div>
      )}

      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {isEdit ? "Nova senha" : "Senha inicial"}
        </label>
        <input
          type="password"
          className="input-field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required={!isEdit}
          minLength={isEdit ? 0 : 8}
          placeholder={isEdit ? "Deixe em branco para manter a atual" : "Mínimo 8 caracteres"}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {isEdit ? "Preencha apenas se quiser redefinir a senha." : "A senha é obrigatória para criar o acesso."}
        </p>
      </div>

      {(error || (verification.step === "idle" && verification.error)) && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error ?? verification.error}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          className="btn-primary"
          disabled={saving || verification.step === "requesting" || verification.step === "submitting"}
        >
          {saving ? "Salvando..." : isEdit ? "Salvar alterações" : "Criar usuário"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          onClick={() => router.back()}
        >
          Cancelar
        </button>
      </div>

      <CodeVerificationModal
        open={verification.step === "code" || verification.step === "submitting"}
        title="Confirmar alteração de acesso do usuário"
        expiresAt={verification.expiresAt}
        error={verification.step !== "idle" ? verification.error : null}
        attemptsRemaining={verification.attemptsRemaining}
        loading={verification.step === "submitting"}
        resending={verification.resending}
        onSubmit={handleSubmitCode}
        onResend={verification.resend}
        onCancel={verification.cancel}
      />
    </form>
  );
}
