"use client";

import { useRef, useState } from "react";

type TableResult = { table: string; upserted: number; errors: number; errorSamples: string[] };
type ImportResult = { tables: TableResult[]; totalUpserted: number; totalErrors: number };

type Phase = "idle" | "reading" | "uploading" | "done" | "error";

const TABLE_LABELS: Record<string, string> = {
  users: "Usuários",
  organizerProfiles: "Perfis de organizador",
  events: "Eventos",
  ticketBatches: "Lotes",
  eventCategories: "Categorias",
  eventRoutes: "Percursos",
  coupons: "Cupons",
  orders: "Pedidos",
  registrations: "Inscrições",
  payments: "Pagamentos",
  refunds: "Estornos",
};

export default function BackupImportButton() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Basic validation before upload
    if (!file.name.endsWith(".json") && file.type !== "application/json") {
      setErrorMsg("Selecione um arquivo .json gerado pelo backup deste sistema.");
      setPhase("error");
      return;
    }

    setPhase("reading");
    setErrorMsg(null);
    setResult(null);

    // Validate JSON client-side before upload
    let parsedKeys: string[];
    try {
      setPhase("reading");
      const text = await file.text();
      const obj = JSON.parse(text);
      parsedKeys = Object.keys(obj);
      const expectedKeys = ["users", "events", "registrations", "orders"];
      if (!expectedKeys.some((k) => parsedKeys.includes(k))) {
        throw new Error("Arquivo não parece ser um backup válido deste sistema.");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Arquivo JSON inválido.");
      setPhase("error");
      return;
    }

    setPhase("uploading");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/admin/backup/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? `Erro HTTP ${res.status}`);
        setPhase("error");
        return;
      }

      setResult(data as ImportResult);
      setPhase("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro de conexão.");
      setPhase("error");
    } finally {
      // Reset file input so the same file can be re-selected if needed
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const isWorking = phase === "reading" || phase === "uploading";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label
          className={`btn-secondary cursor-pointer ${isWorking ? "opacity-60 pointer-events-none" : ""}`}
        >
          {isWorking
            ? phase === "reading" ? "Lendo arquivo…" : "Importando…"
            : "Selecionar arquivo .json"}
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            disabled={isWorking}
            onChange={handleFile}
          />
        </label>
        {phase === "done" && (
          <span className="text-sm text-green-600 dark:text-green-400 font-medium">
            ✓ Importação concluída
          </span>
        )}
      </div>

      {phase === "error" && errorMsg && (
        <div className="text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
          <strong>Erro:</strong> {errorMsg}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex gap-4 text-sm">
            <span className="font-medium text-green-700 dark:text-green-400">
              {result.totalUpserted.toLocaleString("pt-BR")} registros importados
            </span>
            {result.totalErrors > 0 && (
              <span className="font-medium text-red-600 dark:text-red-400">
                {result.totalErrors} erros
              </span>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase text-gray-500">
                  <th className="px-4 py-2">Tabela</th>
                  <th className="px-4 py-2 text-right">Importados</th>
                  <th className="px-4 py-2 text-right">Erros</th>
                </tr>
              </thead>
              <tbody>
                {result.tables
                  .filter((t) => t.upserted > 0 || t.errors > 0)
                  .map((t) => (
                    <tr key={t.table} className="border-t dark:border-gray-700">
                      <td className="px-4 py-2 font-medium">{TABLE_LABELS[t.table] ?? t.table}</td>
                      <td className="px-4 py-2 text-right text-green-700 dark:text-green-400">
                        {t.upserted.toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {t.errors > 0 ? (
                          <span className="text-red-600 dark:text-red-400" title={t.errorSamples.join("\n")}>
                            {t.errors}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {result.tables.some((t) => t.errorSamples.length > 0) && (
            <details className="text-xs text-red-600 dark:text-red-400">
              <summary className="cursor-pointer hover:underline">Ver amostra de erros</summary>
              <ul className="mt-2 space-y-1 list-disc list-inside">
                {result.tables.flatMap((t) =>
                  t.errorSamples.map((e, i) => (
                    <li key={`${t.table}-${i}`}><span className="font-medium">{t.table}:</span> {e}</li>
                  ))
                )}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
