"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

function NovaSenhaForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";
  const email = searchParams.get("email") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    setError(null);

    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, token, password }),
    });

    if (res.ok) {
      router.push("/auth/login?msg=senha-redefinida");
    } else {
      const data = await res.json();
      setError(data.error ?? "Erro ao redefinir senha.");
    }
    setLoading(false);
  }

  if (!token || !email) {
    return (
      <div className="card text-center space-y-4">
        <p className="text-red-600">Link inválido ou expirado.</p>
        <Link href="/auth/recuperar-senha" className="btn-primary block">
          Solicitar novo link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input w-full"
          placeholder="Mínimo 8 caracteres"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar senha</label>
        <input
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="input w-full"
        />
      </div>
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? "Salvando..." : "Definir nova senha"}
      </button>
    </form>
  );
}

export default function NovaSenhaPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Nova senha</h1>
          <p className="text-gray-500 mt-2 text-sm">Digite e confirme sua nova senha</p>
        </div>
        <Suspense fallback={<div className="card text-center py-4 text-gray-500">Carregando...</div>}>
          <NovaSenhaForm />
        </Suspense>
        <p className="text-center text-sm text-gray-500 mt-4">
          <Link href="/auth/login" className="text-primary-600 hover:underline">
            Voltar ao login
          </Link>
        </p>
      </div>
    </div>
  );
}
