"use client";

import { useEffect, useState } from "react";

export default function CodeVerificationModal({
  open,
  title = "Digite o código de verificação",
  expiresAt,
  error,
  attemptsRemaining,
  loading = false,
  resending = false,
  onSubmit,
  onResend,
  onCancel,
}: {
  open: boolean;
  title?: string;
  expiresAt: Date | null;
  error?: string | null;
  attemptsRemaining?: number | null;
  loading?: boolean;
  resending?: boolean;
  onSubmit: (code: string) => void;
  onResend: () => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!open) setCode("");
  }, [open]);

  useEffect(() => {
    if (!expiresAt) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (!open) return null;

  const expired = secondsLeft === 0;
  const minutes = secondsLeft !== null ? Math.floor(secondsLeft / 60) : 0;
  const seconds = secondsLeft !== null ? secondsLeft % 60 : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => !loading && onCancel()}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Enviamos um código de 6 dígitos para o seu e-mail (e WhatsApp, se cadastrado). Digite abaixo para confirmar.
        </p>

        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          className="input-field text-center text-2xl tracking-[0.5em] mt-4"
          autoFocus
        />

        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {typeof attemptsRemaining === "number" && attemptsRemaining > 0 && (
          <p className="mt-1 text-xs text-gray-500">Restam {attemptsRemaining} tentativa(s).</p>
        )}

        <div className="mt-2 text-xs text-gray-500">
          {secondsLeft !== null && !expired && (
            <span>Código expira em {minutes}:{String(seconds).padStart(2, "0")}</span>
          )}
          {expired && <span className="text-red-600 dark:text-red-400">Código expirado — solicite um novo.</span>}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onResend}
            disabled={resending || loading}
            className="text-xs text-primary-600 hover:underline disabled:opacity-50"
          >
            {resending ? "Reenviando..." : "Reenviar código"}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onSubmit(code)}
              disabled={loading || code.length !== 6 || expired}
              className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
            >
              {loading ? "Confirmando..." : "Confirmar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
