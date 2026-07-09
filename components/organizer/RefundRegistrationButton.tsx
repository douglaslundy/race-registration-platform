"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

export default function RefundRegistrationButton({ registrationId }: { registrationId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleRefund(reason?: string) {
    setLoading(true);
    const res = await fetch(`/api/organizer/registrations/${registrationId}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setLoading(false);
    setConfirming(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao estornar pagamento.");
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={loading}
        className="text-xs text-red-600 hover:underline disabled:opacity-50"
      >
        {loading ? "Estornando..." : "Estornar"}
      </button>

      <ConfirmModal
        open={confirming}
        title="Estornar pagamento"
        message="Estornar o pagamento desta inscrição? O valor total será devolvido via gateway de pagamento. Esta ação não pode ser desfeita."
        confirmLabel="Estornar"
        tone="danger"
        loading={loading}
        showNoteField
        notePlaceholder="Motivo do estorno (opcional)"
        onConfirm={handleRefund}
        onCancel={() => setConfirming(false)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
