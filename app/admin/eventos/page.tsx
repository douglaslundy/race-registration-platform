import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import Link from "next/link";
import ApproveEventButton from "@/components/admin/ApproveEventButton";
import type { EventStatus } from "@prisma/client";

interface SearchParams {
  status?: string;
}

export default async function AdminEventosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = await searchParams;
  const status = (params.status as EventStatus) || undefined;

  const events = await db.event.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      organizer: { include: { user: { select: { name: true, email: true } } } },
      _count: { select: { registrations: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Eventos</h1>
        <div className="flex gap-2 text-sm">
          {["", "UNDER_REVIEW", "PUBLISHED", "DRAFT", "CANCELLED"].map((s) => (
            <Link
              key={s}
              href={s ? `/admin/eventos?status=${s}` : "/admin/eventos"}
              className={`px-3 py-1 rounded border ${status === s || (!status && !s) ? "bg-primary-600 text-white border-primary-600" : "bg-white"}`}
            >
              {s || "Todos"}
            </Link>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Evento</th>
              <th className="pb-2">Organizador</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Inscrições</th>
              <th className="pb-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="py-3 font-medium">{event.title}</td>
                <td className="py-3 text-gray-600">{event.organizer.user.name}</td>
                <td className="py-3">
                  <span className="text-xs bg-gray-100 px-2 py-1 rounded">{event.status}</span>
                </td>
                <td className="py-3">{event._count.registrations}</td>
                <td className="py-3">
                  <div className="flex gap-2 items-center">
                    {event.status === "UNDER_REVIEW" && (
                      <ApproveEventButton eventId={event.id} />
                    )}
                    <Link href={`/admin/eventos/${event.id}`} className="text-xs text-primary-600 hover:underline">
                      Detalhes
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
