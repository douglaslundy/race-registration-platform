"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/format";
import { emptyStringToUndefined, extractApiErrorMessage, optionalEnumField, opaqueIdField, optionalOpaqueIdField } from "@/lib/checkout-validation";
import { PAYMENT_METHOD_LABELS, type CheckoutPaymentMethod } from "@/lib/payment-methods";
import { getAllowedShirtSizes } from "@/lib/shirt-size-restriction";
import type { MPCardFormHandle } from "./MPCardForm";
import type { PagarMeCardFormHandle } from "./PagarMeCardForm";
import EventDisclaimer from "@/components/events/EventDisclaimer";
import dynamic from "next/dynamic";
import ProxyAthleteModal, { type ProxyAthleteData } from "./ProxyAthleteModal";

const MPCardForm = dynamic(() => import("./MPCardForm"), { ssr: false });
const PagarMeCardForm = dynamic(() => import("./PagarMeCardForm"), { ssr: false });

const schema = z.object({
  ticketBatchId: opaqueIdField(),
  routeId: optionalOpaqueIdField(),
  categoryId: optionalOpaqueIdField(),
  shirtSize: optionalEnumField(["PP", "P", "M", "G", "GG", "XGG"] as const),
  teamName: z.string().max(100).optional(),
  emergencyContactName: z.string().min(2, "Informe o contato de emergência"),
  emergencyContactPhone: z.string().min(8, "Telefone inválido"),
  medicalNotes: z.string().max(500).optional(),
  notes: z.string().max(200, "Máximo de 200 caracteres").optional(),
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
  shirtSizeRestrictionDate?: Date | string | null;
  shirtSizeRestrictionSizes?: string[];
}

interface AthleteProfile {
  preferredShirtSize?: string | null;
  teamName?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  medicalNotes?: string | null;
  cpf?: string | null;
}

interface CardConfig {
  provider: "sandbox" | "mercadopago" | "pagarme";
  publicKey: string | null;
}

interface CouponPreview {
  code: string;
  discountAmount: number;
  subtotalAmount: number;
}

function calcPlatformFee(subtotal: number, feePercent: number, minFee: number): number {
  const percentFee = Math.round((subtotal * feePercent) / 10000);
  return Math.max(percentFee, minFee);
}

function calcServiceFee(subtotal: number, feePercent: number, minFee: number): number {
  if (feePercent === 0 && minFee === 0) return 0;
  const percentFee = Math.round((subtotal * feePercent) / 10000);
  return Math.max(percentFee, minFee);
}

export default function CheckoutForm({
  event,
  batches,
  paymentMethods,
  userId: _userId,
  athleteProfile,
  platformFeePercent,
  defaultPlatformFee,
  serviceFeePercent = 0,
  serviceFeeMin = 0,
  appName,
  allowProxyRegistration,
}: {
  event: EventData;
  batches: Batch[];
  paymentMethods: CheckoutPaymentMethod[];
  userId: string;
  athleteProfile?: AthleteProfile;
  platformFeePercent: number;
  defaultPlatformFee: number;
  serviceFeePercent?: number;
  serviceFeeMin?: number;
  appName?: string;
  allowProxyRegistration?: boolean;
}) {
  const allowedShirtSizes = getAllowedShirtSizes(
    {
      shirtSizeRestrictionDate: event.shirtSizeRestrictionDate ? new Date(event.shirtSizeRestrictionDate) : null,
      shirtSizeRestrictionSizes: event.shirtSizeRestrictionSizes ?? [],
    },
    new Date(),
  );
  const shirtSizeRestricted = allowedShirtSizes.length < 6;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cpf, setCpf] = useState(athleteProfile?.cpf ?? "");
  const [cardConfig, setCardConfig] = useState<CardConfig | null>(null);
  const mpCardRef = useRef<MPCardFormHandle>(null);
  const pagarmeCardRef = useRef<PagarMeCardFormHandle>(null);
  const [couponPreview, setCouponPreview] = useState<CouponPreview | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [proxyAthlete, setProxyAthlete] = useState<ProxyAthleteData | null>(null);
  const [proxyModalOpen, setProxyModalOpen] = useState(false);
  const [registeringFor, setRegisteringFor] = useState<"self" | "other">("self");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      ticketBatchId: batches[0]?.id,
      paymentMethod: paymentMethods[0] ?? "PIX",
      shirtSize: allowedShirtSizes.includes(athleteProfile?.preferredShirtSize ?? "")
        ? (athleteProfile?.preferredShirtSize as FormData["shirtSize"])
        : undefined,
      teamName: athleteProfile?.teamName ?? "",
      emergencyContactName: athleteProfile?.emergencyName ?? "",
      emergencyContactPhone: athleteProfile?.emergencyPhone ?? "",
      medicalNotes: athleteProfile?.medicalNotes ?? "",
    },
  });

  const selectedBatchId = watch("ticketBatchId");
  const couponCode = watch("couponCode");
  const selectedPaymentMethod = watch("paymentMethod");
  const selectedBatch = batches.find((b) => b.id === selectedBatchId) ?? batches[0];
  const selectedCouponCode = (couponCode ?? "").trim().toUpperCase();

  useEffect(() => {
    fetch("/api/checkout/card-config")
      .then((r) => r.json())
      .then((data) => setCardConfig(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const normalizedCode = selectedCouponCode;
    if (!normalizedCode) {
      setCouponPreview(null);
      setCouponError(null);
      setCouponLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setCouponLoading(true);
      try {
        const res = await fetch(`/api/events/${event.id}/coupons/preview?code=${encodeURIComponent(normalizedCode)}&ticketBatchId=${encodeURIComponent(selectedBatchId)}`, {
          method: "GET",
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) {
          setCouponPreview(null);
          setCouponError(data.error ?? "Cupom inválido");
          return;
        }

        setCouponError(null);
        setCouponPreview({
          code: data.code,
          discountAmount: data.discountAmount,
          subtotalAmount: data.subtotalAmount,
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          setCouponPreview(null);
          setCouponError(err instanceof Error ? err.message : "Não foi possível validar o cupom");
        }
      } finally {
        if (!controller.signal.aborted) setCouponLoading(false);
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [event.id, selectedBatchId, selectedCouponCode]);

  function getFirstValidationError(messageMap: Record<string, unknown>): string {
    const orderedKeys = [
      "ticketBatchId",
      "paymentMethod",
      "acceptTerms",
      "emergencyContactName",
      "emergencyContactPhone",
      "routeId",
      "categoryId",
      "shirtSize",
      "couponCode",
      "teamName",
      "medicalNotes",
      "notes",
    ];

    for (const key of orderedKeys) {
      const value = messageMap[key];
      if (value && typeof value === "object" && "message" in value && typeof (value as { message?: unknown }).message === "string") {
        return (value as { message: string }).message;
      }
    }

    return "Revise os campos destacados.";
  }

  async function onSubmit(data: FormData) {
    setError(null);
    if (event.routes.length > 0 && !emptyStringToUndefined(data.routeId)) {
      setError("Selecione um percurso para concluir a inscrição.");
      return;
    }
    if (event.categories.length > 0 && !emptyStringToUndefined(data.categoryId)) {
      setError("Selecione uma categoria para concluir a inscrição.");
      return;
    }
    if (registeringFor === "other" && !proxyAthlete) {
      setError("Preencha os dados do atleta para quem você está se inscrevendo.");
      return;
    }
    try {
      let cardToken: string | undefined;
      let cardBrand: string | undefined;
      let installments: number | undefined;

      if (data.paymentMethod === "CREDIT_CARD" && cardConfig?.provider !== "sandbox") {
        if (cardConfig?.provider === "mercadopago" && mpCardRef.current) {
          if (!cpf.replace(/\D/g, "")) {
            setError("Informe o CPF para pagamento com cartão");
            return;
          }
          const result = await mpCardRef.current.getToken(cpf);
          cardToken = result.token;
          cardBrand = result.paymentMethodId;
          installments = result.installments;
        } else if (cardConfig?.provider === "pagarme" && pagarmeCardRef.current) {
          const result = await pagarmeCardRef.current.getToken();
          cardToken = result.token;
          installments = result.installments;
        }
      }

      const payload = {
        ...data,
        routeId: emptyStringToUndefined(data.routeId),
        categoryId: emptyStringToUndefined(data.categoryId),
        shirtSize: emptyStringToUndefined(data.shirtSize),
        couponCode: emptyStringToUndefined(data.couponCode)?.toString().trim().toUpperCase(),
        cpf: cpf || undefined,
        cardToken,
        cardBrand,
        installments,
        ...(proxyAthlete
          ? {
              proxyAthlete: {
                name: proxyAthlete.name,
                birthDate: proxyAthlete.birthDate,
                cpf: proxyAthlete.cpf,
                phone: proxyAthlete.phone,
                email: proxyAthlete.email,
              },
            }
          : {}),
      };

      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, eventId: event.id }),
      });

      const raw = await res.text();
      const body = raw ? JSON.parse(raw) : {};
      if (!res.ok) {
        setError(extractApiErrorMessage(body.error) ?? extractApiErrorMessage(body) ?? "Erro ao processar inscrição");
        return;
      }

      if (body.status === "PAID") {
        router.push(`/dashboard/inscricoes/${body.registrationId}?confirmed=1`);
        return;
      }

      // Qualquer outro status de sucesso (PIX, boleto, ou cartão em análise/contingência) sempre
      // redireciona pra página de detalhe da inscrição — ela já mostra QR code/boleto quando
      // existir e faz polling automático do status. Substituir o formulário por um card in-place
      // aqui (sem navegação) deixava a confirmação fora da área visível em formulários longos,
      // dando a impressão de que nada tinha acontecido.
      if (body.registrationId) {
        router.push(`/dashboard/inscricoes/${body.registrationId}`);
        return;
      }

      setError("Inscrição criada, mas não foi possível abrir os detalhes automaticamente. Verifique em Minhas Inscrições.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao processar inscrição");
      return;
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit, (formErrors) => {
        setError(getFirstValidationError(formErrors as Record<string, unknown>));
      })}
      className="space-y-5"
      autoComplete="off"
    >
      <input type="hidden" {...register("ticketBatchId")} />
      <input type="hidden" {...register("paymentMethod")} />
      {error && (
        <div className="card border border-red-200 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}
      {allowProxyRegistration && (
        <div className="card">
          <h3 className="font-semibold mb-3">Para quem é esta inscrição?</h3>
          <div className="space-y-2">
            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 dark:border-gray-600">
              <input
                type="radio"
                checked={registeringFor === "self"}
                onChange={() => { setRegisteringFor("self"); setProxyAthlete(null); }}
                className="accent-primary-600"
              />
              Para mim
            </label>
            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 dark:border-gray-600">
              <input
                type="radio"
                checked={registeringFor === "other"}
                onChange={() => { setRegisteringFor("other"); setProxyModalOpen(true); }}
                className="accent-primary-600"
              />
              Para outro atleta
            </label>
          </div>
          {proxyAthlete && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-primary-200 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-800 px-3 py-2 text-sm">
              <span>Inscrevendo: <strong>{proxyAthlete.name}</strong> — CPF {proxyAthlete.cpf}</span>
              <button type="button" onClick={() => setProxyModalOpen(true)} className="text-primary-600 underline text-xs">Editar</button>
            </div>
          )}
        </div>
      )}
      <ProxyAthleteModal
        open={proxyModalOpen}
        routes={event.routes}
        categories={event.categories}
        allowedShirtSizes={allowedShirtSizes}
        onSave={(saved) => {
          // ProxyAthleteData junta 2 tipos de campo num só formulário (UX de uma tela só): os de
          // IDENTIDADE (nome/nascimento/CPF/telefone/e-mail — viram o objeto proxyAthlete enviado
          // à API) e os DA INSCRIÇÃO em si (percurso/categoria/camiseta/equipe/contato de
          // emergência/observação médica — que já são campos do formulário principal, geridos
          // pelo mesmo react-hook-form de uma inscrição normal). Sem este setValue, os dados de
          // inscrição digitados no modal nunca chegariam no payload — o backend só entende
          // proxyAthlete como identidade (name/birthDate/cpf/phone/email), nada mais.
          setValue("routeId", saved.routeId ?? "", { shouldValidate: true });
          setValue("categoryId", saved.categoryId ?? "", { shouldValidate: true });
          setValue(
            "shirtSize",
            allowedShirtSizes.includes(saved.shirtSize ?? "")
              ? (saved.shirtSize as FormData["shirtSize"])
              : undefined,
          );
          setValue("teamName", saved.teamName ?? "");
          setValue("emergencyContactName", saved.emergencyContactName, { shouldValidate: true });
          setValue("emergencyContactPhone", saved.emergencyContactPhone, { shouldValidate: true });
          setValue("medicalNotes", saved.medicalNotes ?? "");
          setProxyAthlete(saved);
          setProxyModalOpen(false);
        }}
        onCancel={() => { setProxyModalOpen(false); if (!proxyAthlete) setRegisteringFor("self"); }}
      />
      <div className="card">
        <h3 className="font-semibold mb-3">Lote de inscrição</h3>
        <div className="space-y-2">
          {batches.map((b) => (
            <label
              key={b.id}
              className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 dark:border-gray-600"
              onClick={() => setValue("ticketBatchId", b.id, { shouldValidate: true, shouldDirty: true })}
            >
              <input
                type="radio"
                value={b.id}
                checked={selectedBatchId === b.id}
                onChange={() => setValue("ticketBatchId", b.id, { shouldValidate: true, shouldDirty: true })}
                name="ticketBatchId"
                className="accent-primary-600"
              />
              <div className="flex-1">
                <div className="flex justify-between">
                  <span className="font-medium">{b.name}</span>
                  <span className="text-primary-600 font-bold">{formatCurrency(b.priceAmount)}</span>
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {(() => {
                    const fee = calcPlatformFee(b.priceAmount, platformFeePercent, defaultPlatformFee);
                    const sfee = calcServiceFee(b.priceAmount, serviceFeePercent, serviceFeeMin);
                    return (
                      <span>
                        +{formatCurrency(fee)} taxa da plataforma
                        {sfee > 0 && <> · +{formatCurrency(sfee)} taxa de serviço</>}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </label>
          ))}
          {errors.ticketBatchId && <p className="text-red-500 text-xs mt-1">{errors.ticketBatchId.message}</p>}
        </div>
      </div>

      {event.routes.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3">Percurso <span className="text-red-500">*</span></h3>
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
          <h3 className="font-semibold mb-3">Categoria <span className="text-red-500">*</span></h3>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Camiseta</label>
            <select {...register("shirtSize")} className="input-field">
              <option value="">Selecione</option>
              {allowedShirtSizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {shirtSizeRestricted && event.shirtSizeRestrictionDate && (
              <p className="text-xs text-gray-500 mt-1">
                Alguns tamanhos deixaram de estar disponíveis a partir de{" "}
                {new Date(event.shirtSizeRestrictionDate).toLocaleDateString("pt-BR")}.
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Equipe / Assessoria</label>
            <input {...register("teamName")} className="input-field" placeholder="Opcional" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome do contato de emergência *</label>
            <input {...register("emergencyContactName")} className="input-field" placeholder="Nome" />
            {errors.emergencyContactName && <p className="text-red-500 text-xs mt-1">{errors.emergencyContactName.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone emergência *</label>
            <input {...register("emergencyContactPhone")} className="input-field" placeholder="(11) 99999-9999" />
            {errors.emergencyContactPhone && <p className="text-red-500 text-xs mt-1">{errors.emergencyContactPhone.message}</p>}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Informações médicas</label>
          <textarea {...register("medicalNotes")} className="input-field" rows={2} placeholder="Alergias, condições médicas..." />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Observação (opcional)</label>
          <textarea
            {...register("notes")}
            className="input-field"
            rows={2}
            maxLength={200}
            placeholder="Alguma informação adicional para o organizador?"
          />
          <p className="text-xs text-gray-400 mt-1 text-right">{(watch("notes") ?? "").length}/200</p>
          {errors.notes && <p className="text-red-500 text-xs mt-1">{errors.notes.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cupom de desconto</label>
          <input {...register("couponCode")} className="input-field" placeholder="Código do cupom" />
        </div>
      </div>

      <div className="card">
        <h3 className="font-semibold mb-3">Pagamento</h3>
        <div className="space-y-2">
          {paymentMethods.map((method) => (
            <label
              key={method}
              className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 dark:border-gray-600"
              onClick={() => setValue("paymentMethod", method, { shouldValidate: true, shouldDirty: true })}
            >
              <input
                type="radio"
                value={method}
                checked={selectedPaymentMethod === method}
                onChange={() => setValue("paymentMethod", method, { shouldValidate: true, shouldDirty: true })}
                name="paymentMethod"
                className="accent-primary-600"
              />
              <span>{PAYMENT_METHOD_LABELS[method]}</span>
            </label>
          ))}
        </div>
        {errors.paymentMethod && <p className="text-red-500 text-xs mt-2">{errors.paymentMethod.message}</p>}
      </div>

      {selectedPaymentMethod === "CREDIT_CARD" && cardConfig && cardConfig.provider !== "sandbox" && (
        <div className="card space-y-4">
          <h3 className="font-semibold">Dados do cartão</h3>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CPF do titular *</label>
            <input
              type="text"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              className="input-field w-full"
              placeholder="000.000.000-00"
              maxLength={14}
            />
          </div>

          {cardConfig.publicKey ? (
            <>
              {cardConfig.provider === "mercadopago" && (
                <MPCardForm ref={mpCardRef} publicKey={cardConfig.publicKey} amount={
                  (() => {
                    const sub = couponPreview?.subtotalAmount ?? (selectedBatch?.priceAmount ?? 0);
                    return sub + calcPlatformFee(sub, platformFeePercent, defaultPlatformFee) + calcServiceFee(sub, serviceFeePercent, serviceFeeMin);
                  })()
                } />
              )}
              {cardConfig.provider === "pagarme" && (
                <PagarMeCardForm ref={pagarmeCardRef} publicKey={cardConfig.publicKey} amount={
                  (() => {
                    const sub = couponPreview?.subtotalAmount ?? (selectedBatch?.priceAmount ?? 0);
                    return sub + calcPlatformFee(sub, platformFeePercent, defaultPlatformFee) + calcServiceFee(sub, serviceFeePercent, serviceFeeMin);
                  })()
                } />
              )}
            </>
          ) : (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Chave pública do gateway não configurada. Acesse Admin → Configurações.
            </p>
          )}
        </div>
      )}

      {appName && <EventDisclaimer appName={appName} />}

      <div className="card">
        <div className="flex items-start gap-3">
          <input type="checkbox" id="terms" {...register("acceptTerms")} className="mt-1" />
          <label htmlFor="terms" className="text-sm text-gray-700 dark:text-gray-300">
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
        {(() => {
          const effectiveSubtotal = couponPreview?.subtotalAmount ?? (selectedBatch?.priceAmount ?? 0);
          const fee = calcPlatformFee(effectiveSubtotal, platformFeePercent, defaultPlatformFee);
          const sfee = calcServiceFee(effectiveSubtotal, serviceFeePercent, serviceFeeMin);
          const effectiveTotal = effectiveSubtotal + fee + sfee;
          return (
            <div className="space-y-1 text-sm mb-4">
              <div className="flex justify-between text-gray-600 dark:text-gray-400">
                <span>Inscrição</span>
                <span>{formatCurrency(selectedBatch?.priceAmount ?? 0)}</span>
              </div>
              {couponPreview && couponPreview.discountAmount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Desconto ({couponPreview.code})</span>
                  <span>-{formatCurrency(couponPreview.discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-600 dark:text-gray-400">
                <span>+Taxa da plataforma</span>
                <span>{formatCurrency(fee)}</span>
              </div>
              {sfee > 0 && (
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>+Taxa de serviço de ingresso</span>
                  <span>{formatCurrency(sfee)}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-lg font-bold border-t dark:border-gray-700 pt-2 mt-1">
                <span>Total</span>
                <span className="text-primary-600">{formatCurrency(effectiveTotal)}</span>
              </div>
            </div>
          );
        })()}

        {couponLoading && (
          <p className="text-xs text-gray-500 mb-3">Validando cupom...</p>
        )}
        {couponError && (
          <p className="mb-3 text-xs text-red-600">{couponError}</p>
        )}

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
