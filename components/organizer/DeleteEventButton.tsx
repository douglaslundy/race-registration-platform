"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteEventButton({ eventId }: { eventId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (!confirm("Excluir este evento? Esta ação é definitiva e só funciona para eventos sem inscrições ou pedidos.")) return;
    setLoading(true);
    const res = await fetch(`/api/events/${eventId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/organizador");
      router.refresh();
      return;
    }

    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Erro ao excluir evento.");
    setLoading(false);
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="btn-secondary text-sm text-red-700 border-red-200 hover:bg-red-50 disabled:opacity-50"
    >
      {loading ? "Excluindo..." : "Excluir evento"}
    </button>
  );
}
