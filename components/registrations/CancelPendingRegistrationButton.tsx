"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

export default function CancelPendingRegistrationButton({ endpoint }: { endpoint: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleConfirm() {
    setLoading(true);
    const res = await fetch(endpoint, { method: "POST" });
    setLoading(false);
    setConfirming(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao cancelar inscrição.");
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={loading}
        className="text-xs text-red-600 hover:underline disabled:opacity-50"
      >
        {loading ? "Cancelando..." : "Cancelar inscrição"}
      </button>

      <ConfirmModal
        open={confirming}
        title="Cancelar inscrição pendente de pagamento"
        message={
          "Esta inscrição está aguardando pagamento há mais de 4 horas. Ao cancelar, a vaga do lote " +
          "será liberada para novas inscrições e o atleta receberá uma notificação (e-mail/WhatsApp) " +
          "avisando que a inscrição foi cancelada por falta de pagamento. Esta ação não pode ser desfeita."
        }
        confirmLabel="Cancelar inscrição"
        cancelLabel="Voltar"
        tone="danger"
        loading={loading}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />

      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
