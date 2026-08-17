"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ErrorModal from "@/components/ui/ErrorModal";
import QrCameraScanner from "@/components/organizer/QrCameraScanner";
import KitDeliveryReportCard from "@/components/organizer/KitDeliveryReportCard";

interface SearchResult {
  id: string;
  athleteName: string;
  bibNumber: string | null;
  shirtSize: string | null;
  categoryName: string | null;
  status: string;
  delivered: boolean;
  deliveredAt: string | null;
  deliveredByName: string | null;
  receivedByName: string | null;
}

interface ReportData {
  total: number;
  delivered: number;
  pending: Array<{ id: string; athleteName: string; bibNumber: string | null; categoryName: string | null }>;
  pendingTotal: number;
}

export default function EntregaKitsPage() {
  const { id } = useParams<{ id: string }>();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [receivedByName, setReceivedByName] = useState("");
  const [receivedByDocument, setReceivedByDocument] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [report, setReport] = useState<ReportData | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const [showCamera, setShowCamera] = useState(false);

  async function loadReport() {
    const res = await fetch(`/api/events/${id}/kit-deliveries/report`);
    if (!res.ok) {
      setReportError("Não foi possível carregar o relatório de progresso.");
      return;
    }
    setReportError(null);
    setReport(await res.json());
  }

  useEffect(() => {
    void loadReport();
  }, [id]);

  async function runSearch(q: string) {
    setSearchError(null);
    setSearching(true);
    const res = await fetch(`/api/events/${id}/kit-deliveries/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      setSearchError("Erro ao buscar. Tente novamente.");
      setResults([]);
    } else {
      const data = await res.json();
      setResults(data.results ?? []);
    }
    setSearching(false);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    void runSearch(query);
  }

  function openConfirm(result: SearchResult) {
    setConfirmingId(result.id);
    setReceivedByName(result.athleteName);
    setReceivedByDocument("");
    setConfirmError(null);
  }

  async function handleConfirm(registrationId: string) {
    setConfirming(true);
    setConfirmError(null);
    const res = await fetch(`/api/events/${id}/kit-deliveries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registrationId,
        receivedByName,
        receivedByDocument: receivedByDocument.trim() || undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const fieldErrors = data.error?.fieldErrors as Record<string, string[]> | undefined;
      setConfirmError(
        data.error?.formErrors?.[0] ??
          Object.values(fieldErrors ?? {})[0]?.[0] ??
          (typeof data.error === "string" ? data.error : null) ??
          "Erro ao confirmar entrega",
      );
      setConfirming(false);
      return;
    }
    setConfirmingId(null);
    setConfirming(false);
    await runSearch(query);
    void loadReport();
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <ErrorModal message={searchError} onClose={() => setSearchError(null)} />

      <div>
        <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">
          ← Voltar
        </Link>
        <h1 className="text-xl font-bold mt-1">Entrega de kits</h1>
        <p className="text-sm text-gray-500">
          Busque por nome, CPF ou número de peito, ou aponte um leitor de código de barras/QR pro
          campo abaixo.
        </p>
      </div>

      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nome, CPF, número de peito ou código do QR"
          className="input flex-1"
        />
        <button type="submit" disabled={searching} className="btn-primary">
          {searching ? "Buscando..." : "Buscar"}
        </button>
        <button type="button" onClick={() => setShowCamera(true)} className="btn-secondary" aria-label="Usar câmera">
          📷
        </button>
      </form>

      {showCamera && (
        <QrCameraScanner
          onScan={(value) => {
            setQuery(value);
            void runSearch(value);
          }}
          onClose={() => setShowCamera(false)}
        />
      )}

      <div className="space-y-3">
        {results.map((r) => (
          <div key={r.id} className="card space-y-2">
            <div>
              <p className="font-semibold">{r.athleteName}</p>
              <p className="text-sm text-gray-500">
                {r.categoryName ?? "Sem categoria"} · Camiseta {r.shirtSize ?? "—"} · Peito{" "}
                {r.bibNumber ?? "—"}
              </p>
            </div>

            {r.delivered ? (
              <p className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 rounded px-3 py-2">
                ✓ Já entregue em {r.deliveredAt ? new Date(r.deliveredAt).toLocaleString("pt-BR") : ""} por{" "}
                {r.deliveredByName} — retirado por {r.receivedByName}
              </p>
            ) : confirmingId === r.id ? (
              <div className="space-y-2 border-t dark:border-gray-700 pt-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Retirado por</label>
                  <input
                    value={receivedByName}
                    onChange={(e) => setReceivedByName(e.target.value)}
                    className="input w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Documento (opcional)</label>
                  <input
                    value={receivedByDocument}
                    onChange={(e) => setReceivedByDocument(e.target.value)}
                    className="input w-full"
                  />
                </div>
                {confirmError && <p className="text-sm text-red-600">{confirmError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleConfirm(r.id)}
                    disabled={confirming || !receivedByName.trim()}
                    className="btn-primary text-sm"
                  >
                    {confirming ? "Confirmando..." : "Confirmar entrega"}
                  </button>
                  <button onClick={() => setConfirmingId(null)} className="btn-secondary text-sm">
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => openConfirm(r)} className="btn-primary text-sm">
                Confirmar entrega
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-1">
        {reportError && <p className="text-sm text-red-600">{reportError}</p>}
        {report && (
          <KitDeliveryReportCard
            eventId={id}
            total={report.total}
            delivered={report.delivered}
            pending={report.pending}
            pendingTotal={report.pendingTotal}
          />
        )}
      </div>
    </div>
  );
}
