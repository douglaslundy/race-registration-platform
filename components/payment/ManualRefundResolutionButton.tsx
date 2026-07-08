"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ManualRefundResolutionButton({ endpoint }: { endpoint: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function confirm() {
    if (!note.trim()) return;
    setLoading(true);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolutionNote: note.trim() }),
    });
    setLoading(false);
    if (res.ok) {
      setOpen(false);
      setNote("");
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Erro ao registrar o estorno manual.");
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-primary-600 hover:underline">
        Registrar estorno manual
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Registrar estorno manual</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Use quando o estorno automático falhou e o valor já foi devolvido ao atleta fora da plataforma (ex.:
              PIX manual, transferência).
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Descreva como e quando o estorno foi feito fora da plataforma"
              className="input-field text-sm mt-3"
              rows={3}
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={loading}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={loading || !note.trim()}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {loading ? "Registrando..." : "Confirmar estorno manual"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
