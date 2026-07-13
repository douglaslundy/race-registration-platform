"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";
import { formatCurrency } from "@/lib/format";

interface PayoutPreview {
  orderCount: number;
  grossAmount: number;
  platformFee: number;
  netAmount: number;
}

export default function GeneratePayoutButton({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PayoutPreview | null>(null);
  const router = useRouter();

  async function openModal() {
    setLoading(true);
    const res = await fetch(`/api/admin/events/${eventId}/payouts/preview`);
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao calcular o repasse.");
      return;
    }
    const data: PayoutPreview = await res.json();
    if (data.orderCount === 0) {
      setError("Nenhum pedido pago pendente de repasse para este evento.");
      return;
    }
    setPreview(data);
    setOpen(true);
  }

  async function handleConfirm() {
    setLoading(true);
    const res = await fetch(`/api/admin/events/${eventId}/payouts`, { method: "POST" });
    setLoading(false);
    setOpen(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao gerar o repasse.");
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        disabled={loading}
        className="text-xs bg-primary-100 text-primary-700 px-2 py-1 rounded hover:bg-primary-200 disabled:opacity-50"
      >
        Gerar repasse
      </button>

      <ConfirmModal
        open={open}
        title="Gerar repasse"
        message={
          preview
            ? `${preview.orderCount} pedido(s) pago(s) pendente(s) de repasse.\n\nBruto: ${formatCurrency(preview.grossAmount)}\nTaxa da plataforma: ${formatCurrency(preview.platformFee)}\nLíquido a repassar: ${formatCurrency(preview.netAmount)}`
            : ""
        }
        confirmLabel="Gerar repasse"
        tone="success"
        loading={loading}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
