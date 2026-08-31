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
    select: {
      id: true,
      title: true,
      bannerUrl: true,
      listBannerUrl: true,
      resultsSubtitle: true,
      resultFiles: {
        orderBy: { createdAt: "asc" },
        select: { id: true, label: true, fileUrl: true },
      },
    },
  });
  if (!event) notFound();

  const latestImport = await db.resultImport.findFirst({
    where: { eventId: event.id, published: true },
    orderBy: { publishedAt: "desc" },
  });

  const availableCategories = latestImport
    ? await db.raceResult.findMany({
        where: { importId: latestImport.id, category: { not: null } },
        select: { category: true },
        distinct: ["category"],
        orderBy: { category: "asc" },
      })
    : [];

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
          ...(sp.categoria ? { category: { equals: sp.categoria, mode: "insensitive" } } : {}),
          ...(sp.genero ? { gender: sp.genero } : {}),
        },
        orderBy: { placementGeneral: "asc" },
        take: 200,
      })
    : [];

  const bannerUrl = event.bannerUrl ?? event.listBannerUrl;
  const hasPdfs = event.resultFiles.length > 0;
  const hasAnything = hasPdfs || Boolean(latestImport);

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-center text-2xl font-extrabold tracking-widest text-green-700 dark:text-green-500 uppercase mb-6">
        Resultados
      </h1>

      {bannerUrl ? (
        <div className="relative w-full max-w-md mx-auto aspect-[3/1] mb-6">
          <img src={bannerUrl} alt={event.title} className="w-full h-full object-contain" />
        </div>
      ) : (
        <h2 className="text-center text-xl font-semibold mb-6">{event.title}</h2>
      )}

      {event.resultsSubtitle && (
        <p className="text-center text-3xl font-extrabold text-primary-700 dark:text-primary-400 mb-8">
          {event.resultsSubtitle}
        </p>
      )}

      {hasPdfs && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto mb-10">
          {event.resultFiles.map((f) => (
            <a
              key={f.id}
              href={f.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl bg-slate-800 text-white shadow-lg px-4 py-6 text-center font-bold uppercase underline hover:bg-slate-700 transition-colors"
            >
              {f.label}
            </a>
          ))}
        </div>
      )}

      {!hasAnything && (
        <p className="text-gray-500 text-center py-12">Resultados ainda não publicados.</p>
      )}

      {latestImport && (
        <>
          <h2 className="text-lg font-semibold mb-4">Classificação detalhada</h2>
          <form className="flex gap-3 mb-6">
            <input name="q" defaultValue={sp.q} className="input-field flex-1" placeholder="Buscar por nome ou número..." />
            <select name="categoria" defaultValue={sp.categoria} className="input-field w-40">
              <option value="">Todas as categorias</option>
              {availableCategories.map((c) => (
                <option key={c.category} value={c.category ?? ""}>
                  {c.category}
                </option>
              ))}
            </select>
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
