"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ErrorModal from "@/components/ui/ErrorModal";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";
import { useSensitiveActionVerification } from "@/lib/hooks/use-sensitive-action-verification";
import type { PaymentAccountDto } from "@/lib/payment/payment-accounts";

export default function EventPaymentAccountSelect({
  eventId,
  currentAccountId,
  currentAccountArchived,
  accounts,
  defaultLabel,
}: {
  eventId: string;
  currentAccountId: string | null;
  currentAccountArchived: boolean;
  accounts: PaymentAccountDto[];
  defaultLabel: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(currentAccountId ?? "");

  const verification = useSensitiveActionVerification({
    requestCodeEndpoint: `/api/admin/events/${eventId}/payment-account/request-code`,
    confirmEndpoint: `/api/admin/events/${eventId}/payment-account`,
  });

  const available = accounts.filter((a) => !a.archivedAt);
  const dirty = selected !== (currentAccountId ?? "");
  const busy = verification.step === "requesting" || verification.step === "submitting";

  async function handleSubmitCode(code: string) {
    const result = await verification.submitCode(code, {
      paymentAccountId: selected || null,
    });
    if (result.ok) router.refresh();
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Conta Mercado Pago do evento
      </label>

      {currentAccountArchived && (
        <p className="text-xs text-red-600 dark:text-red-400">
          A conta atualmente vinculada a este evento está arquivada. Escolha outra conta ou volte para o padrão da
          plataforma.
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={busy}
          className="input-field w-full md:w-80"
        >
          <option value="">(padrão da plataforma: {defaultLabel})</option>
          {available.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => verification.start()}
          disabled={!dirty || busy}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {busy ? "Salvando..." : "Salvar"}
        </button>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Define qual conta recebe os pagamentos deste evento. Alterações valem para novos pedidos. Você receberá um
        código de confirmação por e-mail e WhatsApp.
      </p>

      <CodeVerificationModal
        open={verification.step === "code" || verification.step === "submitting"}
        expiresAt={verification.expiresAt}
        error={verification.step !== "idle" ? verification.error : null}
        attemptsRemaining={verification.attemptsRemaining}
        loading={verification.step === "submitting"}
        resending={verification.resending}
        onSubmit={handleSubmitCode}
        onResend={verification.resend}
        onCancel={verification.cancel}
      />

      <ErrorModal
        message={verification.step === "idle" ? verification.error : null}
        onClose={verification.cancel}
      />
    </div>
  );
}
