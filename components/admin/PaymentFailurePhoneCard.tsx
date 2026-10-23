"use client";

import { useState } from "react";

export default function PaymentFailurePhoneCard({ settingKey, currentPhone }: { settingKey: string; currentPhone: string }) {
  const [phone, setPhone] = useState(currentPhone);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: settingKey, value: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Erro ${res.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card space-y-4">
      <h2 className="font-semibold">Alerta de erro/recusa de pagamento (equipe)</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Envia WhatsApp para este número sempre que um pagamento (PIX ou cartão) der erro ou o cartão for recusado, em qualquer evento. O organizador de cada evento cadastra o próprio número em Meus Dados. Deixe vazio para desligar.
      </p>
      {saved && <div className="text-sm text-green-700 dark:text-green-400">Configuração salva!</div>}
      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
      <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="input w-full" placeholder="(11) 99999-9999" />
      <button type="button" onClick={handleSave} disabled={saving} className="btn-primary">
        {saving ? "Salvando..." : "Salvar"}
      </button>
    </div>
  );
}
