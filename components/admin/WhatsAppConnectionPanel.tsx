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

  // Poll de fundo (mais espaçado) enquanto a tela estiver aberta, mesmo sem QR code visível --
  // a conexão pode cair no Evolution API a qualquer momento (fora do controle deste painel), e
  // sem isso o status mostrado ficava preso no que foi lido na última visita/clique manual.
  useEffect(() => {
    if (!configured) return;
    const interval = setInterval(() => {
      refreshStatus();
    }, 20000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  useEffect(() => {
    if (!qrCode || state === "open") return;
    const interval = setInterval(() => {
      refreshStatus();
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrCode, state]);

  useEffect(() => {
    if (state === "open" && qrCode) {
      setQrCode(null);
    }
  }, [state, qrCode]);

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
    </div>
  );
}
