"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ResendPaymentNotificationButton({ endpoint }: { endpoint: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleResend() {
    setLoading(true);
    const res = await fetch(endpoint, { method: "POST" });
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Erro ao reenviar notificação.");
    setLoading(false);
  }

  return (
    <button
      onClick={handleResend}
      disabled={loading}
      className="text-xs text-blue-600 hover:underline disabled:opacity-50"
    >
      {loading ? "Reenviando..." : "Reenviar notificação"}
    </button>
  );
}
