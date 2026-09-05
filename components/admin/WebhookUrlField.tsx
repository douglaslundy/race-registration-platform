"use client";

import { useState } from "react";

/**
 * Mostra a URL de webhook de uma conta de pagamento com botão de copiar. Cada conta Mercado Pago
 * aponta o webhook do seu próprio painel para esta URL (o id da conta faz parte dela). Usado na
 * lista de contas e no modal de edição.
 */
export default function WebhookUrlField({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <code className="text-xs break-all text-primary-900 dark:text-primary-200 flex-1">{url}</code>
      <button
        type="button"
        onClick={copy}
        className="text-xs px-2 py-1 rounded border border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900 shrink-0"
      >
        {copied ? "Copiado!" : "Copiar"}
      </button>
    </div>
  );
}
