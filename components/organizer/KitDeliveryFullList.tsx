"use client";

import { useEffect, useMemo, useState } from "react";
import { normalizeCpf } from "@/lib/cpf";

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

type Filter = "all" | "delivered" | "pending";

function formatDateTime(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR");
}

/**
 * Aba "Todos os inscritos" da tela de entrega de kits — visualização (sem ação de entrega).
 * Carrega a lista completa de inscritos CONFIRMED do evento; filtro entregues/pendentes e busca
 * por nome/CPF são no cliente. Remontar o componente (troca de aba) recarrega os dados.
 */
export default function KitDeliveryFullList({ eventId }: { eventId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
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

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = normalizeCpf(q);
    return items.filter((i) => {
      if (filter === "delivered" && !i.delivered) return false;
      if (filter === "pending" && i.delivered) return false;
      if (!term) return true;
      const nameHit = i.participantName.toLowerCase().includes(term);
      const cpfHit = digits.length > 0 && (i.participantCpf ?? "").includes(digits);
      return nameHit || cpfHit;
    });
  }, [items, filter, q]);

  const filterButton = (value: Filter, label: string, count: number) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
        filter === value
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
