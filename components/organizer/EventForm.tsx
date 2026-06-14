"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useState } from "react";

const schema = z.object({
  title: z.string().min(3, "Mínimo 3 caracteres"),
  description: z.string().optional(),
  modality: z.enum(["ROAD_RACE", "TRAIL_RUN", "MTB", "CYCLING", "WALK", "TRIATHLON", "OTHER"]),
  startAt: z.string().min(1, "Informe a data"),
  venueName: z.string().optional(),
  addressLine: z.string().optional(),
  city: z.string().min(2, "Informe a cidade"),
  state: z.string().length(2, "UF com 2 letras"),
  maxParticipants: z.number().int().positive().optional(),
});

type FormData = z.infer<typeof schema>;

const MODALITIES = [
  { value: "ROAD_RACE", label: "Corrida de Rua" },
  { value: "TRAIL_RUN", label: "Trail Run" },
  { value: "MTB", label: "MTB" },
  { value: "CYCLING", label: "Ciclismo" },
  { value: "WALK", label: "Caminhada" },
  { value: "TRIATHLON", label: "Triathlon" },
  { value: "OTHER", label: "Outro" },
];

export default function EventForm({ eventId }: { eventId?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { modality: "ROAD_RACE" },
  });

  async function onSubmit(data: FormData) {
    setError(null);
    const url = eventId ? `/api/events/${eventId}` : "/api/events";
    const method = eventId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, startAt: new Date(data.startAt).toISOString() }),
    });

    if (!res.ok) {
      const body = await res.json();
      setError(body.error || "Erro ao salvar evento");
      return;
    }

    router.push("/organizador");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="card space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome do evento *</label>
        <input {...register("title")} className="input-field" placeholder="Ex: Corrida das Pedras 2025" />
        {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Modalidade *</label>
        <select {...register("modality")} className="input-field">
          {MODALITIES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data/Hora *</label>
          <input type="datetime-local" {...register("startAt")} className="input-field" />
          {errors.startAt && <p className="text-red-500 text-xs mt-1">{errors.startAt.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Vagas máx.</label>
          <input type="number" {...register("maxParticipants", { valueAsNumber: true })} className="input-field" placeholder="0 = ilimitado" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Local / Venue</label>
        <input {...register("venueName")} className="input-field" placeholder="Nome do local" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Endereço</label>
        <input {...register("addressLine")} className="input-field" placeholder="Rua, número, bairro" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cidade *</label>
          <input {...register("city")} className="input-field" placeholder="São Paulo" />
          {errors.city && <p className="text-red-500 text-xs mt-1">{errors.city.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">UF *</label>
          <input {...register("state")} className="input-field" placeholder="SP" maxLength={2} />
          {errors.state && <p className="text-red-500 text-xs mt-1">{errors.state.message}</p>}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição</label>
        <textarea {...register("description")} className="input-field" rows={4} placeholder="Descreva seu evento..." />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? "Salvando..." : eventId ? "Salvar alterações" : "Criar evento"}
        </button>
        <button type="button" onClick={() => router.back()} className="btn-secondary">
          Cancelar
        </button>
      </div>
    </form>
  );
}
