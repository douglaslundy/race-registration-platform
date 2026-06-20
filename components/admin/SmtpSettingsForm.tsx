"use client";

import { useState } from "react";

interface SmtpSettingsFormProps {
  hostConfigured: boolean;
  fromConfigured: boolean;
  currentHost: string;
  currentPort: string;
  currentUser: string;
  currentFrom: string;
  currentSecure: boolean;
}

export default function SmtpSettingsForm({
  hostConfigured,
  fromConfigured,
  currentHost,
  currentPort,
  currentUser,
  currentFrom,
  currentSecure,
}: SmtpSettingsFormProps) {
  const [host, setHost] = useState(currentHost);
  const [port, setPort] = useState(currentPort || "587");
  const [user, setUser] = useState(currentUser);
  const [pass, setPass] = useState("");
  const [from, setFrom] = useState(currentFrom);
  const [secure, setSecure] = useState(currentSecure);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);

  async function saveSetting(key: string, value: string) {
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveSetting("smtp_host", host.trim());
      await saveSetting("smtp_port", port.trim() || "587");
      await saveSetting("smtp_user", user.trim());
      if (pass.trim()) await saveSetting("smtp_pass", pass.trim());
      await saveSetting("smtp_from", from.trim());
      await saveSetting("smtp_secure", secure ? "true" : "false");
      setPass("");
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestMsg(null);
    setTestOk(false);
    try {
      const res = await fetch("/api/admin/smtp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testTo.trim() ? { to: testTo.trim() } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      setTestOk(true);
      setTestMsg(`E-mail de teste enviado para ${data.to}. Verifique a caixa de entrada.`);
    } catch (err) {
      setTestOk(false);
      setTestMsg(err instanceof Error ? err.message : "Falha ao enviar e-mail de teste");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        {saved && (
          <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded px-3 py-2">
            Configuração de e-mail (SMTP) atualizada!
          </div>
        )}
        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div className="p-3 rounded-lg border dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Servidor SMTP</p>
            <p className={hostConfigured ? "text-green-600 font-medium" : "text-gray-400"}>
              {hostConfigured ? "Configurado" : "Não configurado"}
            </p>
          </div>
          <div className="p-3 rounded-lg border dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Remetente</p>
            <p className={fromConfigured ? "text-green-600 font-medium" : "text-gray-400"}>
              {fromConfigured ? "Configurado" : "Não configurado"}
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Host SMTP</label>
            <input type="text" value={host} onChange={(e) => setHost(e.target.value)} className="input-field w-full" placeholder="smtp.gmail.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Porta</label>
            <input type="number" value={port} onChange={(e) => setPort(e.target.value)} className="input-field w-full" placeholder="587" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Usuário</label>
            <input type="text" value={user} onChange={(e) => setUser(e.target.value)} className="input-field w-full" placeholder="usuario@dominio.com" autoComplete="off" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Senha</label>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} className="input-field w-full" placeholder="Deixe em branco para manter a atual" autoComplete="new-password" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Remetente (From)</label>
          <input type="text" value={from} onChange={(e) => setFrom(e.target.value)} className="input-field w-full" placeholder='"Corridas" <noreply@seudominio.com>' />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
          Conexão segura (SSL/TLS — normalmente porta 465)
        </label>

        <button type="submit" disabled={saving} className="btn-primary px-6">
          {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar configuração de e-mail"}
        </button>
      </form>

      <div className="border-t dark:border-gray-700 pt-4 space-y-3">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Enviar e-mail de teste</p>
        {testMsg && (
          <div
            className={`text-sm rounded px-3 py-2 border ${
              testOk
                ? "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
                : "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
            }`}
          >
            {testMsg}
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            className="input-field flex-1"
            placeholder="Destino (vazio = seu e-mail de admin)"
          />
          <button type="button" onClick={handleTest} disabled={testing} className="btn-secondary whitespace-nowrap">
            {testing ? "Enviando..." : "Enviar teste"}
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Salve a configuração antes de testar. O teste verifica a conexão e envia uma mensagem real.
        </p>
      </div>
    </div>
  );
}
