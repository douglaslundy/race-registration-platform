"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";
import ErrorModal from "@/components/ui/ErrorModal";
import { useSensitiveActionVerification } from "@/lib/hooks/use-sensitive-action-verification";

export default function ToggleUserActiveButton({ userId, active }: { userId: string; active: boolean }) {
  const [isActive, setIsActive] = useState(active);
  const router = useRouter();

  const verification = useSensitiveActionVerification({
    requestCodeEndpoint: `/api/admin/users/${userId}/request-code`,
    confirmEndpoint: `/api/admin/users/${userId}`,
    confirmMethod: "PATCH",
  });

  async function handleToggle() {
    await verification.start();
  }

  async function handleSubmitCode(code: string) {
    const result = await verification.submitCode(code, { active: !isActive });
    if (result.ok) {
      setIsActive(!isActive);
      router.refresh();
    }
  }

  const busy = verification.step === "requesting" || verification.step === "submitting";

  return (
    <>
      <button
        onClick={handleToggle}
        disabled={busy}
        className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors disabled:opacity-50 ${
          isActive ? "bg-red-50 text-red-600 border-red-200 hover:bg-red-100" : "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
        }`}
      >
        {busy ? "..." : isActive ? "Bloquear usuário" : "Desbloquear usuário"}
      </button>

      <CodeVerificationModal
        open={verification.step === "code" || verification.step === "submitting"}
        title={isActive ? "Confirmar bloqueio do usuário" : "Confirmar desbloqueio do usuário"}
        expiresAt={verification.expiresAt}
        error={verification.step !== "idle" ? verification.error : null}
        attemptsRemaining={verification.attemptsRemaining}
        loading={verification.step === "submitting"}
        resending={verification.resending}
        onSubmit={handleSubmitCode}
        onResend={verification.resend}
        onCancel={verification.cancel}
      />

      <ErrorModal
        message={verification.step === "idle" ? verification.error : null}
        onClose={verification.cancel}
      />
    </>
  );
}
