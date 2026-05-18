"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/format";

const schema = z.object({
  ticketBatchId: z.string().cuid(),
  routeId: z.string().cuid().optional(),
  categoryId: z.string().cuid().optional(),
  shirtSize: z.enum(["PP", "P", "M", "G", "GG", "XGG"]).optional(),
  teamName: z.string().max(100).optional(),
  emergencyContactName: z.string().min(2, "Informe o contato de emergência"),
  emergencyContactPhone: z.string().min(8, "Telefone inválido"),
  medicalNotes: z.string().max(500).optional(),
  couponCode: z.string().optional(),
  paymentMethod: z.enum(["PIX", "CREDIT_CARD", "BOLETO"]),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "Aceite os termos para continuar" }) }),
});

type FormData = z.infer<typeof schema>;

interface Batch {
  id: string;
  name: string;
  priceAmount: number;
  capacity: number;
  soldCount: number;
}

interface EventData {
  id: string;
  title: string;
  slug: string;
  routes: { id: string; name: string; distanceKm: number }[];
  categories: { id: string; name: string }[];
}

interface AthleteProfile {
  preferredShirtSize?: string | null;
  teamName?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  medicalNotes?: string | null;
}

export default function CheckoutForm({
  event,
  batches,
  userId: _userId,
  athleteProfile,
}: {
  event: EventData;
  batches: Batch[];
  userId: string;
  athleteProfile?: AthleteProfile;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ pixQrCodeText?: string; boletoUrl?: string; checkoutUrl?: string; status: string } | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      ticketBatchId: batches[0]?.id,
      paymentMethod: "PIX",
      shirtSize: (athleteProfile?.preferredShirtSize as FormData["shirtSize"]) ?? undefined,
      teamName: athleteProfile?.teamName ?? "",
      emergencyContactName: athleteProfile?.emergencyName ?? "",
      emergencyContactPhone: athleteProfile?.emergencyPhone ?? "",
      medicalNotes: athleteProfile?.medicalNotes ?? "",
    },
  });

  const selectedBatchId = watch("ticketBatchId");
  const selectedBatch = batches.find((b) => b.id === selectedBatchId) ?? batches[0];

  async function onSubmit(data: FormData) {
    setError(null);
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, eventId: event.id }),
    });

    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Erro ao processar inscrição");
      return;
    }

    if (body.status === "PAID") {
      router.push(`/dashboard/inscricoes/${body.registrationId}?confirmed=1`);
      return;
    }

    // Checkout Pro redirect (cartão de crédito via Mercado Pago)
    if (body.checkoutUrl) {
      window.location.href = body.checkoutUrl;
      return;
    }

    setResult(body);
  }

  if (result) {
    return (
      <div className="card space-y-4">
        <h2 className="text-xl font-bold text-green-700">Inscrição criada!</h2>
        {result.pixQrCodeText && (
          <div>
            <p className="font-medium mb-2">Pague via Pix:</p>
            <div className="bg-gray-50 border rounded-lg p-4 font-mono text-xs break-all">{result.pixQrCodeText}</div>
          </div>
        )}
        {result.boletoUrl && (
          <a href={result.boletoUrl} target="_blank" rel="noreferrer" className="btn-primary block text-center">
            Ver Boleto
          </a>
        )}
        <p className="text-sm text-gray-600">Aguardando confirmação do pagamento.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="card">
        <h3 className="font-semibold mb-3">Lote de inscrição</h3>
        <div className="space-y-2">
          {batches.map((b) => (
            <label key={b.id} className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
              <input type="radio" value={b.id} {...register("ticketBatchId")} />
              <div className="flex-1 flex justify-between">
                <span className="font-medium">{b.name}</span>
                <span className="text-primary-600 font-bold">{formatCurrency(b.priceAmount)}</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {event.routes.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3">Percurso</h3>
          <select {...register("routeId")} className="input-field">
            <option value="">Selecione um percurso</option>
            {event.routes.map((r) => (
              <option key={r.id} value={r.id}>{r.name} — {r.distanceKm}km</option>
            ))}
          </select>
        </div>
      )}

      {event.categories.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3">Categoria</h3>
          <select {...register("categoryId")} className="input-field">
            <option value="">Selecione uma categoria</option>
            {event.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="card space-y-4">
        <h3 className="font-semibold">Dados complementares</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Camiseta</label>
            <select {...register("shirtSize")} className="input-field">
              <option value="">Selecione</option>
              {["PP","P","M","G","GG","XGG"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Equipe / Assessoria</label>
            <input {...register("teamName")} className="input-field" placeholder="Opcional" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contato emergência *</label>
            <input {...register("emergencyContactName")} className="input-field" placeholder="Nome" />
            {errors.emergencyContactName && <p className="text-red-500 text-xs mt-1">{errors.emergencyContactName.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Telefone emergência *</label>
            <input {...register("emergencyContactPhone")} className="input-field" placeholder="(11) 99999-9999" />
            {errors.emergencyContactPhone && <p className="text-red-500 text-xs mt-1">{errors.emergencyContactPhone.message}</p>}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Informações médicas</label>
          <textarea {...register("medicalNotes")} className="input-field" rows={2} placeholder="Alergias, condições médicas..." />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cupom de desconto</label>
          <input {...register("couponCode")} className="input-field" placeholder="Código do cupom" />
        </div>
      </div>

      <div className="card">
        <h3 className="font-semibold mb-3">Pagamento</h3>
        <div className="space-y-2">
          {[
            { value: "PIX", label: "Pix" },
            { value: "CREDIT_CARD", label: "Cartão de crédito" },
            { value: "BOLETO", label: "Boleto" },
          ].map((m) => (
            <label key={m.value} className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
              <input type="radio" value={m.value} {...register("paymentMethod")} />
              <span>{m.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="flex items-start gap-3">
          <input type="checkbox" id="terms" {...register("acceptTerms")} className="mt-1" />
          <label htmlFor="terms" className="text-sm text-gray-700">
            Li e aceito os{" "}
            <a href="/termos" target="_blank" className="text-primary-600 underline">Termos de Uso</a>{" "}
            e a{" "}
            <a href="/privacidade" target="_blank" className="text-primary-600 underline">Política de Privacidade</a>,
            e estou ciente das condições do evento.
          </label>
        </div>
        {errors.acceptTerms && <p className="text-red-500 text-xs mt-2">{errors.acceptTerms.message}</p>}
      </div>

      <div className="card">
        <div className="flex justify-between items-center text-lg font-bold mb-4">
          <span>Total</span>
          <span className="text-primary-600">{selectedBatch ? formatCurrency(selectedBatch.priceAmount) : "—"}</span>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>
        )}

        <button type="submit" className="btn-primary w-full text-lg" disabled={isSubmitting}>
          {isSubmitting ? "Processando..." : "Confirmar Inscrição"}
        </button>
      </div>
    </form>
  );
}
