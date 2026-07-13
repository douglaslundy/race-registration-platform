"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

interface StatusOption {
  value: "PROCESSING" | "COMPLETED" | "FAILED";
  label: string;
  tone: "default" | "danger" | "success";
}

const NEXT_STATUSES: Record<string, StatusOption[]> = {
  PENDING: [
    { value: "PROCESSING", label: "Processando", tone: "default" },
    { value: "COMPLETED", label: "Concluído", tone: "success" },
    { value: "FAILED", label: "Falhou", tone: "danger" },
  ],
  PROCESSING: [
    { value: "COMPLETED", label: "Concluído", tone: "success" },
    { value: "FAILED", label: "Falhou", tone: "danger" },
  ],
  COMPLETED: [],
  FAILED: [],
};

export default function UpdatePayoutStatusButton({ payoutId, status }: { payoutId: string; status: string }) {
  const [pendingStatus, setPendingStatus] = useState<StatusOption["value"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const options = NEXT_STATUSES[status] ?? [];
  const pending = options.find((o) => o.value === pendingStatus) ?? null;

  async function handleConfirm(note?: string) {
    if (!pendingStatus) return;
    setLoading(true);
    const res = await fetch(`/api/admin/payouts/${payoutId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: pendingStatus, note }),
    });
    setLoading(false);
    setPendingStatus(null);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao atualizar o status do repasse.");
  }

  if (options.length === 0) return null;

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setPendingStatus(o.value)}
            className="text-xs text-primary-600 hover:underline"
          >
            {o.label}
          </button>
        ))}
      </div>

      <ConfirmModal
        open={pending !== null}
        title={`Marcar repasse como "${pending?.label ?? ""}"`}
        message="Você pode adicionar uma observação (opcional)."
        confirmLabel="Confirmar"
        tone={pending?.tone ?? "default"}
        loading={loading}
        showNoteField
        notePlaceholder="Observação (opcional)"
        onConfirm={handleConfirm}
        onCancel={() => setPendingStatus(null)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
