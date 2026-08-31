"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";
import { formatCurrency } from "@/lib/format";
import { useSensitiveActionVerification } from "@/lib/hooks/use-sensitive-action-verification";

interface PayoutPreview {
  orderCount: number;
  grossAmount: number;
  platformFee: number;
  netAmount: number;
}

export default function GeneratePayoutButton({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PayoutPreview | null>(null);
  const router = useRouter();

  const verification = useSensitiveActionVerification({
    requestCodeEndpoint: `/api/admin/events/${eventId}/payouts/request-code`,
    confirmEndpoint: `/api/admin/events/${eventId}/payouts`,
    confirmMethod: "POST",
  });

  async function openModal() {
    setLoading(true);
    const res = await fetch(`/api/admin/events/${eventId}/payouts/preview`);
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao calcular o repasse.");
      return;
    }
    const data: PayoutPreview = await res.json();
    if (data.orderCount === 0) {
      setError("Nenhum pedido pago pendente de repasse para este evento.");
      return;
    }
    setPreview(data);
    setOpen(true);
  }

  async function handleConfirm() {
    setOpen(false);
    await verification.start();
  }

  async function handleSubmitCode(code: string) {
    const result = await verification.submitCode(code);
    if (result.ok) router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        disabled={loading || verification.step === "requesting" || verification.step === "submitting"}
        className="text-xs bg-primary-100 text-primary-700 px-2 py-1 rounded hover:bg-primary-200 disabled:opacity-50"
      >
        Gerar repasse
      </button>

      <ConfirmModal
        open={open}
        title="Gerar repasse"
        message={
          preview
            ? `${preview.orderCount} pedido(s) pago(s) pendente(s) de repasse.\n\nBruto: ${formatCurrency(preview.grossAmount)}\nTaxa da plataforma: ${formatCurrency(preview.platformFee)}\nLíquido a repassar: ${formatCurrency(preview.netAmount)}\n\nVocê receberá um código de confirmação por e-mail e WhatsApp.`
            : ""
        }
        confirmLabel="Continuar"
        tone="success"
        loading={verification.step === "requesting"}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />

      <CodeVerificationModal
        open={verification.step === "code" || verification.step === "submitting"}
        title="Confirmar geração de repasse"
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
        onClose={() => {
          setError(null);
          verification.cancel();
        }}
      />
    </>
  );
}
