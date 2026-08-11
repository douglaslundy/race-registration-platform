"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";
import { useSensitiveActionVerification } from "@/lib/hooks/use-sensitive-action-verification";

export default function RefundRegistrationButton({ registrationId }: { registrationId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);
  const router = useRouter();

  const verification = useSensitiveActionVerification({
    requestCodeEndpoint: `/api/organizer/registrations/${registrationId}/refund/request-code`,
    confirmEndpoint: `/api/organizer/registrations/${registrationId}/refund`,
  });

  async function handleConfirmReason(noteReason?: string) {
    setReason(noteReason);
    setConfirming(false);
    await verification.start();
  }

  async function handleSubmitCode(code: string) {
    const result = await verification.submitCode(code, { reason });
    if (result.ok) router.refresh();
  }

  const busy = verification.step === "requesting" || verification.step === "submitting";

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={busy}
        className="text-xs text-red-600 hover:underline disabled:opacity-50"
      >
        {busy ? "Estornando..." : "Estornar"}
      </button>

      <ConfirmModal
        open={confirming}
        title="Estornar pagamento"
        message="Estornar o pagamento desta inscrição? O valor total será devolvido via gateway de pagamento. Esta ação não pode ser desfeita. Você receberá um código de confirmação por e-mail e WhatsApp."
        confirmLabel="Continuar"
        tone="danger"
        loading={verification.step === "requesting"}
        showNoteField
        notePlaceholder="Motivo do estorno (opcional)"
        onConfirm={handleConfirmReason}
        onCancel={() => setConfirming(false)}
      />

      <CodeVerificationModal
        open={verification.step === "code" || verification.step === "submitting"}
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
