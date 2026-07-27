export interface JsonLdTicketBatch {
  priceAmount: number;
  capacity: number;
  soldCount: number;
  active: boolean;
}

export interface JsonLdEvent {
  title: string;
  slug: string;
  description: string | null;
  startAt: Date;
  venueName: string | null;
  addressLine: string | null;
  city: string;
  state: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  image: string | null;
  organizerName: string;
  ticketBatches: JsonLdTicketBatch[];
}

export function buildEventJsonLd(event: JsonLdEvent, baseUrl: string): Record<string, unknown> {
  const available = event.ticketBatches.filter((b) => b.active && b.soldCount < b.capacity);
  const lowestPrice = available.length > 0 ? Math.min(...available.map((b) => b.priceAmount)) / 100 : null;
  const url = `${baseUrl}/eventos/${event.slug}`;

  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: event.title,
    startDate: event.startAt.toISOString(),
    description: event.description ?? `Inscreva-se em ${event.title}`,
    url,
    ...(event.image ? { image: [event.image] } : {}),
    location: {
      "@type": "Place",
      name: event.venueName ?? event.city,
      address: {
        "@type": "PostalAddress",
        ...(event.addressLine ? { streetAddress: event.addressLine } : {}),
        addressLocality: event.city,
        addressRegion: event.state,
        addressCountry: event.country,
      },
      ...(event.latitude != null && event.longitude != null
        ? { geo: { "@type": "GeoCoordinates", latitude: event.latitude, longitude: event.longitude } }
        : {}),
    },
    organizer: { "@type": "Organization", name: event.organizerName },
    ...(lowestPrice !== null
      ? {
          offers: {
            "@type": "Offer",
            price: lowestPrice,
            priceCurrency: "BRL",
            availability: "https://schema.org/InStock",
            url,
          },
        }
      : {}),
  };
}

export function buildBreadcrumbJsonLd(
  eventTitle: string,
  eventUrl: string,
  baseUrl: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: baseUrl },
      { "@type": "ListItem", position: 2, name: "Eventos", item: `${baseUrl}/eventos` },
      { "@type": "ListItem", position: 3, name: eventTitle, item: eventUrl },
    ],
  };
}
