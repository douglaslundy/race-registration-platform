"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const schema = z.object({
  name: z.string().min(2, "Nome muito curto"),
  email: z.string().email("E-mail inválido"),
  password: z.string().min(8, "Mínimo 8 caracteres"),
  companyName: z.string().min(2, "Nome da empresa muito curto"),
  contactEmail: z.string().email("E-mail de contato inválido"),
  contactPhone: z.string().min(8, "Telefone inválido"),
});

type FormData = z.infer<typeof schema>;

export default function RegisterAdvertiserForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    setError(null);
    const res = await fetch("/api/auth/register-advertiser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Erro ao criar conta");
      return;
    }

    router.push("/auth/login?registered=1");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nome da empresa *</label>
        <input {...register("companyName")} className="input-field" placeholder="Razão social ou nome fantasia" />
        {errors.companyName && <p className="text-red-500 text-xs mt-1">{errors.companyName.message}</p>}
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

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
        {isSubmitting ? "Criando conta..." : "Criar conta de anunciante"}
      </button>

      <p className="text-center text-sm text-gray-600">
        Já tem conta?{" "}
        <Link href="/auth/login" className="text-primary-600 hover:underline font-medium">
          Entrar
        </Link>
      </p>
    </form>
  );
}
