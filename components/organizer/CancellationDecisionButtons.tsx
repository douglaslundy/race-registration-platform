"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CancellationDecisionButtons({
  cancellationReason,
  endpoint,
}: {
  cancellationReason: string | null;
  endpoint: string;
}) {
  const [pendingDecision, setPendingDecision] = useState<"APPROVE" | "REJECT" | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function confirm() {
    if (!pendingDecision) return;
    setLoading(true);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: pendingDecision }),
    });
    setLoading(false);
    if (res.ok) {
      setPendingDecision(null);
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Erro ao processar a decisão.");
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

      {pendingDecision && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !loading && setPendingDecision(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {pendingDecision === "APPROVE" ? "Confirmar aprovação do cancelamento" : "Confirmar rejeição do cancelamento"}
            </h2>
            <p className="mt-3 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
              Justificativa do atleta
            </p>
            <p className="mt-1 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
              {cancellationReason ?? "Nenhuma justificativa registrada."}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDecision(null)}
                disabled={loading}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={loading}
                className={`px-4 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50 ${
                  pendingDecision === "APPROVE" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {loading ? "Enviando..." : pendingDecision === "APPROVE" ? "Confirmar aprovação" : "Confirmar rejeição"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
