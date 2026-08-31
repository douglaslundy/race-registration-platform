"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@prisma/client";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";
import ErrorModal from "@/components/ui/ErrorModal";
import { useSensitiveActionVerification } from "@/lib/hooks/use-sensitive-action-verification";

const ROLES: UserRole[] = ["ATHLETE", "ORGANIZER", "ADMIN", "SUPPORT", "PARTNER"];
const ROLE_LABELS: Record<UserRole, string> = {
  ATHLETE: "Atleta", ORGANIZER: "Organizador", ADMIN: "Admin", SUPPORT: "Suporte", PARTNER: "Parceiro", ASSISTANT: "Assistente", ADVERTISER: "Anunciante",
};

export default function ChangeUserRoleButton({ userId, currentRole }: { userId: string; currentRole: UserRole }) {
  const [role, setRole] = useState(currentRole);
  const [pendingRole, setPendingRole] = useState<UserRole | null>(null);
  const router = useRouter();

  const verification = useSensitiveActionVerification({
    requestCodeEndpoint: `/api/admin/users/${userId}/request-code`,
    confirmEndpoint: `/api/admin/users/${userId}`,
    confirmMethod: "PATCH",
  });

  async function handleChange(newRole: UserRole) {
    if (newRole === role) return;
    setPendingRole(newRole);
    await verification.start();
  }

  async function handleSubmitCode(code: string) {
    if (!pendingRole) return;
    const result = await verification.submitCode(code, { role: pendingRole });
    if (result.ok) {
      setRole(pendingRole);
      setPendingRole(null);
      router.refresh();
    }
  }

  const busy = verification.step === "requesting" || verification.step === "submitting";

  return (
    <>
      <select
        value={pendingRole ?? role}
        disabled={busy}
        onChange={(e) => handleChange(e.target.value as UserRole)}
        className="text-xs border border-gray-300 rounded px-2 py-1 disabled:opacity-50"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
        ))}
      </select>

      <CodeVerificationModal
        open={verification.step === "code" || verification.step === "submitting"}
        title="Confirmar mudança de perfil do usuário"
        expiresAt={verification.expiresAt}
        error={verification.step !== "idle" ? verification.error : null}
        attemptsRemaining={verification.attemptsRemaining}
        loading={verification.step === "submitting"}
        resending={verification.resending}
        onSubmit={handleSubmitCode}
        onResend={verification.resend}
        onCancel={() => {
          setPendingRole(null);
          verification.cancel();
        }}
      />

      <ErrorModal
        message={verification.step === "idle" ? verification.error : null}
        onClose={() => {
          setPendingRole(null);
          verification.cancel();
        }}
      />
    </>
  );
}
