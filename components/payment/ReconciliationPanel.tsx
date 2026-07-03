"use client";

import { useState } from "react";

interface Mismatch {
  paymentId: string;
  orderId: string;
  eventTitle: string;
  localStatus: string;
  gatewayStatus: string;
}

export default function ReconciliationPanel({ endpoint }: { endpoint: string }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ checked: number; mismatches: Mismatch[] } | null>(null);
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
      setError(err instanceof Error ? err.message : "Erro ao verificar");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card space-y-4">
      <button type="button" onClick={handleRun} disabled={running} className="btn-primary px-6 disabled:opacity-50">
        {running ? "Verificando..." : "Verificar agora"}
      </button>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {result.checked} pagamento(s) verificado(s), {result.mismatches.length} divergência(s) encontrada(s).
          </p>
          {result.mismatches.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 pr-4">Evento</th>
                  <th className="pb-2 pr-4">Pedido</th>
                  <th className="pb-2 pr-4">Status local</th>
                  <th className="pb-2">Status no gateway</th>
                </tr>
              </thead>
              <tbody>
                {result.mismatches.map((m) => (
                  <tr key={m.paymentId} className="border-b dark:border-gray-700 last:border-0">
                    <td className="py-2 pr-4">{m.eventTitle}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{m.orderId}</td>
                    <td className="py-2 pr-4">{m.localStatus}</td>
                    <td className="py-2">{m.gatewayStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
