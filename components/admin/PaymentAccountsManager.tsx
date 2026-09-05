"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";
import { useSensitiveActionVerification } from "@/lib/hooks/use-sensitive-action-verification";
import type { PaymentAccountDto } from "@/lib/payment/payment-accounts";
import PaymentAccountFormModal, { type PaymentAccountFormValues } from "./PaymentAccountFormModal";
import WebhookUrlField from "./WebhookUrlField";

type PendingAction =
  | { kind: "create" }
  | { kind: "edit"; account: PaymentAccountDto }
  | { kind: "make-default"; account: PaymentAccountDto }
  | { kind: "archive"; account: PaymentAccountDto; archived: boolean };

export default function PaymentAccountsManager({ accounts }: { accounts: PaymentAccountDto[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [formValues, setFormValues] = useState<PaymentAccountFormValues | null>(null);

  const targetId = pending && pending.kind !== "create" ? pending.account.id : "new";

  const confirmEndpoint = (() => {
    if (!pending) return "";
    switch (pending.kind) {
      case "create":
        return "/api/admin/payment-accounts";
      case "edit":
        return `/api/admin/payment-accounts/${pending.account.id}`;
      case "make-default":
        return `/api/admin/payment-accounts/${pending.account.id}/make-default`;
      case "archive":
        return `/api/admin/payment-accounts/${pending.account.id}/archive`;
    }
  })();

  const verification = useSensitiveActionVerification({
    requestCodeEndpoint: "/api/admin/payment-accounts/request-code",
    confirmEndpoint,
    requestCodeBody: { targetId },
    confirmMethod: pending?.kind === "edit" ? "PATCH" : "POST",
  });

  function reset() {
    setPending(null);
    setFormOpen(false);
    setConfirmOpen(false);
    setFormValues(null);
  }

  function openCreate() {
    setPending({ kind: "create" });
    setFormValues(null);
    setFormOpen(true);
  }

  function openEdit(account: PaymentAccountDto) {
    setPending({ kind: "edit", account });
    setFormValues(null);
    setFormOpen(true);
  }

  function openMakeDefault(account: PaymentAccountDto) {
    setPending({ kind: "make-default", account });
    setConfirmOpen(true);
  }

  function openArchive(account: PaymentAccountDto, archived: boolean) {
    setPending({ kind: "archive", account, archived });
    setConfirmOpen(true);
  }

  async function handleFormSubmit(values: PaymentAccountFormValues) {
    setFormValues(values);
    setFormOpen(false);
    await verification.start();
  }

  async function handleConfirm() {
    setConfirmOpen(false);
    await verification.start();
  }

  async function handleSubmitCode(code: string) {
    if (!pending) return;
    let payload: Record<string, unknown> = {};
    if (pending.kind === "create" && formValues) {
      payload = {
        label: formValues.label,
        accessToken: formValues.accessToken,
        webhookSecret: formValues.webhookSecret,
        publicKey: formValues.publicKey,
      };
    } else if (pending.kind === "edit" && formValues) {
      payload = { label: formValues.label };
      if (formValues.accessToken) payload.accessToken = formValues.accessToken;
      if (formValues.webhookSecret) payload.webhookSecret = formValues.webhookSecret;
      if (formValues.publicKey) payload.publicKey = formValues.publicKey;
    } else if (pending.kind === "archive") {
      payload = { archived: pending.archived };
    }
    const result = await verification.submitCode(code, payload);
    if (result.ok) {
      reset();
      router.refresh();
    }
  }

  function handleCancelCode() {
    verification.cancel();
    reset();
  }

  const editingAccount = pending?.kind === "edit" ? pending.account : null;

  const confirmModal = (() => {
    if (!pending) return { title: "", message: "", tone: "default" as const };
    if (pending.kind === "make-default") {
      return {
        title: "Tornar conta padrão",
        message: `Usar "${pending.account.label}" como conta padrão da plataforma? Você receberá um código de confirmação por e-mail e WhatsApp.`,
        tone: "default" as const,
      };
    }
    if (pending.kind === "archive") {
      return {
        title: pending.archived ? "Arquivar conta" : "Desarquivar conta",
        message: pending.archived
          ? `Arquivar "${pending.account.label}"? Ela deixa de aparecer para seleção em eventos. Você receberá um código de confirmação por e-mail e WhatsApp.`
          : `Desarquivar "${pending.account.label}"? Ela volta a ficar disponível para seleção. Você receberá um código de confirmação por e-mail e WhatsApp.`,
        tone: pending.archived ? ("danger" as const) : ("default" as const),
      };
    }
    return { title: "", message: "", tone: "default" as const };
  })();

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={openCreate} className="btn-primary text-sm">
          Nova conta
        </button>
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhuma conta cadastrada.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b dark:border-gray-700">
                <th className="py-2 pr-3">Conta</th>
                <th className="py-2 pr-3">Credenciais</th>
                <th className="py-2 pr-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc) => (
                <Fragment key={acc.id}>
                  <tr className="border-t dark:border-gray-800 align-top">
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{acc.label}</span>
                        {acc.isDefault && (
                          <span className="text-xs" title="Conta padrão">
                            ⭐
                          </span>
                        )}
                        {acc.archivedAt && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500">
                            Arquivada
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-xs text-gray-500">
                      Token {acc.hasAccessToken ? "✓" : "—"} / Webhook {acc.hasWebhookSecret ? "✓" : "—"} / Public key{" "}
                      {acc.hasPublicKey ? "✓" : "—"}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex justify-end gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => openEdit(acc)}
                          className="text-xs text-primary-600 hover:underline"
                        >
                          Editar
                        </button>
                        {!acc.isDefault && !acc.archivedAt && (
                          <button
                            type="button"
                            onClick={() => openMakeDefault(acc)}
                            className="text-xs text-primary-600 hover:underline"
                          >
                            Tornar padrão
                          </button>
                        )}
                        {acc.archivedAt ? (
                          <button
                            type="button"
                            onClick={() => openArchive(acc, false)}
                            className="text-xs text-primary-600 hover:underline"
                          >
                            Desarquivar
                          </button>
                        ) : (
                          !acc.isDefault && (
                            <button
                              type="button"
                              onClick={() => openArchive(acc, true)}
                              className="text-xs text-red-600 hover:underline"
                            >
                              Arquivar
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="pb-3 pr-3">
                      <div className="rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-950/40 p-2">
                        <p className="text-[11px] font-medium text-primary-800 dark:text-primary-300 mb-1">
                          URL de webhook desta conta — cadastre no painel do Mercado Pago desta conta
                        </p>
                        <WebhookUrlField url={acc.webhookUrl} />
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PaymentAccountFormModal
        open={formOpen}
        account={editingAccount}
        loading={verification.step === "requesting"}
        onSubmit={handleFormSubmit}
        onCancel={reset}
      />

      <ConfirmModal
        open={confirmOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmLabel="Continuar"
        tone={confirmModal.tone}
        loading={verification.step === "requesting"}
        onConfirm={handleConfirm}
        onCancel={reset}
      />

      <CodeVerificationModal
        open={verification.step === "code" || verification.step === "submitting"}
        expiresAt={verification.expiresAt}
        error={verification.step !== "idle" ? verification.error : null}
        attemptsRemaining={verification.attemptsRemaining}
        loading={verification.step === "submitting"}
        resending={verification.resending}
        onSubmit={handleSubmitCode}
        onResend={verification.resend}
        onCancel={handleCancelCode}
      />

      <ErrorModal
        message={verification.step === "idle" ? verification.error : null}
        onClose={handleCancelCode}
      />
    </div>
  );
}
