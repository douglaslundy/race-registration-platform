"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

export default function ManualRefundResolutionButton({ endpoint }: { endpoint: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleConfirm(resolutionNote?: string) {
    if (!resolutionNote) return;
    setLoading(true);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolutionNote }),
    });
    setLoading(false);
    setOpen(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao registrar o estorno manual.");
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-primary-600 hover:underline">
        Registrar estorno manual
      </button>

      <ConfirmModal
        open={open}
        title="Registrar estorno manual"
        message="Use quando o estorno automático falhou e o valor já foi devolvido ao atleta fora da plataforma (ex.: PIX manual, transferência)."
        confirmLabel="Confirmar estorno manual"
        loading={loading}
        showNoteField
        noteRequired
        notePlaceholder="Descreva como e quando o estorno foi feito fora da plataforma"
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
