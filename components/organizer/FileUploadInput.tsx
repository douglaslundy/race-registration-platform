"use client";

import { useRef, useState } from "react";

interface Props {
  purpose: "banner" | "regulation" | "kit_info";
  accept: string;
  label: string;
  currentUrl?: string | null;
  onUploaded: (url: string) => void;
}

export default function FileUploadInput({ purpose, accept, label, currentUrl, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl ?? null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("purpose", purpose);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao enviar arquivo");

      setPreviewUrl(data.fileUrl);
      onUploaded(data.fileUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">{label}</label>

      {previewUrl && purpose === "banner" && (
        <div className="relative w-full h-32 rounded-lg overflow-hidden border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Banner" className="w-full h-full object-cover" />
        </div>
      )}

      {previewUrl && purpose === "regulation" && (
        <a href={previewUrl} target="_blank" rel="noreferrer" className="text-sm text-primary-600 underline">
          Ver arquivo atual
        </a>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          {uploading ? "Enviando…" : previewUrl ? "Substituir" : "Selecionar arquivo"}
        </button>
        {previewUrl && (
          <span className="text-xs text-green-600 font-medium">Arquivo carregado</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="hidden"
      />

      {error && <p className="text-red-500 text-xs">{error}</p>}
    </div>
  );
}
