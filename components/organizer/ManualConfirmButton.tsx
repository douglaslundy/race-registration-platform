"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ManualConfirmButton({ registrationId }: { registrationId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleConfirm() {
    setLoading(true);
    const res = await fetch(`/api/organizer/registrations/${registrationId}/manual-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Erro ao confirmar inscrição.");
    setLoading(false);
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Justifique o motivo da confirmação manual"
          className="input-field text-xs"
          rows={2}
        />
        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={loading || reason.trim().length < 5}
            className="text-xs text-green-600 hover:underline disabled:opacity-50"
          >
            {loading ? "Confirmando..." : "Confirmar"}
          </button>
          <button onClick={() => setConfirming(false)} className="text-xs text-gray-500 hover:underline">
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} className="text-xs text-green-600 hover:underline">
      Confirmar manualmente
    </button>
  );
}
