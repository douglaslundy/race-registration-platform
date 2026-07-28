"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";

const schema = z.object({
  name: z.string().min(2, "Nome muito curto").optional(),
  email: z.string().email("E-mail inválido").optional(),
  password: z.string().min(8, "Mínimo 8 caracteres").optional(),
  companyName: z.string().min(2, "Nome muito curto"),
  document: z.string().min(11, "CPF ou CNPJ inválido"),
  address: z.string().min(5, "Endereço muito curto"),
  contactEmail: z.string().email("E-mail de contato inválido"),
  contactPhone: z.string().min(8, "Telefone inválido"),
  instagram: z.string().optional(),
  facebook: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export default function RequestAdvertiserForm({
  adPlanId,
  isLoggedIn,
}: {
  adPlanId: string;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function onSubmit(data: FormData) {
    setError(null);

    const newAccount = isLoggedIn
      ? undefined
      : { name: data.name!, email: data.email!, password: data.password! };

    const res = await fetch("/api/anunciante/solicitar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newAccount,
        profile: {
          companyName: data.companyName,
          document: data.document,
          address: data.address,
          contactEmail: data.contactEmail,
          contactPhone: data.contactPhone,
          instagram: data.instagram || null,
          facebook: data.facebook || null,
        },
        adPlanId,
        paymentMethod: "PIX",
      }),
    });

    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Erro ao enviar solicitação");
      return;
    }

    router.push("/anuncie/enviado");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {!isLoggedIn && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Seu nome *</label>
            <input {...register("name")} className="input-field" placeholder="Seu nome" />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-mail de acesso *</label>
            <input type="email" {...register("email")} className="input-field" placeholder="seu@email.com" />
            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Senha *</label>
            <input type="password" {...register("password")} className="input-field" placeholder="Mínimo 8 caracteres" />
            {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
          </div>
        </>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Razão social / nome fantasia *</label>
        <input {...register("companyName")} className="input-field" />
        {errors.companyName && <p className="text-red-500 text-xs mt-1">{errors.companyName.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">CNPJ ou CPF *</label>
        <input {...register("document")} className="input-field" placeholder="00.000.000/0000-00" />
        {errors.document && <p className="text-red-500 text-xs mt-1">{errors.document.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Endereço *</label>
        <input {...register("address")} className="input-field" placeholder="Rua, número, cidade/UF" />
        {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">E-mail de contato comercial *</label>
        <input type="email" {...register("contactEmail")} className="input-field" placeholder="contato@empresa.com" />
        {errors.contactEmail && <p className="text-red-500 text-xs mt-1">{errors.contactEmail.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Telefone de contato *</label>
        <input type="tel" {...register("contactPhone")} className="input-field" placeholder="(11) 99999-9999" />
        {errors.contactPhone && <p className="text-red-500 text-xs mt-1">{errors.contactPhone.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Instagram (opcional)</label>
        <input {...register("instagram")} className="input-field" placeholder="@suaempresa" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Facebook (opcional)</label>
        <input {...register("facebook")} className="input-field" placeholder="facebook.com/suaempresa" />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
        {isSubmitting ? "Enviando..." : "Solicitar conta de anunciante e pagar"}
      </button>
    </form>
  );
}
