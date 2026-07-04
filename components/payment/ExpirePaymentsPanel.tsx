"use client";

import { useState } from "react";

export default function ExpirePaymentsPanel({ endpoint }: { endpoint: string }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ checked: number; expired: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao processar");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card space-y-4">
      <button type="button" onClick={handleRun} disabled={running} className="btn-primary px-6 disabled:opacity-50">
        {running ? "Processando..." : "Processar agora"}
      </button>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {result.checked} pagamento(s) verificado(s), {result.expired} cancelado(s) por prazo vencido.
        </p>
      )}
    </div>
  );
}
