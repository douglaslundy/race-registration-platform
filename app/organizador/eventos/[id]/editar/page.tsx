import { requireOrganizer, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import EditEventForm from "@/components/organizer/EditEventForm";
import EventDailySummaryRecipientsManager from "@/components/organizer/EventDailySummaryRecipientsManager";
import { getCancellationPolicyEnabled } from "@/lib/settings";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Editar Evento" };

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrganizer();
  const { id } = await params;
  const scope = await resolveActingScope(session);

  const [event, cancellationPolicyEnabled] = await Promise.all([
    db.event.findFirst({
      where: scope.actingAsAdmin ? { id } : { id, organizer: { userId: session.user.id } },
      select: {
        id: true, title: true, description: true, modality: true,
        startAt: true, kitPickupAt: true, venueName: true, addressLine: true,
        city: true, state: true, maxParticipants: true, organizerContact: true, sponsorLink: true,
        organizerNameOverride: true, organizerDescriptionOverride: true,
        organizerEmailOverride: true, organizerPhoneOverride: true,
        bannerUrl: true, listBannerUrl: true, regulationUrl: true, regulationText: true,
        metaTitle: true, metaDescription: true,
        cancellationDeadline: true, cancellationRequiresApproval: true,
        cancellationContactPhone: true, cancellationContactEmail: true,
        allowProxyRegistration: true,
        shirtSizeRestrictionDate: true, shirtSizeRestrictionSizes: true,
      },
    }),
    getCancellationPolicyEnabled(),
  ]);

  if (!event) notFound();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/organizador/eventos/${id}`} className="hover:text-primary-600">← Voltar ao evento</Link>
      </div>
      <h1 className="text-2xl font-bold">Editar evento</h1>
      <EditEventForm event={event} cancellationPolicyEnabled={cancellationPolicyEnabled} />
      <EventDailySummaryRecipientsManager eventId={id} />
    </div>
  );
}
