"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";
import { useSensitiveActionVerification } from "@/lib/hooks/use-sensitive-action-verification";

export default function CancelConfirmedRegistrationButton({
  endpoint,
  requestCodeEndpoint,
}: {
  endpoint: string;
  requestCodeEndpoint: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const router = useRouter();

  const verification = useSensitiveActionVerification({
    requestCodeEndpoint,
    confirmEndpoint: endpoint,
  });

  async function handleConfirm(note?: string) {
    setConfirming(false);
    setReason(note ?? "");
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
        Cancelar inscrição
      </button>

      <ConfirmModal
        open={confirming}
        title="Cancelar inscrição confirmada"
        message={
          "Esta ação cancela a inscrição, libera a vaga do lote e tenta estornar o pagamento " +
          "(ou marca pra estorno manual, se o gateway falhar). O atleta será avisado por " +
          "e-mail e WhatsApp com o motivo abaixo. Você receberá um código de confirmação por " +
          "e-mail e WhatsApp pra concluir. Esta ação não pode ser desfeita."
        }
        confirmLabel="Continuar"
        tone="danger"
        loading={busy}
        showNoteField
        noteRequired
        notePlaceholder="Justificativa do cancelamento (obrigatória)"
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />

      <CodeVerificationModal
        open={verification.step === "code" || verification.step === "submitting"}
        title="Confirmar cancelamento da inscrição"
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
        onClose={() => verification.cancel()}
      />
    </>
  );
}
