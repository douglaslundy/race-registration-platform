"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RefundPaymentButton({ paymentId }: { paymentId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleRefund() {
    if (
      !confirm(
        "Estornar este pagamento? O valor total será devolvido via gateway de pagamento. Esta ação não pode ser desfeita.",
      )
    )
      return;
    const reason = prompt("Motivo do estorno (opcional):") ?? undefined;
    setLoading(true);
    const res = await fetch(`/api/admin/payments/${paymentId}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Erro ao estornar pagamento.");
    setLoading(false);
  }

  return (
    <button
      onClick={handleRefund}
      disabled={loading}
      className="btn-secondary text-sm text-red-700 border-red-200 hover:bg-red-50 disabled:opacity-50"
    >
      {loading ? "Estornando..." : "Estornar pagamento"}
    </button>
  );
}
