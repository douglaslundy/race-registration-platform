"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ErrorModal from "@/components/ui/ErrorModal";
import { extractApiErrorMessage } from "@/lib/checkout-validation";

export interface PurchaseOption {
  id: string;
  planName: string;
  available: number;
}

export interface SlotOption {
  id: string;
  key: string;
  label: string;
  width: number;
  height: number;
}

interface Props {
  purchases: PurchaseOption[];
  slots: SlotOption[];
}

export default function PrivateAdForm({ purchases, slots }: Props) {
  const router = useRouter();
  const [adPurchaseId, setAdPurchaseId] = useState(purchases[0]?.id ?? "");
  const [adSlotId, setAdSlotId] = useState(slots[0]?.id ?? "");
  const [targetUrl, setTargetUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Selecione a imagem do anúncio");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("adPurchaseId", adPurchaseId);
      formData.append("adSlotId", adSlotId);
      formData.append("targetUrl", targetUrl);
      formData.append("image", file);

      const res = await fetch("/api/anunciante/ads", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(extractApiErrorMessage(body.error) ?? extractApiErrorMessage(body) ?? "Erro ao cadastrar anúncio");
        return;
      }

      router.push("/anunciante");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao cadastrar anúncio");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="card space-y-4 max-w-xl">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Compra *
          </label>
          <select
            value={adPurchaseId}
            onChange={(e) => setAdPurchaseId(e.target.value)}
            className="input-field"
            required
          >
            {purchases.map((purchase) => (
              <option key={purchase.id} value={purchase.id}>
                {purchase.planName} — {purchase.available} vaga{purchase.available === 1 ? "" : "s"} disponíve{purchase.available === 1 ? "l" : "is"}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Posição *
          </label>
          <select
            value={adSlotId}
            onChange={(e) => setAdSlotId(e.target.value)}
            className="input-field"
            required
          >
            {slots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.label} ({slot.width}x{slot.height}px)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            URL de destino *
          </label>
          <input
            type="url"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            className="input-field"
            placeholder="https://sua-empresa.com.br"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Imagem do anúncio *
          </label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-600 dark:text-gray-400"
            required
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            A imagem precisa ter exatamente as dimensões da posição escolhida.
          </p>
        </div>

        <button type="submit" className="btn-primary w-full disabled:opacity-50" disabled={submitting}>
          {submitting ? "Enviando..." : "Cadastrar anúncio"}
        </button>
      </form>

      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
