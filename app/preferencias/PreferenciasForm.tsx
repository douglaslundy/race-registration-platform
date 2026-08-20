"use client";

import { useState } from "react";

type Field = "receiveEventMessages" | "receivePromotionalMessages";

export default function PreferenciasForm({
  initialReceiveEventMessages,
  initialReceivePromotionalMessages,
}: {
  initialReceiveEventMessages: boolean;
  initialReceivePromotionalMessages: boolean;
}) {
  const [receiveEventMessages, setReceiveEventMessages] = useState(initialReceiveEventMessages);
  const [receivePromotionalMessages, setReceivePromotionalMessages] = useState(
    initialReceivePromotionalMessages,
  );
  const [savingField, setSavingField] = useState<Field | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(field: Field, value: boolean) {
    setError(null);
    setSavingField(field);
    const res = await fetch("/api/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });

    if (!res.ok) {
      setError("Não foi possível salvar. Tente novamente.");
      if (field === "receiveEventMessages") setReceiveEventMessages(!value);
      else setReceivePromotionalMessages(!value);
    }
    setSavingField(null);
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={receiveEventMessages}
          disabled={savingField === "receiveEventMessages"}
          onChange={(e) => {
            setReceiveEventMessages(e.target.checked);
            save("receiveEventMessages", e.target.checked);
          }}
          className="mt-1"
        />
        <span>
          <span className="block font-medium text-gray-900 dark:text-gray-100">
            Mensagens sobre minhas inscrições e eventos
          </span>
          <span className="block text-sm text-gray-600 dark:text-gray-400">
            Confirmação de inscrição, pagamento pendente/confirmado e outros avisos operacionais.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={receivePromotionalMessages}
          disabled={savingField === "receivePromotionalMessages"}
          onChange={(e) => {
            setReceivePromotionalMessages(e.target.checked);
            save("receivePromotionalMessages", e.target.checked);
          }}
          className="mt-1"
        />
        <span>
          <span className="block font-medium text-gray-900 dark:text-gray-100">
            Mensagens promocionais
          </span>
          <span className="block text-sm text-gray-600 dark:text-gray-400">
            Campanhas e novidades enviadas pelos organizadores.
          </span>
        </span>
      </label>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
