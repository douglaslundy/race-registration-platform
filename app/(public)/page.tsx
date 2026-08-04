import type { Metadata } from "next";
import Link from "next/link";
import { getAppName, getSetting, getBannerInterval } from "@/lib/settings";
import JsonLd from "@/components/seo/JsonLd";
import { listPublicEvents } from "@/lib/events";
import EventCard from "@/components/events/EventCard";
import EventsBanner from "@/components/events/EventsBanner";
import OrganizerCTA from "@/components/events/OrganizerCTA";
import AdSlotRenderer from "@/components/ads/AdSlotRenderer";

export async function generateMetadata(): Promise<Metadata> {
  const [appName, defaultTitle, defaultDescription] = await Promise.all([
    getAppName(),
    getSetting("seo_default_title"),
    getSetting("seo_default_description"),
  ]);
  return {
    title: {
      absolute: defaultTitle || `${appName} — Inscrições para Corridas de Rua, Trail Run e Eventos Esportivos`,
    },
    description:
      defaultDescription ||
      "Encontre e se inscreva em corridas de rua, trail run e eventos esportivos perto de você. Inscrição online, pagamento seguro via Pix, cartão ou boleto.",
  };
}

export const revalidate = 60;

export default async function HomePage() {
  const [appName, { events }, bannerInterval] = await Promise.all([
    getAppName(),
    listPublicEvents({ pageSize: 6 }),
    getBannerInterval(),
  ]);
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

        <div className="max-w-7xl mx-auto px-4 pb-16 space-y-8">
          <EventsBanner intervalSeconds={bannerInterval} />

          <AdSlotRenderer position="HOME_ABAIXO_BANNER" />

          {events.length > 0 && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Próximos eventos</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {events.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
              <div className="flex justify-center mt-8">
                <Link href="/eventos" className="btn-secondary px-8 py-3">
                  Ver todos os eventos
                </Link>
              </div>
            </div>
          )}

          <AdSlotRenderer position="HOME_ENTRE_EVENTOS_CTA" />
        </div>
      </main>
      <OrganizerCTA appName={appName} />
    </>
  );
}
