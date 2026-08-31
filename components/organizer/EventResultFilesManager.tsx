"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import FileUploadInput from "@/components/organizer/FileUploadInput";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

interface ResultFile {
  id: string;
  label: string;
  fileUrl: string;
}

interface Props {
  eventId: string;
  slug: string;
  initialSubtitle: string | null;
  initialFiles: ResultFile[];
}

export default function EventResultFilesManager({ eventId, slug, initialSubtitle, initialFiles }: Props) {
  const router = useRouter();
  const [subtitle, setSubtitle] = useState(initialSubtitle ?? "");
  const [savingSubtitle, setSavingSubtitle] = useState(false);
  const [subtitleSaved, setSubtitleSaved] = useState(false);

  const [newLabel, setNewLabel] = useState("");
  const [newFileUrl, setNewFileUrl] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [uploadKey, setUploadKey] = useState(0);

  const [deleting, setDeleting] = useState<ResultFile | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);

  async function saveSubtitle() {
    setSavingSubtitle(true);
    setSubtitleSaved(false);
    const res = await fetch(`/api/events/${eventId}/result-files`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultsSubtitle: subtitle }),
    });
    setSavingSubtitle(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao salvar o texto.");
      return;
    }
    setSubtitleSaved(true);
    router.refresh();
  }

  async function addFile(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim() || !newFileUrl) return;
    setAdding(true);
    const res = await fetch(`/api/events/${eventId}/result-files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel.trim(), fileUrl: newFileUrl, fileName: newFileName || "resultado.pdf" }),
    });
    setAdding(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao adicionar o resultado.");
      return;
    }
    setNewLabel("");
    setNewFileUrl(null);
    setNewFileName("");
    setUploadKey((k) => k + 1);
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeletingBusy(true);
    const res = await fetch(`/api/events/${eventId}/result-files/${deleting.id}`, { method: "DELETE" });
    setDeletingBusy(false);
    setDeleting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao excluir.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="card space-y-5">
      <div>
        <h2 className="font-semibold">Página pública de resultados</h2>
        <a
          href={`/eventos/${slug}/resultados`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary-600 hover:underline"
        >
          Ver página pública de resultados ↗
        </a>
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Texto de destaque (opcional)
        </label>
        <p className="text-xs text-gray-500">Aparece grande abaixo do banner. Ex.: 5KM. Deixe em branco para não mostrar.</p>
        <div className="flex gap-2">
          <input
            value={subtitle}
            onChange={(e) => { setSubtitle(e.target.value); setSubtitleSaved(false); }}
            maxLength={120}
            className="input flex-1"
            placeholder="5KM"
          />
          <button type="button" onClick={saveSubtitle} disabled={savingSubtitle} className="btn-secondary text-sm">
            {savingSubtitle ? "Salvando..." : "Salvar"}
          </button>
        </div>
        {subtitleSaved && <p className="text-xs text-green-600">Salvo.</p>}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">PDFs cadastrados</h3>
        {initialFiles.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum PDF cadastrado ainda.</p>
        ) : (
          <ul className="divide-y dark:divide-gray-700 border dark:border-gray-700 rounded-lg">
            {initialFiles.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <a href={f.fileUrl} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline truncate">
                  {f.label}
                </a>
                <button
                  type="button"
                  onClick={() => setDeleting(f)}
                  className="text-xs text-red-600 hover:underline flex-shrink-0"
                >
                  Excluir
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={addFile} className="space-y-3 border-t dark:border-gray-700 pt-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Adicionar resultado</h3>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Nome de exibição</label>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            maxLength={80}
            className="input w-full"
            placeholder="Categoria Geral Masculina"
          />
        </div>
        <FileUploadInput
          key={uploadKey}
          purpose="result_pdf"
          accept="application/pdf"
          label="PDF do resultado"
          currentUrl={newFileUrl}
          onUploaded={(url) => { setNewFileUrl(url); setNewFileName(url.split("/").pop() ?? "resultado.pdf"); }}
          onRemoved={() => { setNewFileUrl(null); setNewFileName(""); }}
        />
        <button
          type="submit"
          disabled={adding || !newLabel.trim() || !newFileUrl}
          className="btn-primary text-sm"
        >
          {adding ? "Adicionando..." : "Adicionar"}
        </button>
      </form>

      <ConfirmModal
        open={deleting !== null}
        title="Excluir resultado"
        message={`Excluir "${deleting?.label ?? ""}" da página pública?`}
        confirmLabel="Excluir"
        tone="danger"
        loading={deletingBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
