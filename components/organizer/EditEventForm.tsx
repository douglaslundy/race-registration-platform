"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import FileUploadInput from "./FileUploadInput";

const schema = z.object({
  title: z.string().min(3, "Mínimo 3 caracteres"),
  description: z.string().optional(),
  modality: z.enum(["ROAD_RACE", "TRAIL_RUN", "MTB", "CYCLING", "WALK", "TRIATHLON", "OTHER"]),
  startAt: z.string().min(1, "Informe a data"),
  kitPickupAt: z.string().optional(),
  venueName: z.string().optional(),
  addressLine: z.string().optional(),
  city: z.string().min(2, "Informe a cidade"),
  state: z.string().length(2, "UF com 2 letras"),
  maxParticipants: z.number().int().nonnegative().optional().nullable(),
  organizerContact: z.string().optional(),
  regulationText: z.string().optional().nullable(),
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

function toDatetimeLocal(d: Date | string) {
  const dt = new Date(d);
  return dt.toISOString().slice(0, 16);
}

type EventData = {
  id: string;
  title: string;
  description?: string | null;
  modality: string;
  startAt: Date | string;
  kitPickupAt?: Date | string | null;
  venueName?: string | null;
  addressLine?: string | null;
  city: string;
  state: string;
  maxParticipants?: number | null;
  organizerContact?: string | null;
  bannerUrl?: string | null;
  listBannerUrl?: string | null;
  regulationUrl?: string | null;
  regulationText?: string | null;
};

export default function EditEventForm({ event }: { event: EventData }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(event.bannerUrl ?? null);
  const [listBannerUrl, setListBannerUrl] = useState<string | null>(event.listBannerUrl ?? null);
  const [regulationUrl, setRegulationUrl] = useState<string | null>(event.regulationUrl ?? null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: event.title,
      description: event.description ?? "",
      modality: event.modality as FormData["modality"],
      startAt: toDatetimeLocal(event.startAt),
      kitPickupAt: event.kitPickupAt ? toDatetimeLocal(event.kitPickupAt) : "",
      venueName: event.venueName ?? "",
      addressLine: event.addressLine ?? "",
      city: event.city,
      state: event.state,
      maxParticipants: event.maxParticipants ?? undefined,
      organizerContact: event.organizerContact ?? "",
      regulationText: event.regulationText ?? "",
    },
  });

  async function onSubmit(data: FormData) {
    setError(null);
    const maxParticipants = data.maxParticipants === 0 ? null : data.maxParticipants;
    const res = await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        maxParticipants,
        startAt: new Date(data.startAt).toISOString(),
        kitPickupAt: data.kitPickupAt ? new Date(data.kitPickupAt).toISOString() : null,
        bannerUrl,
        listBannerUrl,
        regulationUrl,
        regulationText: data.regulationText || null,
      }),
    });

    if (!res.ok) {
      const body = await res.json();
      setError(body.error || "Erro ao salvar evento");
      return;
    }

    router.push(`/organizador/eventos/${event.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="card space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome do evento *</label>
        <input {...register("title")} className="input w-full" />
        {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Modalidade *</label>
        <select {...register("modality")} className="input w-full">
          {MODALITIES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data do evento *</label>
          <input type="datetime-local" {...register("startAt")} className="input w-full" />
          {errors.startAt && <p className="text-red-500 text-xs mt-1">{errors.startAt.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Retirada de kit</label>
          <input type="datetime-local" {...register("kitPickupAt")} className="input w-full" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Vagas máximas</label>
          <input type="number" {...register("maxParticipants", { valueAsNumber: true })} className="input w-full" placeholder="0 = ilimitado" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contato do organizador</label>
          <input {...register("organizerContact")} className="input w-full" placeholder="email ou WhatsApp" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Local / Venue</label>
        <input {...register("venueName")} className="input w-full" placeholder="Nome do local" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Endereço</label>
        <input {...register("addressLine")} className="input w-full" placeholder="Rua, número, bairro" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cidade *</label>
          <input {...register("city")} className="input w-full" />
          {errors.city && <p className="text-red-500 text-xs mt-1">{errors.city.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">UF *</label>
          <input {...register("state")} className="input w-full" maxLength={2} />
          {errors.state && <p className="text-red-500 text-xs mt-1">{errors.state.message}</p>}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição</label>
        <textarea {...register("description")} className="input w-full" rows={4} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <FileUploadInput
          purpose="banner"
          accept="image/jpeg,image/png,image/webp,image/gif"
          label="Banner do evento"
          hint="Proporção recomendada 3:1 (ex.: 1200 × 400 px) — a imagem é exibida completa na página do evento. Formatos: JPG, PNG, WebP ou GIF."
          currentUrl={bannerUrl}
          onUploaded={setBannerUrl}
          onRemoved={() => setBannerUrl(null)}
        />
        <FileUploadInput
          purpose="list_banner"
          accept="image/jpeg,image/png,image/webp,image/gif"
          label="Banner da listagem (formato quadrado)"
          hint="Proporção recomendada 1:1 (ex.: 600 × 600 px) — exibido no card do evento na página de listagem. Formatos: JPG, PNG, WebP ou GIF."
          currentUrl={listBannerUrl}
          onUploaded={setListBannerUrl}
          onRemoved={() => setListBannerUrl(null)}
        />
        <FileUploadInput
          purpose="regulation"
          accept="application/pdf"
          label="Regulamento (PDF)"
          currentUrl={regulationUrl}
          onUploaded={setRegulationUrl}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Regulamento (texto)</label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Escreva o regulamento diretamente. Pode ser usado junto com ou em vez do PDF.
        </p>
        <textarea
          {...register("regulationText")}
          className="input w-full"
          rows={8}
          placeholder="Descreva as regras, categorias, premiação e demais informações do regulamento..."
        />
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary flex-1" disabled={isSubmitting}>
          {isSubmitting ? "Salvando..." : "Salvar alterações"}
        </button>
        <button type="button" onClick={() => router.back()} className="btn-secondary">
          Cancelar
        </button>
      </div>
    </form>
  );
}
