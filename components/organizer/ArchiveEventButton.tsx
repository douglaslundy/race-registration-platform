"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ArchiveEventButton({ eventId }: { eventId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleArchive() {
    if (!confirm("Cancelar/arquivar este evento? Esta ação não pode ser desfeita facilmente.")) return;
    setLoading(true);
    const res = await fetch(`/api/events/${eventId}/archive`, { method: "POST" });
    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json();
      alert(data.error ?? "Erro ao cancelar evento.");
    }
    setLoading(false);
  }

  return (
    <button onClick={handleArchive} disabled={loading}
      className="btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50 disabled:opacity-50">
      {loading ? "Cancelando..." : "Cancelar evento"}
    </button>
  );
}
