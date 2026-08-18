import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getEventBySlug } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import Link from "next/link";
import Image from "next/image";
import OrganizerInfo from "@/components/events/OrganizerInfo";
import EventDisclaimer from "@/components/events/EventDisclaimer";
import AdSlotRenderer from "@/components/ads/AdSlotRenderer";
import {
  getAppName,
  getDefaultPlatformFee,
  getServiceFeePercent,
  getServiceFeeMin,
} from "@/lib/settings";
import { MODALITY_LABEL } from "@/lib/admin/labels";
import { getBatchStatus } from "@/lib/batch-status";
import JsonLd from "@/components/seo/JsonLd";
import { buildEventJsonLd, buildBreadcrumbJsonLd } from "@/lib/seo/build-event-json-ld";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return { title: "Evento não encontrado" };

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const ogImage = event.listBannerUrl ?? event.bannerUrl;
  const title = event.metaTitle || event.title;
  const description =
    event.metaDescription ||
    event.description?.substring(0, 160) ||
    `Inscreva-se em ${event.title}`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `${baseUrl}/eventos/${slug}` },
    openGraph: {
      title,
      description,
      url: `/eventos/${slug}`,
      type: "website",
      ...(ogImage ? { images: [{ url: ogImage, alt: event.title }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

export default async function EventoPage({ params }: Props) {
  const { slug } = await params;
  const [event, session, appName, defaultPlatformFee, serviceFeePercent, serviceFeeMin] =
    await Promise.all([
      getEventBySlug(slug),
      auth(),
      getAppName(),
      getDefaultPlatformFee(),
      getServiceFeePercent(),
      getServiceFeeMin(),
    ]);
  if (!event) notFound();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const eventUrl = `${baseUrl}/eventos/${slug}`;
  const eventJsonLd = buildEventJsonLd(
    {
      title: event.title,
      slug: event.slug,
      description: event.description,
      startAt: event.startAt,
      venueName: event.venueName,
      addressLine: event.addressLine,
      city: event.city,
      state: event.state,
      country: event.country,
      latitude: event.latitude,
      longitude: event.longitude,
      image: event.listBannerUrl ?? event.bannerUrl,
      organizerName: event.organizer.companyName || event.organizer.user.name || appName,
      ticketBatches: event.ticketBatches.map((b) => ({
        priceAmount: b.priceAmount,
        capacity: b.capacity,
        soldCount: b.soldCount,
        active: b.active,
      })),
    },
    baseUrl
  );
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(event.title, eventUrl, baseUrl);

  const isLoggedIn = Boolean(session?.user);
  const hasActiveBatch = event.ticketBatches.some(
    (b) => getBatchStatus(b, event.ticketBatches) === "ACTIVE"
  );
  const hasUpcomingBatch = event.ticketBatches.some(
    (b) => getBatchStatus(b, event.ticketBatches) === "UPCOMING"
  );
  const canRegister = event.status === "REGISTRATIONS_OPEN" && hasActiveBatch;
  const availableBatches = event.ticketBatches.filter((b) => b.soldCount < b.capacity);
  const heroBannerUrl = event.bannerUrl ?? event.listBannerUrl;

  return (
    <>
      <JsonLd data={eventJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
      <main className="max-w-4xl mx-auto px-4 py-8">
        {heroBannerUrl && (
          <div className="relative w-full aspect-[3/1] rounded-2xl overflow-hidden mb-8 bg-gray-100 dark:bg-gray-800">
            <div className="absolute inset-2">
              <Image
                src={heroBannerUrl}
                alt={event.title}
                fill
                sizes="100vw"
                className="object-contain"
                priority
              />
            </div>
          </div>
        )}

        <div className="mb-8">
          <AdSlotRenderer position="EVENTO_DETALHE_ABAIXO_BANNER" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-6">
            <div>
              <span className="text-sm text-primary-600 font-medium uppercase tracking-wide">
                {MODALITY_LABEL[event.modality] ?? event.modality}
              </span>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                {event.title}
              </h1>
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
              <span>
                📅 {format(new Date(event.startAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </span>
              <span>
                📍 {event.venueName}, {event.city}/{event.state}
              </span>
            </div>

            {event.description && (
              <div>
                <h2 className="text-lg font-semibold mb-2">Sobre o evento</h2>
                <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                  {event.description}
                </p>
              </div>
            )}

            <OrganizerInfo
              name={event.organizerNameOverride || event.organizer.companyName || event.organizer.user.name}
              email={event.organizerEmailOverride || event.organizer.user.email}
              phone={event.organizerPhoneOverride || event.organizer.phone}
              companyName={event.organizerNameOverride ? null : event.organizer.companyName}
              description={event.organizerDescriptionOverride || event.organizer.bio}
            />

            {event.routes.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-3">Percursos</h2>
                <div className="space-y-2">
                  {event.routes.map((route) => (
                    <div
                      key={route.id}
                      className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                    >
                      <span className="font-medium">{route.name}</span>
                      <span className="text-gray-600 dark:text-gray-400">
                        {route.distanceKm} km
                      </span>
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

            <EventDisclaimer appName={appName} />
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
                        <span className="text-primary-600 font-bold">
                          {formatCurrency(batch.priceAmount)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Vendas até: {format(new Date(batch.endAt), "dd/MM/yyyy HH:mm")}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-sm mb-4">Sem lotes disponíveis</p>
              )}

              <div className="mb-4 pt-3 border-t dark:border-gray-700 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                <p className="font-medium text-gray-600 dark:text-gray-400">Taxas aplicadas:</p>
                <p>
                  Taxa da plataforma: {(event.platformFeePercent / 100).toFixed(1)}%
                  {defaultPlatformFee > 0 && ` (mín. ${formatCurrency(defaultPlatformFee)})`}
                </p>
                {(serviceFeePercent > 0 || serviceFeeMin > 0) && (
                  <p>
                    Taxa de serviço:
                    {serviceFeePercent > 0 ? ` ${(serviceFeePercent / 100).toFixed(1)}%` : ""}
                    {serviceFeeMin > 0 && ` (mín. ${formatCurrency(serviceFeeMin)})`}
                  </p>
                )}
              </div>

              {canRegister && availableBatches.length > 0 ? (
                <Link
                  href={
                    isLoggedIn
                      ? `/inscricao/${event.slug}`
                      : `/auth/login?callbackUrl=/inscricao/${event.slug}`
                  }
                  className="btn-primary w-full text-center block"
                >
                  Inscrever-se
                </Link>
              ) : !canRegister && hasUpcomingBatch ? (
                <button disabled className="btn-primary w-full opacity-50 cursor-not-allowed">
                  Inscrições em breve
                </button>
              ) : (
                <button disabled className="btn-primary w-full opacity-50 cursor-not-allowed">
                  {event.status === "SOLD_OUT" ? "Esgotado" : "Inscrições fechadas"}
                </button>
              )}
            </div>

            <div className="mt-4">
              <AdSlotRenderer position="EVENTO_DETALHE_COLUNA_DIREITA" />
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
