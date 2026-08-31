"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";
import { useSensitiveActionVerification } from "@/lib/hooks/use-sensitive-action-verification";

interface StatusOption {
  value: "PROCESSING" | "COMPLETED" | "FAILED";
  label: string;
  tone: "default" | "danger" | "success";
}

const NEXT_STATUSES: Record<string, StatusOption[]> = {
  PENDING: [
    { value: "PROCESSING", label: "Processando", tone: "default" },
    { value: "COMPLETED", label: "Concluído", tone: "success" },
    { value: "FAILED", label: "Falhou", tone: "danger" },
  ],
  PROCESSING: [
    { value: "COMPLETED", label: "Concluído", tone: "success" },
    { value: "FAILED", label: "Falhou", tone: "danger" },
  ],
  COMPLETED: [],
  FAILED: [],
};

export default function UpdatePayoutStatusButton({ payoutId, status }: { payoutId: string; status: string }) {
  const [pendingStatus, setPendingStatus] = useState<StatusOption["value"] | null>(null);
  const [note, setNote] = useState<string | undefined>(undefined);
  const router = useRouter();

  const verification = useSensitiveActionVerification({
    requestCodeEndpoint: `/api/admin/payouts/${payoutId}/request-code`,
    confirmEndpoint: `/api/admin/payouts/${payoutId}`,
    confirmMethod: "PATCH",
  });

  const options = NEXT_STATUSES[status] ?? [];
  const pending = options.find((o) => o.value === pendingStatus) ?? null;

  async function handleConfirm(confirmNote?: string) {
    if (!pendingStatus) return;
    setNote(confirmNote);
    await verification.start();
  }

  async function handleSubmitCode(code: string) {
    if (!pendingStatus) return;
    const result = await verification.submitCode(code, { status: pendingStatus, note });
    if (result.ok) {
      setPendingStatus(null);
      router.refresh();
    }
  }

  function cancelAll() {
    setPendingStatus(null);
    verification.cancel();
  }

  if (options.length === 0) return null;

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setPendingStatus(o.value)}
            className="text-xs text-primary-600 hover:underline"
          >
            {o.label}
          </button>
        ))}
      </div>

      <ConfirmModal
        open={pending !== null && verification.step === "idle" && !verification.error}
        title={`Marcar repasse como "${pending?.label ?? ""}"`}
        message="Você receberá um código de confirmação por e-mail e WhatsApp. Você pode adicionar uma observação (opcional)."
        confirmLabel="Continuar"
        tone={pending?.tone ?? "default"}
        loading={verification.step === "requesting"}
        showNoteField
        notePlaceholder="Observação (opcional)"
        onConfirm={handleConfirm}
        onCancel={cancelAll}
      />

      <CodeVerificationModal
        open={verification.step === "code" || verification.step === "submitting"}
        title={`Confirmar status "${pending?.label ?? ""}" do repasse`}
        expiresAt={verification.expiresAt}
        error={verification.step !== "idle" ? verification.error : null}
        attemptsRemaining={verification.attemptsRemaining}
        loading={verification.step === "submitting"}
        resending={verification.resending}
        onSubmit={handleSubmitCode}
        onResend={verification.resend}
        onCancel={cancelAll}
      />

      <ErrorModal
        message={verification.step === "idle" ? verification.error : null}
        onClose={cancelAll}
      />
    </>
  );
}
