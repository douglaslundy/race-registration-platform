"use client";

import { useEffect, useMemo, useState } from "react";
import {
  filterKitDeliveryItems,
  kitDeliveryAssistantNames,
  sortKitDeliveryItems,
  type KitDeliverySortOrder,
  type KitDeliveryStatusFilter,
} from "@/lib/kit-delivery/list-view";

interface Item {
  id: string;
  participantName: string;
  participantCpf: string | null;
  bibNumber: string | null;
  shirtSize: string | null;
  categoryName: string | null;
  notes: string | null;
  delivered: boolean;
  deliveredAt: string | null;
  deliveredByName: string | null;
  receivedByName: string | null;
  receivedByDocument: string | null;
}

function formatDateTime(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR");
}

/**
 * Aba "Todos os inscritos" da tela de entrega de kits — visualização (sem ação de entrega).
 * Carrega a lista completa de inscritos CONFIRMED do evento; filtro (status/assistente/busca) e
 * ordenação são no cliente, usando as mesmas funções puras da rota de PDF
 * (`lib/kit-delivery/list-view`). Remontar o componente (troca de aba) recarrega os dados.
 */
export default function KitDeliveryFullList({ eventId }: { eventId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<KitDeliveryStatusFilter>("all");
  const [assistant, setAssistant] = useState<string>("");
  const [sort, setSort] = useState<KitDeliverySortOrder>("delivered-first");
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/events/${eventId}/kit-deliveries/list`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar a lista de inscritos.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const deliveredCount = useMemo(() => items.filter((i) => i.delivered).length, [items]);
  const pendingCount = items.length - deliveredCount;
  const assistantNames = useMemo(() => kitDeliveryAssistantNames(items), [items]);

  const assistantDisabled = status === "pending";
  const effectiveAssistant = assistantDisabled ? null : assistant || null;

  const visible = useMemo(() => {
    const filtered = filterKitDeliveryItems(items, { status, assistant: effectiveAssistant, q });
    return sortKitDeliveryItems(filtered, sort);
  }, [items, status, effectiveAssistant, q, sort]);

  const pdfUrl = useMemo(() => {
    const sp = new URLSearchParams({ status, sort });
    if (effectiveAssistant) sp.set("assistant", effectiveAssistant);
    if (q.trim()) sp.set("q", q.trim());
    return `/api/events/${eventId}/kit-deliveries/list/pdf?${sp.toString()}`;
  }, [eventId, status, sort, effectiveAssistant, q]);

  const filterButton = (value: KitDeliveryStatusFilter, label: string, count: number) => (
    <button
      type="button"
      onClick={() => setStatus(value)}
      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
        status === value
          ? "border-primary-500 text-primary-600 bg-primary-50 dark:bg-primary-900/20"
          : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
      }`}
    >
      {label} ({count})
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {filterButton("all", "Todos", items.length)}
        {filterButton("delivered", "Entregues", deliveredCount)}
        {filterButton("pending", "Pendentes", pendingCount)}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">Assistente que entregou</span>
          <select
            value={assistantDisabled ? "" : assistant}
            onChange={(e) => setAssistant(e.target.value)}
            disabled={assistantDisabled || assistantNames.length === 0}
            className="input w-auto"
          >
            <option value="">Todos os assistentes</option>
            {assistantNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">Ordenar</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as KitDeliverySortOrder)}
            className="input w-auto"
          >
            <option value="delivered-first">Entregues em cima</option>
            <option value="pending-first">Pendentes em cima</option>
          </select>
        </label>

        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary text-sm"
          aria-disabled={loading || items.length === 0}
          onClick={(e) => {
            if (loading || items.length === 0) e.preventDefault();
          }}
        >
          🖨️ Imprimir em PDF
        </a>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por nome ou CPF"
        className="input w-full"
      />

      {loading ? (
        <p className="text-sm text-gray-500">Carregando...</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            Mostrando {visible.length} de {items.length} inscrito{items.length === 1 ? "" : "s"}
          </p>

          {visible.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">Nenhum inscrito encontrado.</p>
          ) : (
            <div className="space-y-3">
              {visible.map((i) => (
                <div key={i.id} className="card space-y-2">
                  <div>
                    <p className="font-semibold">{i.participantName}</p>
                    <p className="text-sm text-gray-500">
                      CPF {i.participantCpf ?? "—"} · {i.categoryName ?? "Sem categoria"} · Camiseta{" "}
                      {i.shirtSize ?? "—"} · Peito {i.bibNumber ?? "—"}
                    </p>
                  </div>

                  {i.notes && (
                    <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Observações</p>
                      <p className="text-sm text-amber-900 dark:text-amber-200 whitespace-pre-wrap">{i.notes}</p>
                    </div>
                  )}

                  {i.delivered ? (
                    <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 rounded px-3 py-2">
                      <p>✓ Kit entregue em {formatDateTime(i.deliveredAt)} por {i.deliveredByName ?? "—"}</p>
                      <p>
                        Retirado por {i.receivedByName ?? "—"}
                        {i.receivedByDocument ? ` (doc. ${i.receivedByDocument})` : ""}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded px-3 py-2">
                      ⏳ Kit pendente
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
