"use client";

import { useState } from "react";

type Phase = "idle" | "downloading" | "done" | "error";

export default function BackupDownloadButton() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [bytesReceived, setBytesReceived] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleDownload() {
    setPhase("downloading");
    setBytesReceived(0);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/admin/backup");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error || `Erro HTTP ${res.status}`);
        setPhase("error");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Stream não disponível");

      const contentDisposition = res.headers.get("content-disposition") ?? "";
      const match = contentDisposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `backup-${new Date().toISOString().slice(0, 10)}.json`;

      const chunks: BlobPart[] = [];
      let total = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
        total += value.length;
        setBytesReceived(total);
      }

      const blob = new Blob(chunks, { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setPhase("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro desconhecido");
      setPhase("error");
    }
  }

  function formatBytes(b: number) {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(2)} MB`;
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handleDownload}
        disabled={phase === "downloading"}
        className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {phase === "downloading" ? "Gerando backup…" : "Baixar backup (JSON)"}
      </button>

      {phase === "downloading" && (
        <div className="space-y-2">
          <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-primary-500 rounded-full animate-pulse w-full" />
          </div>
          <p className="text-sm text-gray-500">
            Recebido: <span className="font-medium text-gray-700 dark:text-gray-300">{formatBytes(bytesReceived)}</span>
            {" "}— aguarde o download iniciar automaticamente.
          </p>
        </div>
      )}

      {phase === "done" && (
        <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3">
          <span>✓</span>
          <span>Backup concluído — {formatBytes(bytesReceived)} baixados. Verifique sua pasta de downloads.</span>
        </div>
      )}

      {phase === "error" && (
        <div className="text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
          <strong>Erro:</strong> {errorMsg}
        </div>
      )}
    </div>
  );
}
