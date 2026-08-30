"use client";

import { useRef, useState } from "react";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";

type TableResult = { table: string; restored: number };
type ImportResult = { tables: TableResult[]; totalRestored: number };

type Phase = "idle" | "confirming" | "snapshotting" | "verifying" | "uploading" | "done" | "error";

const TABLE_LABELS: Record<string, string> = {
  users: "Usuários",
  athleteProfiles: "Perfis de atleta",
  organizerProfiles: "Perfis de organizador",
  events: "Eventos",
  eventRoutes: "Percursos",
  eventCategories: "Categorias",
  ticketBatches: "Lotes",
  transferPayouts: "Repasses",
  coupons: "Cupons",
  orders: "Pedidos",
  registrations: "Inscrições",
  payments: "Pagamentos",
  refunds: "Estornos",
  resultImports: "Importações de resultado",
  raceResults: "Resultados",
  fileAssets: "Arquivos",
  auditLogs: "Logs de auditoria",
  platformSettings: "Configurações da plataforma",
  alertLogs: "Logs de alerta",
};

const TABLE_KEYS = Object.keys(TABLE_LABELS);
const CONFIRM_WORD = "CONFIRMAR";

function countsFromBackup(backup: Record<string, unknown>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of TABLE_KEYS) {
    const value = backup[key];
    counts[key] = Array.isArray(value) ? value.length : 0;
  }
  return counts;
}

async function downloadCurrentSnapshot() {
  const res = await fetch("/api/admin/backup");
  if (!res.ok) throw new Error("Falha ao gerar backup de segurança do estado atual");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const now = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const a = document.createElement("a");
  a.href = url;
  a.download = `pre-restore-backup-${now}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function BackupImportButton() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<Date | null>(null);
  const [submittingCode, setSubmittingCode] = useState(false);
  const [resendingCode, setResendingCode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function resetToIdle() {
    setPhase("idle");
    setPendingFile(null);
    setCounts(null);
    setConfirmText("");
    setVerificationId(null);
    setCodeError(null);
    setAttemptsRemaining(null);
    setCodeExpiresAt(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function requestImportCode(): Promise<boolean> {
    const res = await fetch("/api/admin/backup/import/request-code", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(typeof data.error === "string" ? data.error : "Não foi possível enviar o código.");
      setPhase("error");
      return false;
    }
    setVerificationId(data.verificationId ?? null);
    setCodeError(null);
    setAttemptsRemaining(null);
    setCodeExpiresAt(new Date(Date.now() + 10 * 60 * 1000));
    return true;
  }

  async function handleResendCode() {
    setResendingCode(true);
    await requestImportCode();
    setResendingCode(false);
  }

  function clearPending() {
    setPendingFile(null);
    setCounts(null);
    setConfirmText("");
    setVerificationId(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleSubmitCode(code: string) {
    if (!pendingFile || !verificationId) return;
    setSubmittingCode(true);
    setCodeError(null);
    setPhase("uploading");

    let res: Response;
    try {
      const formData = new FormData();
      formData.append("file", pendingFile);
      formData.append("verificationId", verificationId);
      formData.append("code", code);
      res = await fetch("/api/admin/backup/import", { method: "POST", body: formData });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro de conexão.");
      setPhase("error");
      setSubmittingCode(false);
      clearPending();
      return;
    }

    const data = await res.json().catch(() => ({}));
    setSubmittingCode(false);

    if (!res.ok) {
      // Código incorreto/expirado — mantém o modal aberto pra nova tentativa.
      if (res.status === 400 && typeof data.attemptsRemaining !== "undefined") {
        setCodeError(typeof data.error === "string" ? data.error : "Código inválido.");
        setAttemptsRemaining(
          typeof data.attemptsRemaining === "number" ? data.attemptsRemaining : null,
        );
        setPhase("verifying");
        return;
      }
      setErrorMsg(typeof data.error === "string" ? data.error : `Erro HTTP ${res.status}`);
      setPhase("error");
      clearPending();
      return;
    }

    setResult(data as ImportResult);
    setPhase("done");
    clearPending();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    setResult(null);

    if (!file.name.endsWith(".json") && file.type !== "application/json") {
      setErrorMsg("Selecione um arquivo .json gerado pelo backup deste sistema.");
      setPhase("error");
      return;
    }

    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      if (!TABLE_KEYS.some((k) => Object.prototype.hasOwnProperty.call(obj, k))) {
        throw new Error("Arquivo não parece ser um backup válido deste sistema.");
      }
      setCounts(countsFromBackup(obj));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Arquivo JSON inválido.");
      setPhase("error");
      return;
    }

    setPendingFile(file);
    setConfirmText("");
    setPhase("confirming");
  }

  async function handleConfirm() {
    if (!pendingFile || confirmText !== CONFIRM_WORD) return;

    setPhase("snapshotting");
    setErrorMsg(null);

    try {
      await downloadCurrentSnapshot();
    } catch (err) {
      setErrorMsg(
        (err instanceof Error ? err.message : "Falha ao gerar backup de segurança") +
          " — importação cancelada, nada foi apagado.",
      );
      setPhase("error");
      return;
    }

    // Pede o código 2FA; o upload real acontece em handleSubmitCode.
    const ok = await requestImportCode();
    if (ok) setPhase("verifying");
  }

  function handleCancelCode() {
    setCodeError(null);
    setAttemptsRemaining(null);
    setCodeExpiresAt(null);
    setPhase("error");
    setErrorMsg("Importação cancelada — nenhum dado foi alterado.");
    clearPending();
  }

  const isWorking = phase === "snapshotting" || phase === "verifying" || phase === "uploading";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label
          className={`btn-secondary cursor-pointer ${isWorking || phase === "confirming" ? "opacity-60 pointer-events-none" : ""}`}
        >
          Selecionar arquivo .json
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            disabled={isWorking || phase === "confirming"}
            onChange={handleFile}
          />
        </label>
        {phase === "done" && (
          <span className="text-sm text-green-600 dark:text-green-400 font-medium">
            ✓ Restauração concluída
          </span>
        )}
      </div>

      {phase === "confirming" && counts && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 space-y-3">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">
            Isso vai apagar todos os dados atuais e substituir pelo conteúdo deste arquivo. Um
            backup do estado atual será baixado automaticamente antes de apagar.
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-red-800 dark:text-red-300">
            {TABLE_KEYS.filter((k) => counts[k] > 0).map((k) => (
              <div key={k} className="flex justify-between">
                <span>{TABLE_LABELS[k]}</span>
                <span className="font-medium">{counts[k].toLocaleString("pt-BR")}</span>
              </div>
            ))}
          </div>
          <label className="block text-xs font-medium text-red-800 dark:text-red-300">
            Digite {CONFIRM_WORD} para confirmar
            <input
              type="text"
              className="input mt-1"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={resetToIdle}>
              Cancelar
            </button>
            <button
              type="button"
              className="text-sm px-4 py-2 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              disabled={confirmText !== CONFIRM_WORD}
              onClick={handleConfirm}
            >
              Prosseguir e apagar
            </button>
          </div>
        </div>
      )}

      {phase === "snapshotting" && (
        <p className="text-sm text-gray-500">Baixando backup de segurança do estado atual…</p>
      )}
      {phase === "uploading" && (
        <p className="text-sm text-gray-500">Restaurando dados do backup…</p>
      )}

      {phase === "error" && errorMsg && (
        <div className="text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
          <strong>Erro:</strong> {errorMsg}
        </div>
      )}

      <CodeVerificationModal
        open={phase === "verifying" || (phase === "uploading" && submittingCode)}
        title="Confirmar restauração de backup"
        expiresAt={codeExpiresAt}
        error={codeError}
        attemptsRemaining={attemptsRemaining}
        loading={submittingCode}
        resending={resendingCode}
        onSubmit={handleSubmitCode}
        onResend={handleResendCode}
        onCancel={handleCancelCode}
      />

      {result && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            {result.totalRestored.toLocaleString("pt-BR")} registros restaurados
          </p>

          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase text-gray-500">
                  <th className="px-4 py-2">Tabela</th>
                  <th className="px-4 py-2 text-right">Restaurados</th>
                </tr>
              </thead>
              <tbody>
                {result.tables
                  .filter((t) => t.restored > 0)
                  .map((t) => (
                    <tr key={t.table} className="border-t dark:border-gray-700">
                      <td className="px-4 py-2 font-medium">{TABLE_LABELS[t.table] ?? t.table}</td>
                      <td className="px-4 py-2 text-right text-green-700 dark:text-green-400">
                        {t.restored.toLocaleString("pt-BR")}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
