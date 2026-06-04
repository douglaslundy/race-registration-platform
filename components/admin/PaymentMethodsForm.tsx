"use client";

import { useMemo, useState } from "react";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_VALUES, type CheckoutPaymentMethod } from "@/lib/payment-methods";

interface PaymentMethodsFormProps {
  currentMethods: CheckoutPaymentMethod[];
}

export default function PaymentMethodsForm({ currentMethods }: PaymentMethodsFormProps) {
  const [selectedMethods, setSelectedMethods] = useState<CheckoutPaymentMethod[]>(currentMethods);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(selectedMethods), [selectedMethods]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedMethods.length === 0) {
      setError("Selecione ao menos um meio de pagamento.");
      return;
    }

    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "enabled_payment_methods",
          value: selectedMethods.join(","),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Erro ${res.status}`);
        return;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } finally {
      setSaving(false);
    }
  }

  function toggleMethod(method: CheckoutPaymentMethod) {
    setSelectedMethods((current) =>
      current.includes(method) ? current.filter((item) => item !== method) : [...current, method],
    );
    setSaved(false);
    setError(null);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {saved && (
        <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded px-3 py-2">
          Meios de pagamento atualizados com sucesso!
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2 font-mono break-all">
          {error}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        {PAYMENT_METHOD_VALUES.map((method) => (
          <label
            key={method}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer transition ${
              selectedSet.has(method) ? "border-primary-500 bg-primary-50" : "border-gray-200 hover:bg-gray-50"
            }`}
          >
            <input
              type="checkbox"
              checked={selectedSet.has(method)}
              onChange={() => toggleMethod(method)}
              className="accent-primary-600"
            />
            <span className="font-medium">{PAYMENT_METHOD_LABELS[method]}</span>
          </label>
        ))}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Esses meios serão exibidos no checkout público e bloqueados na API quando desativados.
      </p>

      <button type="submit" disabled={saving} className="btn-primary px-6">
        {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar meios de pagamento"}
      </button>
    </form>
  );
}
