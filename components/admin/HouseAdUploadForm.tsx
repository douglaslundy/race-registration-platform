"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ErrorModal from "@/components/ui/ErrorModal";

interface Props {
  slotId: string;
  width: number;
  height: number;
  initialImageUrl: string | null;
  initialTargetUrl: string | null;
}

export default function HouseAdUploadForm({ slotId, width, height, initialImageUrl, initialTargetUrl }: Props) {
  const router = useRouter();
  const [targetUrl, setTargetUrl] = useState(initialTargetUrl ?? "");
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
      formData.append("targetUrl", targetUrl);
      formData.append("image", file);

      const res = await fetch(`/api/admin/ads/slots/${slotId}/house-ad`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Erro ao salvar anúncio da casa");
        return;
      }

      setFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar anúncio da casa");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3 border-t pt-3 mt-2 dark:border-gray-700">
        {initialImageUrl && (
          <img src={initialImageUrl} alt="Anúncio da casa atual" className="w-20 h-14 object-cover rounded border border-gray-200 dark:border-gray-700" />
        )}
        <input
          type="url"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="URL de destino"
          className="input-field text-sm py-1 w-56"
          required
        />
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm text-gray-600 dark:text-gray-400"
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">{width}×{height}px exatos</span>
        <button type="submit" disabled={submitting} className="btn-primary py-1 px-3 text-sm disabled:opacity-50">
          {submitting ? "Enviando…" : "Salvar anúncio da casa"}
        </button>
      </form>
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
