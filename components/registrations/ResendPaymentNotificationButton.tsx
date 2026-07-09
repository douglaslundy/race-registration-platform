"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ErrorModal from "@/components/ui/ErrorModal";

export default function ResendPaymentNotificationButton({
  endpoint,
  label = "Reenviar notificação",
  loadingLabel = "Reenviando...",
}: {
  endpoint: string;
  label?: string;
  loadingLabel?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleResend() {
    setLoading(true);
    const res = await fetch(endpoint, { method: "POST" });
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao reenviar notificação.");
    setLoading(false);
  }

  return (
    <>
      <button
        onClick={handleResend}
        disabled={loading}
        className="text-xs text-blue-600 hover:underline disabled:opacity-50"
      >
        {loading ? loadingLabel : label}
      </button>
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
