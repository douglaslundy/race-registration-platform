"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isValidCpf } from "@/lib/cpf";
import { isValidCep, fetchAddressByCep } from "@/lib/cep";

const schema = z
  .object({
    name: z.string().min(2, "Nome muito curto"),
    email: z.string().email("E-mail inválido"),
    password: z.string().min(8, "Mínimo 8 caracteres"),
    role: z.enum(["ATHLETE", "ORGANIZER"]),
    birthDate: z.string().optional(),
    cpf: z.string().optional(),
    phone: z.string().optional(),
    postalCode: z.string().optional(),
    street: z.string().optional(),
    number: z.string().optional(),
    noNumber: z.boolean().optional(),
    complement: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role !== "ATHLETE") return;

    if (!data.birthDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe sua data de nascimento",
        path: ["birthDate"],
      });
    }

    if (!data.cpf) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe seu CPF",
        path: ["cpf"],
      });
    } else if (!isValidCpf(data.cpf)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CPF inválido",
        path: ["cpf"],
      });
    }

    if (!data.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe seu telefone",
        path: ["phone"],
      });
    } else if (data.phone.replace(/\D/g, "").length < 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Telefone inválido",
        path: ["phone"],
      });
    }

    if (!data.postalCode || !isValidCep(data.postalCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe um CEP válido",
        path: ["postalCode"],
      });
    }

    if (!data.street) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe a rua/logradouro",
        path: ["street"],
      });
    }

    if (!data.noNumber && !data.number) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe o número ou marque 'Sem número'",
        path: ["number"],
      });
    }

    if (!data.neighborhood) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe o bairro",
        path: ["neighborhood"],
      });
    }

    if (!data.city) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe a cidade",
        path: ["city"],
      });
    }

    if (!data.state) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe o estado",
        path: ["state"],
      });
    }
  });

type FormData = z.infer<typeof schema>;

export default function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { role: "ATHLETE" },
  });
  const role = watch("role");
  const noNumber = watch("noNumber");
  const cepField = register("postalCode");

  async function onSubmit(data: FormData) {
    setError(null);
    const payload = { ...data, number: data.noNumber ? "S/N" : data.number };
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json();
      setError(body.error || "Erro ao criar conta");
      return;
    }

    router.push("/auth/login?registered=1");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nome completo *</label>
        <input {...register("name")} className="input-field" placeholder="Seu nome" />
        {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">E-mail *</label>
        <input type="email" {...register("email")} className="input-field" placeholder="seu@email.com" />
        {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Senha *</label>
        <input type="password" {...register("password")} className="input-field" placeholder="Mínimo 8 caracteres" />
        {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de conta</label>
        <select {...register("role")} className="input-field">
          <option value="ATHLETE">Atleta</option>
          <option value="ORGANIZER">Organizador de eventos</option>
        </select>
      </div>

      {role === "ATHLETE" && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data de nascimento *</label>
            <input type="date" {...register("birthDate")} className="input-field" />
            {errors.birthDate && <p className="text-red-500 text-xs mt-1">{errors.birthDate.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CPF *</label>
            <input
              type="text"
              {...register("cpf")}
              className="input-field"
              placeholder="000.000.000-00"
              maxLength={14}
            />
            {errors.cpf && <p className="text-red-500 text-xs mt-1">{errors.cpf.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Telefone / WhatsApp *</label>
            <input
              type="tel"
              {...register("phone")}
              className="input-field"
              placeholder="(11) 99999-9999"
            />
            {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CEP *</label>
            <input
              type="text"
              {...cepField}
              onBlur={async (e) => {
                cepField.onBlur(e);
                const address = await fetchAddressByCep(e.target.value);
                if (address) {
                  setValue("street", address.street);
                  setValue("neighborhood", address.neighborhood);
                  setValue("city", address.city);
                  setValue("state", address.state);
                }
              }}
              className="input-field"
              placeholder="00000-000"
              maxLength={9}
            />
            {errors.postalCode && <p className="text-red-500 text-xs mt-1">{errors.postalCode.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rua/Logradouro *</label>
            <input type="text" {...register("street")} className="input-field" />
            {errors.street && <p className="text-red-500 text-xs mt-1">{errors.street.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Número *</label>
            <input
              type="text"
              {...register("number")}
              disabled={noNumber}
              className="input-field disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            {errors.number && <p className="text-red-500 text-xs mt-1">{errors.number.message}</p>}
            <label className="flex items-center gap-2 mt-1 text-sm text-gray-600">
              <input type="checkbox" {...register("noNumber")} />
              Sem número
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Complemento</label>
            <input type="text" {...register("complement")} className="input-field" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bairro *</label>
            <input type="text" {...register("neighborhood")} className="input-field" />
            {errors.neighborhood && <p className="text-red-500 text-xs mt-1">{errors.neighborhood.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cidade *</label>
            <input type="text" {...register("city")} className="input-field" />
            {errors.city && <p className="text-red-500 text-xs mt-1">{errors.city.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Estado (UF) *</label>
            <input type="text" maxLength={2} {...register("state")} className="input-field" />
            {errors.state && <p className="text-red-500 text-xs mt-1">{errors.state.message}</p>}
          </div>
        </>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
        {isSubmitting ? "Criando conta..." : "Criar conta"}
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
