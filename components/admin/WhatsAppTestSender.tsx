"use client";

import { useState } from "react";

export default function WhatsAppTestSender() {
  const [phone, setPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function handleTest() {
    setTesting(true);
    setMsg(null);
    setOk(false);
    try {
      const res = await fetch("/api/admin/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      setOk(true);
      setMsg(`WhatsApp de teste enviado para ${data.to}.`);
    } catch (err) {
      setOk(false);
      setMsg(err instanceof Error ? err.message : "Falha ao enviar WhatsApp de teste");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-3">
      {msg && (
        <div
          className={`text-sm rounded px-3 py-2 border ${
            ok
              ? "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
              : "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
          }`}
        >
          {msg}
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="input-field flex-1"
          placeholder="5511999999999 (DDI + DDD + número)"
        />
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || !phone.trim()}
          className="btn-secondary whitespace-nowrap disabled:opacity-50"
        >
          {testing ? "Enviando..." : "Enviar WhatsApp de teste"}
        </button>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Envia usando o provedor ativo. Confirme antes que as credenciais e a conexão estejam configuradas.
      </p>
    </div>
  );
}
