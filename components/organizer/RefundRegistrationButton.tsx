"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RefundRegistrationButton({ registrationId }: { registrationId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleRefund() {
    if (
      !confirm(
        "Estornar o pagamento desta inscrição? O valor total será devolvido via gateway de pagamento. Esta ação não pode ser desfeita.",
      )
    )
      return;
    const reason = prompt("Motivo do estorno (opcional):") ?? undefined;
    setLoading(true);
    const res = await fetch(`/api/organizer/registrations/${registrationId}/refund`, {
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
      className="text-xs text-red-600 hover:underline disabled:opacity-50"
    >
      {loading ? "Estornando..." : "Estornar"}
    </button>
  );
}
