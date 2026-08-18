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
  organizerNameOverride: z.string().optional(),
  organizerDescriptionOverride: z.string().optional(),
  organizerEmailOverride: z.string().optional(),
  organizerPhoneOverride: z.string().optional(),
  regulationText: z.string().optional().nullable(),
  metaTitle: z.string().max(70).optional().nullable(),
  metaDescription: z.string().max(160).optional().nullable(),
  cancellationDeadline: z.string().optional(),
  cancellationRequiresApproval: z.boolean().optional(),
  cancellationContactPhone: z.string().optional(),
  cancellationContactEmail: z.string().optional(),
  allowProxyRegistration: z.boolean().optional(),
  shirtSizeRestrictionDate: z.string().optional(),
  shirtSizeRestrictionSizes: z.array(z.enum(["PP", "P", "M", "G", "GG", "XGG"])).optional(),
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

export function toDatetimeLocal(d: Date | string) {
  const dt = new Date(d);
  // `toISOString()` sozinho sempre retorna o horário em UTC — sem subtrair o offset local, o
  // input `datetime-local` (que espera o horário de parede local) mostrava o valor UTC cru,
  // 3h à frente do horário de Brasília digitado originalmente.
  const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
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
  organizerNameOverride?: string | null;
  organizerDescriptionOverride?: string | null;
  organizerEmailOverride?: string | null;
  organizerPhoneOverride?: string | null;
  bannerUrl?: string | null;
  listBannerUrl?: string | null;
  regulationUrl?: string | null;
  regulationText?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  cancellationDeadline?: Date | string | null;
  cancellationRequiresApproval?: boolean;
  cancellationContactPhone?: string | null;
  cancellationContactEmail?: string | null;
  allowProxyRegistration?: boolean;
  shirtSizeRestrictionDate?: Date | string | null;
  shirtSizeRestrictionSizes?: string[];
};

async function generateEventText(eventId: string, field: "metaTitle" | "metaDescription"): Promise<string> {
  const res = await fetch(`/api/events/${eventId}/seo/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Erro ao gerar texto");
  return data.text as string;
}

export default function EditEventForm({
  event,
  cancellationPolicyEnabled = false,
}: {
  event: EventData;
  cancellationPolicyEnabled?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(event.bannerUrl ?? null);
  const [listBannerUrl, setListBannerUrl] = useState<string | null>(event.listBannerUrl ?? null);
  const [regulationUrl, setRegulationUrl] = useState<string | null>(event.regulationUrl ?? null);

  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
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
      maxParticipants: event.maxParticipants ?? 0,
      organizerContact: event.organizerContact ?? "",
      organizerNameOverride: event.organizerNameOverride ?? "",
      organizerDescriptionOverride: event.organizerDescriptionOverride ?? "",
      organizerEmailOverride: event.organizerEmailOverride ?? "",
      organizerPhoneOverride: event.organizerPhoneOverride ?? "",
      regulationText: event.regulationText ?? "",
      metaTitle: event.metaTitle ?? "",
      metaDescription: event.metaDescription ?? "",
      cancellationDeadline: event.cancellationDeadline ? toDatetimeLocal(event.cancellationDeadline) : "",
      cancellationRequiresApproval: event.cancellationRequiresApproval ?? false,
      cancellationContactPhone: event.cancellationContactPhone ?? "",
      cancellationContactEmail: event.cancellationContactEmail ?? "",
      allowProxyRegistration: event.allowProxyRegistration ?? false,
      shirtSizeRestrictionDate: event.shirtSizeRestrictionDate ? toDatetimeLocal(event.shirtSizeRestrictionDate) : "",
      shirtSizeRestrictionSizes: (event.shirtSizeRestrictionSizes ?? []) as FormData["shirtSizeRestrictionSizes"],
    },
  });

  const [generating, setGenerating] = useState<"metaTitle" | "metaDescription" | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  async function handleGenerate(field: "metaTitle" | "metaDescription") {
    setGenerating(field);
    setGenerateError(null);
    try {
      const text = await generateEventText(event.id, field);
      setValue(field, text, { shouldValidate: true });
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Erro ao gerar texto com IA");
    } finally {
      setGenerating(null);
    }
  }

  async function onSubmit(data: FormData) {
    setError(null);
    if (data.shirtSizeRestrictionDate && (data.shirtSizeRestrictionSizes ?? []).length === 0) {
      setError("Selecione pelo menos um tamanho de camiseta para a restrição.");
      return;
    }
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
        metaTitle: data.metaTitle || null,
        metaDescription: data.metaDescription || null,
        organizerNameOverride: data.organizerNameOverride || null,
        organizerDescriptionOverride: data.organizerDescriptionOverride || null,
        organizerEmailOverride: data.organizerEmailOverride || null,
        organizerPhoneOverride: data.organizerPhoneOverride || null,
        cancellationDeadline: data.cancellationDeadline ? new Date(data.cancellationDeadline).toISOString() : null,
        cancellationRequiresApproval: data.cancellationRequiresApproval ?? false,
        cancellationContactPhone: data.cancellationContactPhone || null,
        cancellationContactEmail: data.cancellationContactEmail || null,
        shirtSizeRestrictionDate: data.shirtSizeRestrictionDate ? new Date(data.shirtSizeRestrictionDate).toISOString() : null,
        shirtSizeRestrictionSizes: data.shirtSizeRestrictionDate ? (data.shirtSizeRestrictionSizes ?? []) : [],
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

      <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Organizador deste evento</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Opcional. Preencha só se este evento tiver um organizador diferente do seu cadastro
            padrão. Campos em branco usam os dados do seu perfil de organizador.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
          <input {...register("organizerNameOverride")} className="input w-full" placeholder="Nome exibido como organizador" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição</label>
          <textarea {...register("organizerDescriptionOverride")} className="input w-full" rows={3} placeholder="Apresentação exibida na página do evento" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">E-mail</label>
            <input {...register("organizerEmailOverride")} className="input w-full" placeholder="contato@evento.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone</label>
            <input {...register("organizerPhoneOverride")} className="input w-full" placeholder="(00) 00000-0000" />
          </div>
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

      <div className="border-t pt-5 dark:border-gray-700 space-y-4">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">SEO</h3>
        {generateError && <p className="text-red-500 text-xs">{generateError}</p>}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Meta título</label>
            <button
              type="button"
              onClick={() => handleGenerate("metaTitle")}
              disabled={generating !== null}
              className="text-xs text-primary-600 hover:underline disabled:opacity-50"
            >
              {generating === "metaTitle" ? "Gerando..." : "✨ Gerar com IA"}
            </button>
          </div>
          <input {...register("metaTitle")} maxLength={70} className="input w-full" placeholder="Deixe em branco para usar o nome do evento" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Meta descrição</label>
            <button
              type="button"
              onClick={() => handleGenerate("metaDescription")}
              disabled={generating !== null}
              className="text-xs text-primary-600 hover:underline disabled:opacity-50"
            >
              {generating === "metaDescription" ? "Gerando..." : "✨ Gerar com IA"}
            </button>
          </div>
          <textarea {...register("metaDescription")} maxLength={160} rows={2} className="input w-full" placeholder="Deixe em branco para usar a descrição do evento" />
        </div>
      </div>

      <div className="border-t pt-5 dark:border-gray-700">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" {...register("allowProxyRegistration")} className="h-4 w-4" />
          Permitir inscrição por procuração (atleta inscrever outra pessoa)
        </label>
      </div>

      {cancellationPolicyEnabled && (
        <div className="border-t pt-5 dark:border-gray-700 space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Política de cancelamento</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Deixe o prazo em branco para permitir cancelamento livre até o início do evento (padrão).
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prazo final para cancelamento</label>
              <input type="datetime-local" {...register("cancellationDeadline")} className="input w-full" />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" {...register("cancellationRequiresApproval")} className="h-4 w-4" />
                Cancelamento requer aprovação do organizador
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone de contato (WhatsApp)</label>
              <input {...register("cancellationContactPhone")} className="input w-full" placeholder="+55 11 91234-5678" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">E-mail de contato</label>
              <input {...register("cancellationContactEmail")} className="input w-full" placeholder="cancelamentos@organizador.com" />
            </div>
          </div>
        </div>
      )}

      <div className="border-t pt-5 dark:border-gray-700 space-y-3">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Restrição de tamanho de camiseta</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Deixe a data em branco para manter todos os tamanhos disponíveis durante toda a
          inscrição (padrão). Se preenchida, só os tamanhos marcados abaixo continuam
          disponíveis a partir dessa data.
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Restringir tamanhos a partir de
          </label>
          <input type="datetime-local" {...register("shirtSizeRestrictionDate")} className="input w-full" />
        </div>
        <div className="flex flex-wrap gap-3">
          {["PP", "P", "M", "G", "GG", "XGG"].map((size) => (
            <label key={size} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" value={size} {...register("shirtSizeRestrictionSizes")} className="h-4 w-4" />
              {size}
            </label>
          ))}
        </div>
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
