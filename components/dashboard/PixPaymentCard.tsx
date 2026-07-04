"use client";

import { useState } from "react";
import QRCode from "react-qr-code";

interface PixPaymentCardProps {
  pixQrCodeText: string;
  expiresAt?: string | null;
}

export default function PixPaymentCard({ pixQrCodeText, expiresAt }: PixPaymentCardProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pixQrCodeText);
      } else {
        // Fallback para navegadores/contextos sem suporte à Clipboard API moderna
        // (ex.: sem HTTPS ou API indisponível) — evita falha silenciosa do botão.
        const textarea = document.createElement("textarea");
        textarea.value = pixQrCodeText;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!copied) throw new Error("Fallback copy command failed");
      }
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    } finally {
      setTimeout(() => setCopyStatus("idle"), 2000);
    }
  }

  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100">Pague via Pix</h3>
      <div className="flex justify-center p-4 bg-white rounded-lg border">
        <QRCode value={pixQrCodeText} size={200} />
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">Ou copie o código abaixo e cole no app do seu banco:</p>
      <div className="bg-gray-50 dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-3 font-mono text-xs break-all select-all">
        {pixQrCodeText}
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="btn-secondary w-full text-sm"
      >
        {copyStatus === "copied"
          ? "Copiado!"
          : copyStatus === "error"
            ? "Não foi possível copiar — selecione o texto acima"
            : "Copiar código Pix"}
      </button>
      {expiresAt && (
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          Expira em: {new Date(expiresAt).toLocaleString("pt-BR")}
        </p>
      )}
    </div>
  );
}
