"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

export default function EditPrivateAdLinkButton({
  id,
  currentUrl,
  isApproved,
}: {
  id: string;
  currentUrl: string;
  isApproved: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSave(note?: string) {
    setLoading(true);
    const res = await fetch(`/api/anunciante/ads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUrl: note }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao editar link");
      setLoading(false);
      return;
    }
    setConfirming(false);
    setLoading(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="btn-secondary py-1.5 px-3 text-sm"
      >
        Editar link
      </button>

      <ConfirmModal
        open={confirming}
        title="Editar link do anúncio"
        message={
          isApproved
            ? "Este anúncio já está aprovado. Ao trocar o link, ele volta a aguardar aprovação.\n\nInforme a nova URL de destino:"
            : "Informe a nova URL de destino:"
        }
        showNoteField
        noteRequired
        notePlaceholder="https://minhaempresa.com"
        noteDefaultValue={currentUrl}
        loading={loading}
        onConfirm={handleSave}
        onCancel={() => setConfirming(false)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
