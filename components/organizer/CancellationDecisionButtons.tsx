"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";
import { useSensitiveActionVerification } from "@/lib/hooks/use-sensitive-action-verification";

export default function CancellationDecisionButtons({
  cancellationReason,
  endpoint,
  requestCodeEndpoint,
  hasPaidPayment,
}: {
  cancellationReason: string | null;
  endpoint: string;
  requestCodeEndpoint?: string;
  hasPaidPayment?: boolean;
}) {
  const [pendingDecision, setPendingDecision] = useState<"APPROVE" | "REJECT" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const verification = useSensitiveActionVerification({
    requestCodeEndpoint: requestCodeEndpoint ?? "",
    confirmEndpoint: endpoint,
  });

  const needsCode = pendingDecision === "APPROVE" && !!hasPaidPayment;

  async function confirmDecision() {
    if (!pendingDecision) return;

    if (needsCode) {
      setPendingDecision(null);
      await verification.start();
      return;
    }

    setLoading(true);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: pendingDecision }),
    });
    setLoading(false);
    setPendingDecision(null);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao processar a decisão.");
  }

  async function handleSubmitCode(code: string) {
    const result = await verification.submitCode(code, { decision: "APPROVE" });
    if (result.ok) router.refresh();
  }

  const busy = loading || verification.step === "requesting" || verification.step === "submitting";

  return (
    <>
      <div className="flex gap-2">
        <button onClick={() => setPendingDecision("APPROVE")} disabled={busy} className="text-xs text-green-600 hover:underline disabled:opacity-50">
          Aprovar
        </button>
        <button onClick={() => setPendingDecision("REJECT")} disabled={busy} className="text-xs text-red-600 hover:underline disabled:opacity-50">
          Rejeitar
        </button>
      </div>

      <ConfirmModal
        open={pendingDecision !== null}
        title={pendingDecision === "APPROVE" ? "Confirmar aprovação do cancelamento" : "Confirmar rejeição do cancelamento"}
        message={
          `Justificativa do atleta:\n${cancellationReason ?? "Nenhuma justificativa registrada."}` +
          (needsCode ? "\n\nComo há um pagamento pago, você receberá um código de confirmação por e-mail e WhatsApp." : "")
        }
        confirmLabel={pendingDecision === "APPROVE" ? (needsCode ? "Continuar" : "Confirmar aprovação") : "Confirmar rejeição"}
        tone={pendingDecision === "APPROVE" ? "success" : "danger"}
        loading={loading}
        onConfirm={confirmDecision}
        onCancel={() => setPendingDecision(null)}
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
        message={error ?? (verification.step === "idle" ? verification.error : null)}
        onClose={() => { setError(null); verification.cancel(); }}
      />
    </>
  );
}
