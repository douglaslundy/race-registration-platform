"use client";

import { useCallback, useState } from "react";

type Step = "idle" | "requesting" | "code" | "submitting";

export function useSensitiveActionVerification(params: {
  requestCodeEndpoint: string;
  confirmEndpoint: string;
  /** Corpo JSON opcional enviado no POST de request-code (ex.: `{ targetId }`). */
  requestCodeBody?: Record<string, unknown>;
  /** Método HTTP do confirmEndpoint. Padrão: "POST". */
  confirmMethod?: string;
}) {
  const [step, setStep] = useState<Step>("idle");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [resending, setResending] = useState(false);

  const requestCodeBodyJson = params.requestCodeBody ? JSON.stringify(params.requestCodeBody) : null;

  const requestCode = useCallback(async () => {
    setError(null);
    let res: Response;
    try {
      res = await fetch(
        params.requestCodeEndpoint,
        requestCodeBodyJson
          ? { method: "POST", headers: { "Content-Type": "application/json" }, body: requestCodeBodyJson }
          : { method: "POST" },
      );
    } catch {
      setError("Erro de conexão. Tente novamente.");
      return false;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Não foi possível enviar o código.");
      return false;
    }
    setVerificationId(data.verificationId);
    setExpiresAt(new Date(Date.now() + 10 * 60 * 1000));
    setAttemptsRemaining(null);
    return true;
  }, [params.requestCodeEndpoint, requestCodeBodyJson]);

  const start = useCallback(async () => {
    setStep("requesting");
    const ok = await requestCode();
    setStep(ok ? "code" : "idle");
  }, [requestCode]);

  const resend = useCallback(async () => {
    setResending(true);
    await requestCode();
    setResending(false);
  }, [requestCode]);

  const submitCode = useCallback(
    async (code: string, extraBody?: Record<string, unknown>): Promise<{ ok: boolean; response?: Response }> => {
      if (!verificationId) return { ok: false };
      setStep("submitting");
      setError(null);
      let res: Response;
      try {
        res = await fetch(params.confirmEndpoint, {
          method: params.confirmMethod ?? "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verificationId, code, ...extraBody }),
        });
      } catch {
        setError("Erro de conexão. Tente novamente.");
        setStep("code");
        return { ok: false };
      }
      if (res.ok) {
        setStep("idle");
        return { ok: true, response: res };
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao confirmar o código.");
      setAttemptsRemaining(typeof data.attemptsRemaining === "number" ? data.attemptsRemaining : null);
      setStep("code");
      return { ok: false, response: res };
    },
    [verificationId, params.confirmEndpoint, params.confirmMethod],
  );

  const cancel = useCallback(() => {
    setStep("idle");
    setVerificationId(null);
    setError(null);
    setAttemptsRemaining(null);
    setExpiresAt(null);
  }, []);

  return { step, error, attemptsRemaining, expiresAt, resending, start, submitCode, resend, cancel };
}
