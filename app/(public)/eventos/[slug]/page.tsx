import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEventBySlug } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import Link from "next/link";
import Image from "next/image";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return { title: "Evento não encontrado" };
  return {
    title: event.title,
    description: event.description?.substring(0, 160),
  };
}

export default async function EventoPage({ params }: Props) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const canRegister = event.status === "REGISTRATIONS_OPEN";
  const availableBatches = event.ticketBatches.filter(
    (b) => b.soldCount < b.capacity
  );

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      {event.bannerUrl && (
        <div className="relative w-full aspect-[3/1] rounded-2xl overflow-hidden mb-8 bg-gray-100 dark:bg-gray-800">
          <Image src={event.bannerUrl} alt={event.title} fill className="object-contain" />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <div>
            <span className="text-sm text-primary-600 font-medium uppercase tracking-wide">
              {event.modality.replace("_", " ")}
            </span>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-1">{event.title}</h1>
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
            <span>📅 {format(new Date(event.startAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>
            <span>📍 {event.venueName}, {event.city}/{event.state}</span>
          </div>

          {event.description && (
            <div>
              <h2 className="text-lg font-semibold mb-2">Sobre o evento</h2>
              <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{event.description}</p>
            </div>
          )}

          {event.routes.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">Percursos</h2>
              <div className="space-y-2">
                {event.routes.map((route) => (
                  <div key={route.id} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <span className="font-medium">{route.name}</span>
                    <span className="text-gray-600 dark:text-gray-400">{route.distanceKm} km</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(event.regulationText || event.regulationUrl) && (
            <div>
              <h2 className="text-lg font-semibold mb-3">Regulamento</h2>
              {event.regulationUrl && (
                <a
                  href={event.regulationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline mb-3"
                >
                  📄 Baixar PDF do regulamento
                </a>
              )}
              {event.regulationText && (
                <div className="text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap">
                  {event.regulationText}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="card sticky top-4">
            <h3 className="font-semibold text-lg mb-4">Inscrições</h3>

            {availableBatches.length > 0 ? (
              <div className="space-y-3 mb-4">
                {availableBatches.map((batch) => (
                  <div key={batch.id} className="border rounded-lg p-3">
                    <div className="flex justify-between">
                      <span className="font-medium text-sm">{batch.name}</span>
                      <span className="text-primary-600 font-bold">{formatCurrency(batch.priceAmount)}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {batch.capacity - batch.soldCount} vagas restantes
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm mb-4">Sem lotes disponíveis</p>
            )}

            {canRegister && availableBatches.length > 0 ? (
              <Link href={`/inscricao/${event.slug}`} className="btn-primary w-full text-center block">
                Inscrever-se
              </Link>
            ) : (
              <button disabled className="btn-primary w-full opacity-50 cursor-not-allowed">
                {event.status === "SOLD_OUT" ? "Esgotado" : "Inscrições fechadas"}
              </button>
            )}

          </div>
        </aside>
      </div>
    </main>
  );
}
