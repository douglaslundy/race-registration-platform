import type { Metadata } from "next";
import Link from "next/link";
import { getAppName, getSetting } from "@/lib/settings";
import JsonLd from "@/components/seo/JsonLd";

export async function generateMetadata(): Promise<Metadata> {
  const [appName, defaultTitle, defaultDescription] = await Promise.all([
    getAppName(),
    getSetting("seo_default_title"),
    getSetting("seo_default_description"),
  ]);
  return {
    title: defaultTitle || `${appName} — Inscrições para Corridas de Rua, Trail Run e Eventos Esportivos`,
    description:
      defaultDescription ||
      "Encontre e se inscreva em corridas de rua, trail run e eventos esportivos perto de você. Inscrição online, pagamento seguro via Pix, cartão ou boleto.",
  };
}

export default async function HomePage() {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: appName,
    url: baseUrl,
  };

  return (
    <>
      <JsonLd data={organizationJsonLd} />
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
    </>
  );
}
