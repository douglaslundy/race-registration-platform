import Link from "next/link";
import { getAppName } from "@/lib/settings";

export default async function HomePage() {
  const appName = await getAppName();
  return (
    <main className="min-h-screen bg-gradient-to-br from-primary-50 to-white dark:from-gray-900 dark:to-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="text-5xl font-bold text-primary-900 dark:text-primary-400 mb-4">{appName}</h1>
        <p className="text-xl text-gray-600 dark:text-gray-300 mb-8">
          Plataforma de inscrições para corridas de rua, trail run e mais.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/eventos" className="btn-primary text-lg px-8 py-3">
            Ver Eventos
          </Link>
          <Link href="/auth/cadastro" className="btn-secondary text-lg px-8 py-3">
            Criar Conta
          </Link>
        </div>
      </div>
    </main>
  );
}
