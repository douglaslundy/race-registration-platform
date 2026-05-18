"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CancelRegistrationButton({ registrationId }: { registrationId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleCancel() {
    setLoading(true);
    const res = await fetch(`/api/registrations/${registrationId}/cancel`, { method: "POST" });
    if (res.ok) {
      router.refresh();
    } else {
      alert("Erro ao cancelar inscrição. Tente novamente.");
    }
    setLoading(false);
    setConfirming(false);
  }

  if (confirming) {
    return (
      <div className="flex-1 flex gap-2">
        <button onClick={handleCancel} disabled={loading} className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
          {loading ? "Cancelando..." : "Confirmar cancelamento"}
        </button>
        <button onClick={() => setConfirming(false)} className="btn-secondary text-sm px-3">
          Voltar
        </button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} className="flex-1 btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">
      Cancelar inscrição
    </button>
  );
}
