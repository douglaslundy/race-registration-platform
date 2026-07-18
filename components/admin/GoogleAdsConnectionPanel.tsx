"use client";

import { useState } from "react";

export default function GoogleAdsConnectionPanel({
  connected,
  publisherId,
  hasError,
}: {
  connected: boolean;
  publisherId: string | null;
  hasError: boolean;
}) {
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleDisconnect() {
    setDisconnecting(true);
    await fetch("/api/admin/ads/google/disconnect", { method: "POST" });
    window.location.reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-500">Status:</span>
        <span className={connected ? "text-green-600 font-medium" : "text-gray-500 font-medium"}>
          {connected ? "Conectado" : "Não conectado"}
        </span>
      </div>

      {hasError && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          Falha ao conectar. Tente novamente.
        </div>
      )}

      {connected && publisherId && (
        <p className="text-sm text-gray-600 dark:text-gray-400">Conta: {publisherId}</p>
      )}

      {connected ? (
        <button onClick={handleDisconnect} disabled={disconnecting} className="btn-secondary text-sm disabled:opacity-50">
          {disconnecting ? "Desconectando..." : "Desconectar"}
        </button>
      ) : (
        <a href="/api/admin/ads/google/connect" className="btn-primary text-sm inline-block">
          Conectar conta Google AdSense
        </a>
      )}
    </div>
  );
}
