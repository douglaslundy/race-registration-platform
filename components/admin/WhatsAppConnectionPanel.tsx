"use client";

import { useEffect, useState } from "react";

type ConnectionState = "open" | "connecting" | "close" | "not_found" | "not_configured" | "unknown";

const STATE_LABEL: Record<ConnectionState, string> = {
  open: "Conectado",
  connecting: "Conectando",
  close: "Desconectado",
  not_found: "Instância não criada",
  not_configured: "Configure as credenciais primeiro",
  unknown: "Verificando...",
};

const STATE_COLOR: Record<ConnectionState, string> = {
  open: "text-green-600",
  connecting: "text-yellow-600",
  close: "text-gray-500",
  not_found: "text-gray-500",
  not_configured: "text-gray-400",
  unknown: "text-gray-400",
};

export default function WhatsAppConnectionPanel({ configured }: { configured: boolean }) {
  const [state, setState] = useState<ConnectionState>("unknown");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);

  async function refreshStatus() {
    setError(null);
    const res = await fetch("/api/admin/whatsapp/status");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Falha ao consultar status");
      return;
    }
    setState(data.state ?? "unknown");
  }

  useEffect(() => {
    if (configured) {
      refreshStatus();
    } else {
      setState("not_configured");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  async function handleGenerateQrCode() {
    setLoading("qrcode");
    setError(null);
    try {
      const res = await fetch("/api/admin/whatsapp/instance", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao gerar QR code");
      setQrCode(data.qrCodeBase64 ?? null);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar QR code");
    } finally {
      setLoading(null);
    }
  }

  async function handleDisconnect() {
    setLoading("disconnect");
    setError(null);
    try {
      const res = await fetch("/api/admin/whatsapp/disconnect", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao desconectar");
      setQrCode(null);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao desconectar");
    } finally {
      setLoading(null);
    }
  }

  async function handleDelete() {
    setLoading("delete");
    setError(null);
    try {
      const res = await fetch("/api/admin/whatsapp/delete", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao excluir instância");
      setQrCode(null);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir instância");
    } finally {
      setLoading(null);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestMsg(null);
    setTestOk(false);
    try {
      const res = await fetch("/api/admin/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      setTestOk(true);
      setTestMsg(`WhatsApp de teste enviado para ${data.to}.`);
    } catch (err) {
      setTestOk(false);
      setTestMsg(err instanceof Error ? err.message : "Falha ao enviar WhatsApp de teste");
    } finally {
      setTesting(false);
    }
  }

  const isConnected = state === "open";

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Status:</span>
          <span className={`font-medium ${STATE_COLOR[state]}`}>{STATE_LABEL[state]}</span>
        </div>

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
            {error}
          </div>
        )}

        {qrCode && (
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrCode} alt="QR code do WhatsApp" className="w-56 h-56 border rounded-lg" />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleGenerateQrCode}
            disabled={!configured || loading !== null}
            className="btn-primary px-4 text-sm disabled:opacity-50"
          >
            {loading === "qrcode" ? "Gerando..." : "Gerar QR Code"}
          </button>
          <button
            type="button"
            onClick={refreshStatus}
            disabled={!configured || loading !== null}
            className="btn-secondary px-4 text-sm disabled:opacity-50"
          >
            Atualizar status
          </button>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={!configured || loading !== null}
            className="btn-secondary px-4 text-sm disabled:opacity-50"
          >
            {loading === "disconnect" ? "Desconectando..." : "Desconectar"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!configured || loading !== null}
            className="text-sm text-red-600 hover:underline disabled:opacity-50 px-2"
          >
            {loading === "delete" ? "Excluindo..." : "Excluir instância"}
          </button>
        </div>

        {!configured && (
          <p className="text-xs text-gray-500 dark:text-gray-400">Configure e salve as credenciais primeiro.</p>
        )}
      </div>

      <div className="border-t dark:border-gray-700 pt-4 space-y-3">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Enviar WhatsApp de teste</p>
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
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="input-field flex-1"
            placeholder="5511999999999 (DDI + DDD + número)"
          />
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !isConnected || !phone.trim()}
            className="btn-secondary whitespace-nowrap disabled:opacity-50"
          >
            {testing ? "Enviando..." : "Enviar WhatsApp de teste"}
          </button>
        </div>
        {!isConnected && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Conecte o WhatsApp primeiro (gere e escaneie o QR code acima).
          </p>
        )}
      </div>
    </div>
  );
}
