"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

export default function SendAllAbandonedCartsButton({
  endpoint,
  filters,
  count,
}: {
  endpoint: string;
  filters: Record<string, string>;
  count: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, ...filters }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar alertas");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={count === 0}
        className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
      >
        Enviar para todos ({count})
      </button>
      <ConfirmModal
        open={confirming}
        title="Enviar alerta para todos"
        message={`Isso vai enviar um alerta de carrinho abandonado para ${count} pedido(s) pendente(s) que atendem aos filtros atuais. Deseja continuar?`}
        confirmLabel="Enviar"
        tone="default"
        loading={loading}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
