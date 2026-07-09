"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

export default function CancellationDecisionButtons({
  cancellationReason,
  endpoint,
}: {
  cancellationReason: string | null;
  endpoint: string;
}) {
  const [pendingDecision, setPendingDecision] = useState<"APPROVE" | "REJECT" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function confirmDecision() {
    if (!pendingDecision) return;
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

  return (
    <>
      <div className="flex gap-2">
        <button
          onClick={() => setPendingDecision("APPROVE")}
          className="text-xs text-green-600 hover:underline"
        >
          Aprovar
        </button>
        <button
          onClick={() => setPendingDecision("REJECT")}
          className="text-xs text-red-600 hover:underline"
        >
          Rejeitar
        </button>
      </div>

      <ConfirmModal
        open={pendingDecision !== null}
        title={
          pendingDecision === "APPROVE"
            ? "Confirmar aprovação do cancelamento"
            : "Confirmar rejeição do cancelamento"
        }
        message={`Justificativa do atleta:\n${cancellationReason ?? "Nenhuma justificativa registrada."}`}
        confirmLabel={pendingDecision === "APPROVE" ? "Confirmar aprovação" : "Confirmar rejeição"}
        tone={pendingDecision === "APPROVE" ? "success" : "danger"}
        loading={loading}
        onConfirm={confirmDecision}
        onCancel={() => setPendingDecision(null)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
