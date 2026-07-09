"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

export default function DeleteEventButton({ eventId }: { eventId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleDelete() {
    setLoading(true);
    const res = await fetch(`/api/events/${eventId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/organizador");
      router.refresh();
      return;
    }

    setLoading(false);
    setConfirming(false);
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao excluir evento.");
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={loading}
        className="btn-secondary text-sm text-red-700 border-red-200 hover:bg-red-50 disabled:opacity-50"
      >
        {loading ? "Excluindo..." : "Excluir evento"}
      </button>

      <ConfirmModal
        open={confirming}
        title="Excluir evento"
        message="Excluir este evento? Esta ação é definitiva e só funciona para eventos sem inscrições ou pedidos."
        confirmLabel="Excluir"
        tone="danger"
        loading={loading}
        onConfirm={handleDelete}
        onCancel={() => setConfirming(false)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
