import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAnyPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import ResultadosClient from "./ResultadosClient";
import EventResultFilesManager from "@/components/organizer/EventResultFilesManager";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAnyPermission(["results.import", "results.publish"], { eventId: id });

  const scope = await resolveActingScope(session);
  const select = {
    id: true,
    slug: true,
    resultsSubtitle: true,
    resultFiles: {
      orderBy: { createdAt: "asc" as const },
      select: { id: true, label: true, fileUrl: true },
    },
  };
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id }, select })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" }, select });
  if (!event) notFound();

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">← Voltar</Link>
        <h1 className="text-xl font-bold mt-1">Resultados</h1>
      </div>

      <EventResultFilesManager
        eventId={id}
        slug={event.slug}
        initialSubtitle={event.resultsSubtitle}
        initialFiles={event.resultFiles}
      />

      <ResultadosClient />
    </div>
  );
}
