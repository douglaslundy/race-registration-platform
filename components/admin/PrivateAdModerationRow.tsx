"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

interface Props {
  id: string;
  imageUrl: string;
  targetUrl: string;
  companyName: string;
}

export default function PrivateAdModerationRow({ id, imageUrl, targetUrl, companyName }: Props) {
  const [rejecting, setRejecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleApprove() {
    setLoading(true);
    const res = await fetch(`/api/admin/ads/private/${id}/approve`, {
      method: "POST",
    });
    setLoading(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao aprovar anúncio.");
  }

  async function handleReject(reason?: string) {
    setLoading(true);
    const res = await fetch(`/api/admin/ads/private/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setLoading(false);
    setRejecting(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao rejeitar anúncio.");
  }

  return (
    <div className="py-4 first:pt-0 last:pb-0 flex flex-wrap items-center gap-4">
      <img src={imageUrl} alt={`Anúncio de ${companyName}`} className="w-32 h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-700" />
      <div className="flex-1 min-w-0 space-y-1">
        <p className="font-medium">{companyName}</p>
        <a
          href={targetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline break-all"
        >
          {targetUrl}
        </a>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          disabled={loading}
          className="btn-primary py-1.5 px-3 text-sm disabled:opacity-50"
        >
          {loading ? "Processando..." : "Aprovar"}
        </button>
        <button
          onClick={() => setRejecting(true)}
          disabled={loading}
          className="btn-secondary py-1.5 px-3 text-sm text-red-700 border-red-200 hover:bg-red-50 disabled:opacity-50"
        >
          Rejeitar
        </button>
      </div>

      <ConfirmModal
        open={rejecting}
        title="Rejeitar anúncio"
        message="Informe o motivo da rejeição. O anunciante verá esse motivo."
        confirmLabel="Rejeitar"
        tone="danger"
        loading={loading}
        showNoteField
        noteRequired
        notePlaceholder="Motivo da rejeição"
        onConfirm={handleReject}
        onCancel={() => setRejecting(false)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
