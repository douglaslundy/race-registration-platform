"use client";

import { useState } from "react";
import PixPaymentCard from "@/components/dashboard/PixPaymentCard";
import { extractApiErrorMessage } from "@/lib/checkout-validation";

interface SubscribeButtonProps {
  adPlanId: string;
}

interface CheckoutAdsResult {
  adPurchaseId: string;
  status: string;
  pixQrCode?: string | null;
  pixQrCodeText?: string | null;
  boletoUrl?: string | null;
  checkoutUrl?: string | null;
}

export default function SubscribeButton({ adPlanId }: SubscribeButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckoutAdsResult | null>(null);

  async function handleSubscribe() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adPlanId, paymentMethod: "PIX" }),
      });
      const raw = await res.text();
      const body = raw ? JSON.parse(raw) : {};
      if (!res.ok) {
        setError(extractApiErrorMessage(body.error) ?? extractApiErrorMessage(body) ?? "Erro ao processar assinatura");
        return;
      }
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao processar assinatura");
    } finally {
      setLoading(false);
    }
  }

  if (result?.pixQrCodeText) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-green-700 dark:text-green-400 font-medium">Assinatura iniciada!</p>
        <PixPaymentCard pixQrCodeText={result.pixQrCodeText} />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Aguardando confirmação do pagamento. Assim que for confirmado, o plano aparece no seu
          dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleSubscribe}
        disabled={loading}
        className="btn-primary w-full disabled:opacity-50"
      >
        {loading ? "Processando..." : "Assinar"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
