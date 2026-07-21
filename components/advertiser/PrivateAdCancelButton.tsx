"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

export default function PrivateAdCancelButton({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleCancel() {
    setLoading(true);
    const res = await fetch(`/api/anunciante/ads/${id}/cancel`, { method: "POST" });
    setLoading(false);
    setConfirming(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao cancelar anúncio.");
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className="btn-secondary py-1.5 px-3 text-sm text-red-700 border-red-200 hover:bg-red-50"
      >
        Cancelar
      </button>
      <ConfirmModal
        open={confirming}
        title="Cancelar anúncio"
        message="Tem certeza que deseja cancelar este anúncio? A vaga ficará disponível para cadastrar outro."
        confirmLabel="Cancelar anúncio"
        tone="danger"
        loading={loading}
        onConfirm={handleCancel}
        onCancel={() => setConfirming(false)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
