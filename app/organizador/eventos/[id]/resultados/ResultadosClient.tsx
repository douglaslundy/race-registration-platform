"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";

export default function ResultadosPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ importId: string; rowCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);

    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch(`/api/events/${id}/results`, { method: "POST", body: fd });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Erro ao importar resultados");
    } else {
      setResult(data);
    }
    setUploading(false);
  }

  async function handlePublish() {
    if (!result) return;
    await fetch(`/api/events/${id}/results`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ importId: result.importId }),
    });
    router.push(`/organizador/eventos/${id}`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <h2 className="font-semibold">Importar via planilha (CSV)</h2>

      <div className="card space-y-3">
        <h2 className="font-semibold">Formato do CSV</h2>
        <p className="text-sm text-gray-600">O arquivo deve ter as seguintes colunas:</p>
        <div className="bg-gray-50 rounded-lg p-3 font-mono text-xs">
          bib_number, athlete_name, route, category, gender, gross_time, net_time, placement_general, placement_category, placement_gender
        </div>
        <p className="text-xs text-gray-500">As colunas <strong>bib_number</strong> e <strong>athlete_name</strong> são obrigatórias.</p>
      </div>

      {!result ? (
        <form onSubmit={handleUpload} className="card space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Arquivo CSV</label>
            <input
              type="file"
              accept=".csv"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border file:border-gray-300 file:text-sm file:bg-gray-50 hover:file:bg-gray-100"
            />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <button type="submit" disabled={uploading || !file} className="btn-primary w-full">
            {uploading ? "Importando..." : "Importar resultados"}
          </button>
        </form>
      ) : (
        <div className="card space-y-4 text-center">
          <p className="text-4xl">✅</p>
          <p className="font-semibold">{result.rowCount} resultados importados com sucesso!</p>
          <p className="text-sm text-gray-500">Os resultados ainda não estão visíveis ao público. Clique em &quot;Publicar&quot; para torná-los visíveis.</p>
          <div className="flex gap-3">
            <button onClick={handlePublish} className="btn-primary flex-1">Publicar resultados</button>
            <button onClick={() => setResult(null)} className="btn-secondary flex-1">Importar outro arquivo</button>
          </div>
        </div>
      )}
    </div>
  );
}
