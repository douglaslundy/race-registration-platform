"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";
import { useSensitiveActionVerification } from "@/lib/hooks/use-sensitive-action-verification";

interface Props {
  purchaseId: string;
  companyName: string;
  document: string | null;
  address: string | null;
  contactEmail: string;
  contactPhone: string;
  instagram: string | null;
  facebook: string | null;
  planName: string;
}

export default function AdvertiserRequestRow({
  purchaseId,
  companyName,
  document,
  address,
  contactEmail,
  contactPhone,
  instagram,
  facebook,
  planName,
}: Props) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const verification = useSensitiveActionVerification({
    requestCodeEndpoint: `/api/admin/anunciantes/${purchaseId}/reject/request-code`,
    confirmEndpoint: `/api/admin/anunciantes/${purchaseId}/reject`,
  });

  async function handleApprove() {
    setLoading(true);
    const res = await fetch(`/api/admin/anunciantes/${purchaseId}/approve`, { method: "POST" });
    setLoading(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao aprovar solicitação.");
  }

  async function handleConfirmReject(noteReason?: string) {
    setReason(noteReason);
    setRejecting(false);
    await verification.start();
  }

  async function handleSubmitCode(code: string) {
    const result = await verification.submitCode(code, { reason });
    if (result.ok && result.response) {
      router.refresh();
      const data = await result.response.json().catch(() => ({}));
      if (data.refundFailed) {
        setError("Solicitação rejeitada, mas o estorno automático falhou — verifique manualmente o pagamento.");
      }
    }
  }

  const busy = loading || verification.step === "requesting" || verification.step === "submitting";

  return (
    <div className="py-4 first:pt-0 last:pb-0 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-medium">{companyName} <span className="text-xs text-gray-500">— {planName}</span></p>
          <p className="text-xs text-gray-500">{document ?? "—"} — {address ?? "—"}</p>
          <p className="text-xs text-gray-500">{contactEmail} — {contactPhone}</p>
          {(instagram || facebook) && (
            <p className="text-xs text-gray-500">
              {instagram && <span>Instagram: {instagram} </span>}
              {facebook && <span>Facebook: {facebook}</span>}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={handleApprove} disabled={busy} className="btn-primary py-1.5 px-3 text-sm disabled:opacity-50">
            {loading ? "Processando..." : "Aprovar"}
          </button>
          <button
            onClick={() => setRejecting(true)}
            disabled={busy}
            className="btn-secondary py-1.5 px-3 text-sm text-red-700 border-red-200 hover:bg-red-50 disabled:opacity-50"
          >
            Rejeitar
          </button>
        </div>
      </div>

      <ConfirmModal
        open={rejecting}
        title="Rejeitar solicitação de anunciante"
        message="Informe o motivo da rejeição. O valor pago será estornado automaticamente e o solicitante verá esse motivo por e-mail. Você receberá um código de confirmação por e-mail e WhatsApp."
        confirmLabel="Continuar"
        tone="danger"
        loading={verification.step === "requesting"}
        showNoteField
        noteRequired
        notePlaceholder="Motivo da rejeição"
        onConfirm={handleConfirmReject}
        onCancel={() => setRejecting(false)}
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
    </div>
  );
}
