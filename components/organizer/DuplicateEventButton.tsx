"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DuplicateEventButton({ eventId }: { eventId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleDuplicate() {
    if (!confirm("Duplicar este evento? Um novo rascunho será criado com os mesmos dados.")) return;
    setLoading(true);
    const res = await fetch(`/api/events/${eventId}/duplicate`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      router.push(`/organizador/eventos/${data.eventId}`);
    } else {
      alert("Erro ao duplicar evento.");
    }
    setLoading(false);
  }

  return (
    <button onClick={handleDuplicate} disabled={loading} className="btn-secondary text-sm disabled:opacity-50">
      {loading ? "Duplicando..." : "Duplicar evento"}
    </button>
  );
}
