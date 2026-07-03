"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CancellationDecisionButtons({ registrationId }: { registrationId: string }) {
  const [loading, setLoading] = useState<"APPROVE" | "REJECT" | null>(null);
  const router = useRouter();

  async function handleDecision(decision: "APPROVE" | "REJECT") {
    setLoading(decision);
    const res = await fetch(`/api/organizer/registrations/${registrationId}/cancellation-decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Erro ao processar a decisão.");
    setLoading(null);
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={() => handleDecision("APPROVE")}
        disabled={loading !== null}
        className="text-xs text-green-600 hover:underline disabled:opacity-50"
      >
        {loading === "APPROVE" ? "Aprovando..." : "Aprovar"}
      </button>
      <button
        onClick={() => handleDecision("REJECT")}
        disabled={loading !== null}
        className="text-xs text-red-600 hover:underline disabled:opacity-50"
      >
        {loading === "REJECT" ? "Rejeitando..." : "Rejeitar"}
      </button>
    </div>
  );
}
