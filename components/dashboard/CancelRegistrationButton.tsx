"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ErrorModal from "@/components/ui/ErrorModal";

export default function CancelRegistrationButton({
  registrationId,
  requiresApproval = false,
}: {
  registrationId: string;
  requiresApproval?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleCancel() {
    setLoading(true);
    const res = await fetch(`/api/registrations/${registrationId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() || undefined }),
    });
    if (res.ok) {
      if (requiresApproval) {
        setRequested(true);
      } else {
        router.refresh();
      }
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao cancelar inscrição. Tente novamente.");
    }
    setLoading(false);
    setConfirming(false);
  }

  if (requested) {
    return (
      <p className="flex-1 text-sm text-center text-gray-600 dark:text-gray-400">
        Solicitação enviada — aguardando aprovação do organizador
      </p>
    );
  }

  if (confirming) {
    return (
      <div className="flex-1 flex flex-col gap-2">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Justifique o motivo do cancelamento"
          className="input-field text-sm"
          rows={3}
        />
        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            disabled={loading || !reason.trim()}
            className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Enviando..." : "Confirmar cancelamento"}
          </button>
          <button onClick={() => setConfirming(false)} className="btn-secondary text-sm px-3">
            Voltar
          </button>
        </div>
        <ErrorModal message={error} onClose={() => setError(null)} />
      </div>
    );
  }

  return (
    <>
      <button onClick={() => setConfirming(true)} className="flex-1 btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">
        Cancelar inscrição
      </button>
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
