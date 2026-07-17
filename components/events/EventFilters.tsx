"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

const MODALITIES = [
  { value: "", label: "Todas modalidades" },
  { value: "ROAD_RACE", label: "Corrida de Rua" },
  { value: "TRAIL_RUN", label: "Trail Run" },
  { value: "MTB", label: "MTB" },
  { value: "CYCLING", label: "Ciclismo" },
  { value: "WALK", label: "Caminhada" },
  { value: "TRIATHLON", label: "Triathlon" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Ativas" },
  { value: "encerrada", label: "Encerradas" },
];

interface EventFiltersProps {
  locations: { city: string; state: string }[];
}

export default function EventFilters({ locations }: EventFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectedState = searchParams.get("estado") || "";

  const states = useMemo(
    () => Array.from(new Set(locations.map((l) => l.state))).sort(),
    [locations]
  );

  const cities = useMemo(
    () =>
      selectedState
        ? locations.filter((l) => l.state === selectedState)
        : locations,
    [locations, selectedState]
  );

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("pagina");
      router.push(`/eventos?${params.toString()}`);
    },
    [router, searchParams]
  );

  const updateState = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set("estado", value);
      } else {
        params.delete("estado");
      }
      const currentCity = params.get("cidade");
      if (currentCity) {
        const cityStillValid = locations.some(
          (l) => l.city === currentCity && (!value || l.state === value)
        );
        if (!cityStillValid) {
          params.delete("cidade");
        }
      }
      params.delete("pagina");
      router.push(`/eventos?${params.toString()}`);
    },
    [router, searchParams, locations]
  );

  return (
    <div className="card space-y-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100">Filtros</h3>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
        <select
          className="input-field"
          value={searchParams.get("status") || ""}
          onChange={(e) => updateFilter("status", e.target.value)}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Estado</label>
        <select
          className="input-field"
          value={selectedState}
          onChange={(e) => updateState(e.target.value)}
        >
          <option value="">Todos os estados</option>
          {states.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Modalidade</label>
        <select
          className="input-field"
          value={searchParams.get("modalidade") || ""}
          onChange={(e) => updateFilter("modalidade", e.target.value)}
        >
          {MODALITIES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cidade</label>
        <select
          className="input-field"
          value={searchParams.get("cidade") || ""}
          onChange={(e) => updateFilter("cidade", e.target.value)}
        >
          <option value="">Todas as cidades</option>
          {cities.map((c) => (
            <option key={c.city} value={c.city}>{c.city}/{c.state}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">A partir de</label>
        <input
          type="date"
          className="input-field"
          value={searchParams.get("de") || ""}
          onChange={(e) => updateFilter("de", e.target.value)}
        />
      </div>

      <button
        onClick={() => router.push("/eventos")}
        className="btn-secondary w-full text-sm"
      >
        Limpar filtros
      </button>
    </div>
  );
}
