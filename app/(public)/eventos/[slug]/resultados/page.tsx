import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; categoria?: string; genero?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await db.event.findUnique({ where: { slug }, select: { title: true } });
  return { title: event ? `Resultados — ${event.title}` : "Resultados" };
}

export default async function ResultadosPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;

  const event = await db.event.findUnique({
    where: { slug },
    select: { id: true, title: true },
  });
  if (!event) notFound();

  const latestImport = await db.resultImport.findFirst({
    where: { eventId: event.id, published: true },
    orderBy: { publishedAt: "desc" },
  });

  const results = latestImport
    ? await db.raceResult.findMany({
        where: {
          importId: latestImport.id,
          ...(sp.q ? {
            OR: [
              { athleteName: { contains: sp.q, mode: "insensitive" } },
              { bibNumber: { contains: sp.q } },
            ],
          } : {}),
          ...(sp.categoria ? { category: { contains: sp.categoria, mode: "insensitive" } } : {}),
          ...(sp.genero ? { gender: sp.genero } : {}),
        },
        orderBy: { placementGeneral: "asc" },
        take: 200,
      })
    : [];

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">{event.title}</h1>
      <h2 className="text-lg text-gray-600 mb-6">Resultados</h2>

      {!latestImport ? (
        <p className="text-gray-500 text-center py-12">Resultados ainda não publicados.</p>
      ) : (
        <>
          <form className="flex gap-3 mb-6">
            <input name="q" defaultValue={sp.q} className="input-field flex-1" placeholder="Buscar por nome ou número..." />
            <select name="genero" defaultValue={sp.genero} className="input-field w-32">
              <option value="">Gênero</option>
              <option value="M">Masculino</option>
              <option value="F">Feminino</option>
            </select>
            <button type="submit" className="btn-primary px-6">Buscar</button>
          </form>

          {results.length === 0 ? (
            <p className="text-gray-500 text-center py-8">Nenhum resultado encontrado</p>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="pb-2">Pos.</th>
                    <th className="pb-2">Nº</th>
                    <th className="pb-2">Atleta</th>
                    <th className="pb-2">Percurso</th>
                    <th className="pb-2">Categoria</th>
                    <th className="pb-2">Tempo bruto</th>
                    <th className="pb-2">Tempo líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.id} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="py-2 font-bold text-primary-600">{r.placementGeneral ?? "—"}</td>
                      <td className="py-2">{r.bibNumber}</td>
                      <td className="py-2 font-medium">{r.athleteName}</td>
                      <td className="py-2 text-gray-500">{r.route ?? "—"}</td>
                      <td className="py-2 text-gray-500">{r.category ?? "—"}</td>
                      <td className="py-2 font-mono">{r.grossTime ?? "—"}</td>
                      <td className="py-2 font-mono">{r.netTime ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
