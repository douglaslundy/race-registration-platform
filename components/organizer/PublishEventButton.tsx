"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ErrorModal from "@/components/ui/ErrorModal";

export default function PublishEventButton({ eventId }: { eventId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handlePublish() {
    setLoading(true);
    const res = await fetch(`/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "UNDER_REVIEW" }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      setError("Erro ao solicitar publicação.");
    }
    setLoading(false);
  }

  return (
    <>
      <button onClick={handlePublish} disabled={loading} className="btn-primary text-sm disabled:opacity-50">
        {loading ? "Enviando..." : "Solicitar publicação"}
      </button>
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
