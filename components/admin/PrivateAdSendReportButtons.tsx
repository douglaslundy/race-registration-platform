"use client";

import { useState } from "react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

type Channel = "email" | "whatsapp";

const CHANNEL_LABEL: Record<Channel, string> = {
  email: "e-mail",
  whatsapp: "WhatsApp",
};

export default function PrivateAdSendReportButtons({ adId }: { adId: string }) {
  const [confirmingChannel, setConfirmingChannel] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSend() {
    const channel = confirmingChannel;
    if (!channel) return;

    setLoading(true);
    setSuccess(null);
    const res = await fetch(`/api/admin/ads/private/${adId}/send-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
    });
    setLoading(false);
    setConfirmingChannel(null);

    if (res.ok) {
      setSuccess(`Relatório enviado por ${CHANNEL_LABEL[channel]}.`);
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? `Erro ao enviar relatório por ${CHANNEL_LABEL[channel]}.`);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setConfirmingChannel("email")}
          disabled={loading}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          Enviar por e-mail
        </button>
        <button
          onClick={() => setConfirmingChannel("whatsapp")}
          disabled={loading}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          Enviar por WhatsApp
        </button>
      </div>
      {success && <p className="text-sm text-green-600">{success}</p>}

      <ConfirmModal
        open={confirmingChannel !== null}
        title="Enviar relatório"
        message={
          confirmingChannel
            ? `Enviar o relatório em PDF deste anúncio por ${CHANNEL_LABEL[confirmingChannel]}?`
            : ""
        }
        confirmLabel="Enviar"
        tone="success"
        loading={loading}
        onConfirm={handleSend}
        onCancel={() => setConfirmingChannel(null)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
