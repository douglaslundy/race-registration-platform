"use client";

import { useState } from "react";
import Link from "next/link";

export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setLoading(false);
    setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Recuperar senha</h1>
          <p className="text-gray-500 mt-2 text-sm">Enviaremos um link de redefinição para o seu email</p>
        </div>

        {sent ? (
          <div className="card text-center space-y-4">
            <p className="text-4xl">📧</p>
            <p className="font-semibold">Email enviado!</p>
            <p className="text-sm text-gray-600">
              Se <strong>{email}</strong> estiver cadastrado, você receberá o link em breve. Verifique também o spam.
            </p>
            <Link href="/auth/login" className="btn-primary block">
              Voltar ao login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input w-full"
                placeholder="seu@email.com"
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Enviando..." : "Enviar link de recuperação"}
            </button>
            <p className="text-center text-sm text-gray-500">
              Lembrou a senha?{" "}
              <Link href="/auth/login" className="text-primary-600 hover:underline">
                Fazer login
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
