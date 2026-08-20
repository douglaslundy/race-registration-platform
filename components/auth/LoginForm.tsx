"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { isSafeRedirectPath } from "@/lib/auth/safe-redirect";

const schema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(6, "Mínimo 6 caracteres"),
});

type FormData = z.infer<typeof schema>;

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function onSubmit(data: FormData) {
    setError(null);
    const res = await signIn("credentials", { ...data, redirect: false });
    if (res?.error) {
      setError("E-mail ou senha incorretos");
      return;
    }
    const callbackUrl = searchParams.get("callbackUrl");
    router.push(isSafeRedirectPath(callbackUrl) ? callbackUrl : "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">E-mail</label>
        <input type="email" {...register("email")} className="input-field" placeholder="seu@email.com" />
        {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Senha</label>
        <input type="password" {...register("password")} className="input-field" placeholder="••••••••" />
        {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
        {isSubmitting ? "Entrando..." : "Entrar"}
      </button>

      <p className="text-center text-sm text-gray-600 dark:text-gray-400">
        <Link href="/auth/recuperar-senha" className="text-gray-500 hover:underline">
          Esqueceu sua senha?
        </Link>
      </p>

      <p className="text-center text-sm text-gray-600 dark:text-gray-400">
        Não tem conta?{" "}
        <Link href="/auth/cadastro" className="text-primary-600 hover:underline font-medium">
          Cadastre-se
        </Link>
      </p>
    </form>
  );
}
