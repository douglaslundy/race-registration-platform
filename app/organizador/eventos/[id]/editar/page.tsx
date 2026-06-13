import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import EditEventForm from "@/components/organizer/EditEventForm";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Editar Evento" };

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrganizer();
  const { id } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    select: {
      id: true, title: true, description: true, modality: true,
      startAt: true, kitPickupAt: true, venueName: true, addressLine: true,
      city: true, state: true, maxParticipants: true, organizerContact: true,
      bannerUrl: true, regulationUrl: true, regulationText: true,
    },
  });

  if (!event) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/organizador/eventos/${id}`} className="hover:text-primary-600">← Voltar ao evento</Link>
      </div>
      <h1 className="text-2xl font-bold">Editar evento</h1>
      <EditEventForm event={event} />
    </div>
  );
}
