"use client";

import { useEffect, useState } from "react";
import type { PaymentAccountDto } from "@/lib/payment/payment-accounts";
import WebhookUrlField from "./WebhookUrlField";

export interface PaymentAccountFormValues {
  label: string;
  accessToken: string;
  webhookSecret: string;
  publicKey: string;
}

export default function PaymentAccountFormModal({
  open,
  account,
  loading = false,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  /** Conta em edição; ausente/null = criação. */
  account?: PaymentAccountDto | null;
  loading?: boolean;
  onSubmit: (values: PaymentAccountFormValues) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(account);
  const [label, setLabel] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [publicKey, setPublicKey] = useState("");

  useEffect(() => {
    if (open) {
      setLabel(account?.label ?? "");
      setAccessToken("");
      setWebhookSecret("");
      setPublicKey("");
    }
  }, [open, account]);

  if (!open) return null;

  const credPlaceholder = isEdit ? "Deixe em branco para manter o atual" : "";
  const canSubmit =
    label.trim().length > 0 &&
    (isEdit || (accessToken.trim().length > 0 && webhookSecret.trim().length > 0));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {isEdit ? "Editar conta Mercado Pago" : "Nova conta Mercado Pago"}
        </h2>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="input-field w-full"
              placeholder="Ex.: Conta principal"
              autoComplete="off"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Access Token (backend)
            </label>
            <input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              className="input-field w-full"
              placeholder={credPlaceholder || "Cole a access token"}
              autoComplete="off"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Webhook Secret
            </label>
            <input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              className="input-field w-full"
              placeholder={credPlaceholder || "Cole o segredo do webhook"}
              autoComplete="off"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Public Key (frontend)
            </label>
            <input
              type="password"
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              className="input-field w-full"
              placeholder={credPlaceholder || "Cole a public key (opcional)"}
              autoComplete="off"
            />
          </div>

          {isEdit && account && (
            <div className="rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-950/40 p-3">
              <p className="text-xs font-medium text-primary-800 dark:text-primary-300 mb-1">URL do webhook desta conta</p>
              <WebhookUrlField url={account.webhookUrl} />
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
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
            onClick={() =>
              onSubmit({
                label: label.trim(),
                accessToken: accessToken.trim(),
                webhookSecret: webhookSecret.trim(),
                publicKey: publicKey.trim(),
              })
            }
            disabled={loading || !canSubmit}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {loading ? "Processando..." : "Continuar"}
          </button>
        </div>
      </div>
    </div>
  );
}
