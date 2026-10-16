"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

/** Botão que (re)gera os números de peito do evento — só renderizado quando o evento está
 * configurado para isso e com as inscrições encerradas (decidido pela página servidor). */
export default function BibNumbersGenerator({
  eventId,
  hasNumbers,
  className = "btn-secondary text-center",
}: {
  eventId: string;
  hasNumbers: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function handleGenerate() {
    setLoading(true);
    const res = await fetch(`/api/events/${eventId}/bib-numbers`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    setConfirming(false);
    if (!res.ok) {
      setError(data.error ?? "Erro ao gerar números de peito");
      return;
    }
    setDone(data.total ?? 0);
    router.refresh();
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setConfirming(true)}>
        {hasNumbers || done !== null ? "Regerar números de peito" : "Gerar números de peito"}
        {done !== null && ` (${done} gerado(s))`}
      </button>
      <ConfirmModal
        open={confirming}
        title="Gerar números de peito"
        message="Os números serão atribuídos aos inscritos confirmados pela ordem cronológica de inscrição. Pendentes e cancelados ficam sem número. Qualquer numeração anterior será substituída."
        confirmLabel="Gerar"
        loading={loading}
        onConfirm={handleGenerate}
        onCancel={() => setConfirming(false)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
