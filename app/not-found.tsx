import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Página não encontrada" };

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-md">
        <div className="text-8xl font-black text-primary-100 mb-2">404</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">Página não encontrada</h1>
        <p className="text-gray-600 mb-8">
          A página que você procura não existe ou foi removida.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/eventos" className="btn-primary">Ver Eventos</Link>
          <Link href="/" className="btn-secondary">Voltar ao início</Link>
        </div>
      </div>
    </div>
  );
}
