"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ApproveEventButton({ eventId }: { eventId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function approve() {
    setLoading(true);
    await fetch(`/api/admin/events/${eventId}/approve`, { method: "POST" });
    router.refresh();
    setLoading(false);
  }

  async function reject() {
    setLoading(true);
    await fetch(`/api/admin/events/${eventId}/reject`, { method: "POST" });
    router.refresh();
    setLoading(false);
  }

  return (
    <div className="flex gap-2">
      <button onClick={approve} disabled={loading} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200">
        Aprovar
      </button>
      <button onClick={reject} disabled={loading} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200">
        Rejeitar
      </button>
    </div>
  );
}
