import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEventBySlug } from "@/lib/events";
import CheckoutForm from "@/components/checkout/CheckoutForm";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  return { title: event ? `Inscrição — ${event.title}` : "Evento não encontrado" };
}

export default async function InscricaoPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect(`/auth/login?callbackUrl=/inscricao/${(await params).slug}`);

  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();
  if (event.status !== "REGISTRATIONS_OPEN") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">Inscrições não disponíveis</h1>
        <p className="text-gray-600">As inscrições para este evento não estão abertas.</p>
      </div>
    );
  }

  const availableBatches = event.ticketBatches.filter((b) => b.soldCount < b.capacity);
  if (availableBatches.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">Evento Esgotado</h1>
        <p className="text-gray-600">Todos os lotes disponíveis foram preenchidos.</p>
      </div>
    );
  }

  const athleteProfile = await db.athleteProfile.findUnique({
    where: { userId: session.user.id },
    select: { preferredShirtSize: true, teamName: true, emergencyName: true, emergencyPhone: true, medicalNotes: true },
  });

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Inscrição</h1>
      <p className="text-gray-600 mb-6">{event.title}</p>
      <CheckoutForm
        event={event}
        batches={availableBatches}
        userId={session.user.id}
        athleteProfile={athleteProfile ?? undefined}
      />
    </main>
  );
}
