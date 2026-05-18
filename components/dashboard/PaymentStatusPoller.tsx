"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function PaymentStatusPoller({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const interval = setInterval(async () => {
      setChecking(true);
      try {
        const res = await fetch(`/api/orders/${orderId}/status`);
        const data = await res.json();
        if (data.status === "PAID") {
          clearInterval(interval);
          router.refresh();
        }
      } finally {
        setChecking(false);
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [orderId, router]);

  return (
    <div className="flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
      <span className={`w-2 h-2 rounded-full bg-yellow-500 ${checking ? "animate-ping" : "animate-pulse"}`} />
      Aguardando confirmação do pagamento... Atualizando automaticamente.
    </div>
  );
}
