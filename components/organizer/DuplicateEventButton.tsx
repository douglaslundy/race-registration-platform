"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

export default function DuplicateEventButton({ eventId }: { eventId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleDuplicate() {
    setLoading(true);
    const res = await fetch(`/api/events/${eventId}/duplicate`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      router.push(`/organizador/eventos/${data.eventId}`);
      return;
    }
    setLoading(false);
    setConfirming(false);
    setError("Erro ao duplicar evento.");
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={loading}
        className="btn-secondary text-sm disabled:opacity-50"
      >
        {loading ? "Duplicando..." : "Duplicar evento"}
      </button>

      <ConfirmModal
        open={confirming}
        title="Duplicar evento"
        message="Duplicar este evento? Um novo rascunho será criado com os mesmos dados."
        confirmLabel="Duplicar"
        loading={loading}
        onConfirm={handleDuplicate}
        onCancel={() => setConfirming(false)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
