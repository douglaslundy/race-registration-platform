import { describe, expect, it } from "vitest";
import { buildEventJsonLd, buildBreadcrumbJsonLd } from "@/lib/seo/build-event-json-ld";

const BASE_EVENT = {
  title: "Corrida da Serra",
  slug: "corrida-da-serra",
  description: "Uma corrida linda na serra.",
  startAt: new Date("2026-09-01T09:00:00Z"),
  venueName: "Parque Municipal",
  addressLine: "Rua das Flores, 100",
  city: "Belo Horizonte",
  state: "MG",
  country: "BR",
  latitude: -19.9,
  longitude: -43.9,
  image: "https://cdn.example.com/banner.png",
  organizerName: "Corridas MG Ltda",
  ticketBatches: [
    { priceAmount: 5000, capacity: 100, soldCount: 10, active: true },
    { priceAmount: 3000, capacity: 50, soldCount: 50, active: true },
    { priceAmount: 1000, capacity: 10, soldCount: 0, active: false },
  ],
};

describe("buildEventJsonLd", () => {
  it("monta o SportsEvent com localização, geo e o menor preço disponível", () => {
    const result = buildEventJsonLd(BASE_EVENT, "https://circuitodascorridas.com.br");

    expect(result).toMatchObject({
      "@context": "https://schema.org",
      "@type": "SportsEvent",
      name: "Corrida da Serra",
      startDate: "2026-09-01T09:00:00.000Z",
      description: "Uma corrida linda na serra.",
      url: "https://circuitodascorridas.com.br/eventos/corrida-da-serra",
      image: ["https://cdn.example.com/banner.png"],
      location: {
        "@type": "Place",
        name: "Parque Municipal",
        address: {
          "@type": "PostalAddress",
          streetAddress: "Rua das Flores, 100",
          addressLocality: "Belo Horizonte",
          addressRegion: "MG",
          addressCountry: "BR",
        },
        geo: { "@type": "GeoCoordinates", latitude: -19.9, longitude: -43.9 },
      },
      organizer: { "@type": "Organization", name: "Corridas MG Ltda" },
      offers: {
        "@type": "Offer",
        price: 50,
        priceCurrency: "BRL",
        availability: "https://schema.org/InStock",
        url: "https://circuitodascorridas.com.br/eventos/corrida-da-serra",
      },
    });
  });

  it("omite offers quando nenhum lote está disponível", () => {
    const result = buildEventJsonLd(
      { ...BASE_EVENT, ticketBatches: [{ priceAmount: 5000, capacity: 10, soldCount: 10, active: true }] },
      "https://circuitodascorridas.com.br",
    );
    expect(result).not.toHaveProperty("offers");
  });

  it("omite geo quando latitude/longitude são nulos", () => {
    const result = buildEventJsonLd(
      { ...BASE_EVENT, latitude: null, longitude: null },
      "https://circuitodascorridas.com.br",
    ) as any;
    expect(result.location).not.toHaveProperty("geo");
  });

  it("usa a cidade como nome do local quando venueName é nulo", () => {
    const result = buildEventJsonLd(
      { ...BASE_EVENT, venueName: null },
      "https://circuitodascorridas.com.br",
    ) as any;
    expect(result.location.name).toBe("Belo Horizonte");
  });
});

describe("buildBreadcrumbJsonLd", () => {
  it("monta a lista de 3 níveis (Home > Eventos > Evento)", () => {
    const result = buildBreadcrumbJsonLd(
      "Corrida da Serra",
      "https://circuitodascorridas.com.br/eventos/corrida-da-serra",
      "https://circuitodascorridas.com.br",
    );
    expect(result).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://circuitodascorridas.com.br" },
        { "@type": "ListItem", position: 2, name: "Eventos", item: "https://circuitodascorridas.com.br/eventos" },
        { "@type": "ListItem", position: 3, name: "Corrida da Serra", item: "https://circuitodascorridas.com.br/eventos/corrida-da-serra" },
      ],
    });
  });
});
