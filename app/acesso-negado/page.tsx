import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Acesso Negado" };

export default function AcessoNegadoPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-md">
        <div className="text-6xl mb-6">🔒</div>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">Acesso negado</h1>
        <p className="text-gray-600 mb-8">
          Você não tem permissão para acessar esta página. Se acredita que isso é um erro,
          entre em contato com o suporte.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/" className="btn-primary">Ir para a Home</Link>
          <Link href="/auth/login" className="btn-secondary">Trocar de conta</Link>
        </div>
      </div>
    </div>
  );
}
