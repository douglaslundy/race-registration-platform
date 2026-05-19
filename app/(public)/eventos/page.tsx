import type { Metadata } from "next";
import { listPublicEvents, listDistinctCities } from "@/lib/events";
import EventCard from "@/components/events/EventCard";
import EventFilters from "@/components/events/EventFilters";
import type { EventModality } from "@prisma/client";

export const metadata: Metadata = { title: "Eventos" };
export const revalidate = 60;

interface SearchParams {
  cidade?: string;
  modalidade?: string;
  de?: string;
  ate?: string;
  pagina?: string;
}

export default async function EventosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;

  const { events, total, totalPages, page } = await listPublicEvents({
    city: params.cidade,
    modality: params.modalidade as EventModality | undefined,
    from: params.de ? new Date(params.de) : undefined,
    to: params.ate ? new Date(params.ate) : undefined,
    page: params.pagina ? Number(params.pagina) : 1,
  });

  const cities = await listDistinctCities();

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Eventos</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">{total} evento{total !== 1 ? "s" : ""} encontrado{total !== 1 ? "s" : ""}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <aside>
          <EventFilters cities={cities} />
        </aside>

        <div className="lg:col-span-3">
          {events.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-lg">Nenhum evento encontrado</p>
              <p className="text-sm mt-2">Tente ajustar os filtros</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {events.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex justify-center mt-8 gap-2">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <a
                      key={p}
                      href={`?pagina=${p}`}
                      className={`px-3 py-1 rounded ${p === page ? "bg-primary-600 text-white" : "bg-white dark:bg-gray-800 border dark:border-gray-700 dark:text-gray-300"}`}
                    >
                      {p}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
