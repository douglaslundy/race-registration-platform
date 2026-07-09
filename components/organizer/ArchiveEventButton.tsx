"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

export default function ArchiveEventButton({ eventId }: { eventId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleArchive() {
    setLoading(true);
    const res = await fetch(`/api/events/${eventId}/archive`, { method: "POST" });
    setLoading(false);
    setConfirming(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao cancelar evento.");
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={loading}
        className="btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50 disabled:opacity-50"
      >
        {loading ? "Cancelando..." : "Cancelar evento"}
      </button>

      <ConfirmModal
        open={confirming}
        title="Cancelar evento"
        message="Cancelar/arquivar este evento? Esta ação não pode ser desfeita facilmente."
        confirmLabel="Cancelar evento"
        tone="danger"
        loading={loading}
        onConfirm={handleArchive}
        onCancel={() => setConfirming(false)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
