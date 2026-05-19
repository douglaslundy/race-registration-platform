import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import ExportCsvButton from "@/components/organizer/ExportCsvButton";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Inscritos" };

import { BADGE } from "@/lib/badge-colors";

const STATUS_COLOR: Record<string, string> = {
  PENDING_PAYMENT: BADGE.yellow,
  CONFIRMED:       BADGE.green,
  CANCELLED:       BADGE.red,
  TRANSFERRED:     BADGE.blue,
  WAITLISTED:      BADGE.gray,
};

export default async function InscritosPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrganizer();
  const { id } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    select: { id: true, title: true },
  });
  if (!event) notFound();

  const registrations = await db.registration.findMany({
    where: { eventId: id },
    include: {
      athlete: { select: { name: true, email: true } },
      route: { select: { name: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">← Voltar ao evento</Link>
          <h1 className="text-xl font-bold mt-1">Inscritos — {event.title}</h1>
          <p className="text-sm text-gray-500">{registrations.length} inscrições</p>
        </div>
        <ExportCsvButton eventId={id} />
      </div>

      {registrations.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">Nenhuma inscrição ainda.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2 pr-4">Atleta</th>
                <th className="pb-2 pr-4">Percurso</th>
                <th className="pb-2 pr-4">Categoria</th>
                <th className="pb-2 pr-4">Lote</th>
                <th className="pb-2 pr-4">Camiseta</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 pr-4">
                    <p className="font-medium">{r.athlete.name}</p>
                    <p className="text-xs text-gray-500">{r.athlete.email}</p>
                  </td>
                  <td className="py-2 pr-4 text-gray-700">{r.route?.name ?? "—"}</td>
                  <td className="py-2 pr-4 text-gray-700">{r.category?.name ?? "—"}</td>
                  <td className="py-2 pr-4 text-gray-700">{r.ticketBatch.name}</td>
                  <td className="py-2 pr-4 text-gray-700">{r.shirtSize ?? "—"}</td>
                  <td className="py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[r.status] ?? ""}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
