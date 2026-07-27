# SEO + Geração por IA + Refatoração do Link de Anúncios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar (1) um sistema de SEO técnico completo (sitemap, robots, JSON-LD, meta tags
por evento/globais) com geração de texto por IA (Claude/OpenAI/Google) nos campos de SEO, e (2)
corrigir/endurecer o link de destino dos anúncios (validação, bug de anúncio da casa sem link,
edição com remoderação, acessibilidade) — duas specs independentes combinadas num plano só, a
pedido do usuário.

**Architecture:** Parte A (Tasks 1-9) implementa SEO técnico usando convenções nativas do Next.js
(`app/sitemap.ts`, `app/robots.ts`, `generateMetadata`). Parte B (Tasks 10-11) adiciona os campos
administráveis sem IA ainda. Parte C (Tasks 12-18) adiciona a abstração de provedor de IA
(espelhando `lib/payment/`) e liga o botão "Gerar com IA". Parte D (Tasks 19-27) corrige e
robustece o link de destino dos anúncios existentes (`AdSlot.houseAdTargetUrl` e
`PrivateAd.targetUrl` já existem em produção — não é campo novo).

**Tech Stack:** Next.js (App Router), Prisma, Zod, Vitest, `react-hook-form`. Nenhuma dependência
nova — os 3 provedores de IA são chamados via `fetch` direto às APIs REST oficiais (sem SDK).

## Global Constraints

- Nunca usar `alert()`/`confirm()`/`window.prompt()` — modais seguem `components/ui/ConfirmModal.tsx`/`ErrorModal.tsx`, ou um modal dedicado quando o formato não encaixa (mesmo critério já usado em `PromoteToAdvertiserButton.tsx`).
- TDD em toda função de `lib/`/rota de API nova ou modificada. `db` já vem mockado globalmente via `tests/setup.ts` — não precisa de `vi.mock("@/lib/db")` em cada teste, só mockar módulos que o teste específico precisa controlar (`@/lib/auth`, `@/lib/settings`, etc).
- Componentes React sem teste automatizado — convenção já estabelecida no projeto.
- Toda chave de API/segredo nova segue o padrão já usado nas chaves de gateway de pagamento: texto plano em `PlatformSetting` via `getSetting`/`upsertSetting`, exibição mascarada no formulário (`type="password"`, mostra "configurada" em vez do valor).
- `NEXT_PUBLIC_APP_URL` é a env var padrão de base URL já usada em todo o projeto (`lib/email.ts`, `lib/proxy-athlete.ts`, etc) — usar o mesmo padrão `process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"` (ou `?? process.env.NEXTAUTH_URL ?? ""` nos pontos que já usam essa variação).

---

## Parte A — SEO técnico

### Task 1: Migração — `Event.metaTitle`/`metaDescription`

**Files:**
- Modify: `prisma/schema.prisma` (model `Event`, perto de `regulationText`)
- Create: `prisma/migrations/20260727000000_add_event_meta_fields/migration.sql`

**Interfaces:**
- Produces: `Event.metaTitle: string | null`, `Event.metaDescription: string | null` — consumidos pelas Tasks 8, 11, 13, 18.

- [ ] **Step 1: Editar o schema**

Em `prisma/schema.prisma`, dentro do `model Event`, logo depois da linha `regulationText     String?       @db.Text` (linha 242), adicionar:

```prisma
  metaTitle          String?       @db.VarChar(70)
  metaDescription    String?       @db.VarChar(160)
```

- [ ] **Step 2: Criar a migração**

Criar `prisma/migrations/20260727000000_add_event_meta_fields/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Event" ADD COLUMN "metaTitle" VARCHAR(70);
ALTER TABLE "Event" ADD COLUMN "metaDescription" VARCHAR(160);
```

Confira o nome real da tabela no banco (grep por `@@map` dentro do `model Event` em
`prisma/schema.prisma` — se não houver `@@map`, o nome da tabela é `Event`, como usado acima).

- [ ] **Step 3: Gerar o client do Prisma**

Run: `npx prisma generate`
Expected: sem erros, `metaTitle`/`metaDescription` aparecem no client TS gerado.

- [ ] **Step 4: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260727000000_add_event_meta_fields
git commit -m "feat: adiciona metaTitle/metaDescription opcionais ao evento"
```

---

### Task 2: `lib/seo/build-event-json-ld.ts`

**Files:**
- Create: `lib/seo/build-event-json-ld.ts`
- Test: `tests/lib-build-event-json-ld.test.ts`

**Interfaces:**
- Produces: `buildEventJsonLd(event: JsonLdEvent, baseUrl: string): Record<string, unknown>`,
  `buildBreadcrumbJsonLd(eventTitle: string, eventUrl: string, baseUrl: string): Record<string, unknown>`
  — consumidos pela Task 8.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-build-event-json-ld.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-build-event-json-ld.test.ts`
Expected: FAIL — `@/lib/seo/build-event-json-ld` não existe.

- [ ] **Step 3: Implementar**

Criar `lib/seo/build-event-json-ld.ts`:

```ts
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
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-build-event-json-ld.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/seo/build-event-json-ld.ts tests/lib-build-event-json-ld.test.ts
git commit -m "feat: build-event-json-ld monta SportsEvent e BreadcrumbList pro evento"
```

---

### Task 3: `components/seo/JsonLd.tsx`

**Files:**
- Create: `components/seo/JsonLd.tsx`

**Interfaces:**
- Consumes: `Record<string, unknown>` (saída de `buildEventJsonLd`/`buildBreadcrumbJsonLd`, Task 2).
- Produces: `<JsonLd data={...} />` — consumido pela Task 8.

Sem teste automatizado (componente sem lógica além de serialização, convenção do projeto).

- [ ] **Step 1: Implementar**

Criar `components/seo/JsonLd.tsx`:

```tsx
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  // Escapa "<" pra nunca permitir que o JSON quebre pra fora da tag <script> (ex: um
  // description de evento contendo literalmente "</script>").
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
```

- [ ] **Step 2: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add components/seo/JsonLd.tsx
git commit -m "feat: componente JsonLd renderiza dados estruturados com escape seguro"
```

---

### Task 4: `app/sitemap.ts`

**Files:**
- Modify: `lib/events.ts:4-5` (exportar `ACTIVE_STATUSES`/`CLOSED_STATUSES`)
- Create: `app/sitemap.ts`
- Test: `tests/sitemap.test.ts`

**Interfaces:**
- Consumes: `ACTIVE_STATUSES`, `CLOSED_STATUSES` de `lib/events.ts`.
- Produces: `GET /sitemap.xml` (convenção nativa do Next.js).

- [ ] **Step 1: Exportar as constantes de status**

Em `lib/events.ts`, trocar (linhas 4-5):

```ts
const ACTIVE_STATUSES: EventStatus[] = ["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT"];
const CLOSED_STATUSES: EventStatus[] = ["REGISTRATIONS_CLOSED", "COMPLETED"];
```

por:

```ts
export const ACTIVE_STATUSES: EventStatus[] = ["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT"];
export const CLOSED_STATUSES: EventStatus[] = ["REGISTRATIONS_CLOSED", "COMPLETED"];
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `tests/sitemap.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

import sitemap from "@/app/sitemap";

const dbMock = db as any;

describe("sitemap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://circuitodascorridas.com.br";
  });

  it("busca eventos com status publicamente visível e monta as URLs", async () => {
    dbMock.event.findMany.mockResolvedValueOnce([
      { slug: "corrida-teste", updatedAt: new Date("2026-01-01T00:00:00Z") },
    ]);

    const result = await sitemap();

    expect(dbMock.event.findMany).toHaveBeenCalledWith({
      where: { status: { in: ["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT", "REGISTRATIONS_CLOSED", "COMPLETED"] } },
      select: { slug: true, updatedAt: true },
    });

    const urls = result.map((entry) => entry.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://circuitodascorridas.com.br",
        "https://circuitodascorridas.com.br/eventos",
        "https://circuitodascorridas.com.br/termos",
        "https://circuitodascorridas.com.br/privacidade",
        "https://circuitodascorridas.com.br/eventos/corrida-teste",
      ]),
    );
  });

  it("usa event.updatedAt como lastModified do evento", async () => {
    const updatedAt = new Date("2026-03-15T12:00:00Z");
    dbMock.event.findMany.mockResolvedValueOnce([{ slug: "corrida-teste", updatedAt }]);

    const result = await sitemap();
    const eventEntry = result.find((entry) => entry.url.endsWith("/eventos/corrida-teste"));
    expect(eventEntry?.lastModified).toEqual(updatedAt);
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/sitemap.test.ts`
Expected: FAIL — `@/app/sitemap` não existe.

- [ ] **Step 4: Implementar**

Criar `app/sitemap.ts`:

```ts
import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { ACTIVE_STATUSES, CLOSED_STATUSES } from "@/lib/events";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const events = await db.event.findMany({
    where: { status: { in: [...ACTIVE_STATUSES, ...CLOSED_STATUSES] } },
    select: { slug: true, updatedAt: true },
  });

  const staticEntries: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${baseUrl}/eventos`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/termos`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.2 },
    { url: `${baseUrl}/privacidade`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.2 },
  ];

  const eventEntries: MetadataRoute.Sitemap = events.map((event) => ({
    url: `${baseUrl}/eventos/${event.slug}`,
    lastModified: event.updatedAt,
    changeFrequency: "daily",
    priority: 0.8,
  }));

  return [...staticEntries, ...eventEntries];
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/sitemap.test.ts`
Expected: PASS (2 testes)

- [ ] **Step 6: Commit**

```bash
git add lib/events.ts app/sitemap.ts tests/sitemap.test.ts
git commit -m "feat: sitemap.xml dinamico com home, eventos e paginas legais"
```

---

### Task 5: `app/robots.ts`

**Files:**
- Create: `app/robots.ts`
- Test: `tests/robots.test.ts`

**Interfaces:**
- Produces: `GET /robots.txt` (convenção nativa do Next.js).

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/robots.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import robots from "@/app/robots";

describe("robots", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://circuitodascorridas.com.br";
  });

  it("libera geral e bloqueia as áreas autenticadas/internas", () => {
    const result = robots();
    expect(result.rules).toEqual({
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/organizador", "/anunciante", "/dashboard", "/api", "/auth", "/completar-cadastro"],
    });
    expect(result.sitemap).toBe("https://circuitodascorridas.com.br/sitemap.xml");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/robots.test.ts`
Expected: FAIL — `@/app/robots` não existe.

- [ ] **Step 3: Implementar**

Criar `app/robots.ts`:

```ts
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/organizador", "/anunciante", "/dashboard", "/api", "/auth", "/completar-cadastro"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/robots.test.ts`
Expected: PASS (1 teste)

- [ ] **Step 5: Commit**

```bash
git add app/robots.ts tests/robots.test.ts
git commit -m "feat: robots.txt bloqueia areas autenticadas e aponta pro sitemap"
```

---

### Task 6: Metadata da home e de `/eventos`

**Files:**
- Modify: `app/(public)/page.tsx`
- Modify: `app/(public)/eventos/page.tsx:1-12`

**Interfaces:**
- Consumes: `getSetting("seo_default_title")`, `getSetting("seo_default_description")` (chaves novas de `PlatformSetting`, sem migração — usadas pela Task 10), `<JsonLd />` (Task 3).

Sem teste automatizado (Server Component sem lógica testável isolada, mesma convenção já usada
pras outras páginas públicas do projeto — o JSON-LD da home é um objeto estático de 4 campos,
sem lógica de negócio que justifique uma função pura separada com teste dedicado).

- [ ] **Step 1: Home — adicionar `generateMetadata` e JSON-LD `Organization`**

Em `app/(public)/page.tsx`, trocar o topo do arquivo (linhas 1-4):

```tsx
import Link from "next/link";
import { getAppName } from "@/lib/settings";

export default async function HomePage() {
  const appName = await getAppName();
```

por:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { getAppName, getSetting } from "@/lib/settings";
import JsonLd from "@/components/seo/JsonLd";

export async function generateMetadata(): Promise<Metadata> {
  const [appName, defaultTitle, defaultDescription] = await Promise.all([
    getAppName(),
    getSetting("seo_default_title"),
    getSetting("seo_default_description"),
  ]);
  return {
    title: defaultTitle || `${appName} — Inscrições para Corridas de Rua, Trail Run e Eventos Esportivos`,
    description:
      defaultDescription ||
      "Encontre e se inscreva em corridas de rua, trail run e eventos esportivos perto de você. Inscrição online, pagamento seguro via Pix, cartão ou boleto.",
  };
}

export default async function HomePage() {
  const appName = await getAppName();
```

- [ ] **Step 2: Home — injetar JSON-LD `Organization` no corpo da página**

No `export default async function HomePage`, trocar o `return` (linha 6 original em diante):

```tsx
  return (
    <main className="min-h-screen bg-gradient-to-br from-primary-50 to-white dark:from-gray-900 dark:to-gray-950">
```

por:

```tsx
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: appName,
    url: baseUrl,
  };

  return (
    <>
      <JsonLd data={organizationJsonLd} />
      <main className="min-h-screen bg-gradient-to-br from-primary-50 to-white dark:from-gray-900 dark:to-gray-950">
```

E no fechamento do JSX (última linha do arquivo, depois do `</main>` de fechamento), fechar o
Fragment adicionando `</>` — o restante do conteúdo interno de `<main>...</main>` (linhas 8-23
originais) não muda.

- [ ] **Step 3: `/eventos` — trocar a metadata estática por uma otimizada + canonical**

Em `app/(public)/eventos/page.tsx`, trocar (linha 11):

```ts
export const metadata: Metadata = { title: "Eventos" };
```

por:

```ts
export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    title: "Eventos — corridas de rua, trail run e mais",
    description:
      "Veja todos os eventos esportivos abertos para inscrição: corridas de rua, trail run, ciclismo, caminhada e triathlon em diversas cidades.",
    alternates: { canonical: `${baseUrl}/eventos` },
  };
}
```

- [ ] **Step 4: Rodar `tsc --noEmit` e o build**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 5: Commit**

```bash
git add "app/(public)/page.tsx" "app/(public)/eventos/page.tsx"
git commit -m "feat: metadata otimizada na home e em /eventos, JSON-LD Organization, fallback configuravel"
```

---

### Task 7: `/eventos/[slug]` — override de meta título/descrição + canonical + JSON-LD

**Files:**
- Modify: `app/(public)/eventos/[slug]/page.tsx:1-105`

**Interfaces:**
- Consumes: `Event.metaTitle`/`metaDescription` (Task 1), `buildEventJsonLd`/`buildBreadcrumbJsonLd` (Task 2), `<JsonLd />` (Task 3).

Sem teste automatizado (Server Component, convenção do projeto — a lógica de montagem do JSON-LD
já está coberta pelos testes puros da Task 2).

- [ ] **Step 1: Import novo**

Em `app/(public)/eventos/[slug]/page.tsx`, adicionar aos imports existentes (perto da linha 12):

```tsx
import JsonLd from "@/components/seo/JsonLd";
import { buildEventJsonLd, buildBreadcrumbJsonLd } from "@/lib/seo/build-event-json-ld";
```

- [ ] **Step 2: `generateMetadata` — override + canonical**

Trocar o corpo de `generateMetadata` (linhas 20-45):

```ts
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return { title: "Evento não encontrado" };

  const ogImage = event.listBannerUrl ?? event.bannerUrl;
  const description = event.description?.substring(0, 160) ?? `Inscreva-se em ${event.title}`;

  return {
    title: event.title,
    description,
    openGraph: {
      title: event.title,
      description,
      url: `/eventos/${slug}`,
      type: "website",
      ...(ogImage ? { images: [{ url: ogImage, alt: event.title }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: event.title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}
```

por:

```ts
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return { title: "Evento não encontrado" };

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const ogImage = event.listBannerUrl ?? event.bannerUrl;
  const title = event.metaTitle || event.title;
  const description = event.metaDescription || event.description?.substring(0, 160) || `Inscreva-se em ${event.title}`;

  return {
    title,
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
```

- [ ] **Step 3: Injetar JSON-LD no corpo da página**

No `export default async function EventoPage`, logo depois de `if (!event) notFound();` (linha
53) e antes de `const isLoggedIn = ...` (linha 55), adicionar:

```tsx
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
    baseUrl,
  );
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(event.title, eventUrl, baseUrl);
```

E logo no início do `return (`, antes de `<main ...>` (linha 63), adicionar:

```tsx
    <>
      <JsonLd data={eventJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
```

E no fechamento do JSX (última linha do `return`, depois do `</main>` de fechamento — ver o
arquivo completo pra achar a tag de fechamento correta), adicionar `</>` fechando o Fragment.

- [ ] **Step 4: Rodar `tsc --noEmit` e o build**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 5: Commit**

```bash
git add "app/(public)/eventos/[slug]/page.tsx"
git commit -m "feat: JSON-LD SportsEvent/BreadcrumbList e override de meta tags no evento"
```

---

### Task 8: Verificação do Search Console + Google Analytics no layout raiz

**Files:**
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `getSetting("seo_google_site_verification")`, `getSetting("seo_google_analytics_id")` (chaves novas de `PlatformSetting`, usadas pela Task 10).

Sem teste automatizado (Server Component, convenção do projeto).

- [ ] **Step 1: Implementar**

Em `app/layout.tsx`, trocar `generateMetadata` (linhas 6-18):

```tsx
export async function generateMetadata(): Promise<Metadata> {
  const appName = await getAppName();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    metadataBase: new URL(appUrl),
    title: {
      default: `${appName} — Inscrições Esportivas`,
      template: `%s | ${appName}`,
    },
    description: "Plataforma de inscrições para corridas de rua, trail run, ciclismo e mais.",
    keywords: ["corridas", "inscrições", "corrida de rua", "trail run", "esportes"],
  };
}
```

por:

```tsx
export async function generateMetadata(): Promise<Metadata> {
  const [appName, googleSiteVerification] = await Promise.all([
    getAppName(),
    getSetting("seo_google_site_verification"),
  ]);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    metadataBase: new URL(appUrl),
    title: {
      default: `${appName} — Inscrições Esportivas`,
      template: `%s | ${appName}`,
    },
    description: "Plataforma de inscrições para corridas de rua, trail run, ciclismo e mais.",
    keywords: ["corridas", "inscrições", "corrida de rua", "trail run", "esportes"],
    ...(googleSiteVerification ? { verification: { google: googleSiteVerification } } : {}),
  };
}
```

E no `export default async function RootLayout`, adicionar a leitura do ID do Analytics e o
script (mantendo intacta a tag `<script>` nativa do AdSense já existente, comentário incluso):

```tsx
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Tag de verificação/carregamento do Google AdSense — precisa estar presente em toda página
  // do site como texto puro no HTML inicial, não injetada via JS depois do carregamento (o
  // crawler de verificação do AdSense não executa JavaScript). O componente <Script> do
  // next/script, mesmo com strategy="beforeInteractive", só emite um <link rel="preload"> no
  // HTML e monta a <script> de verdade via hidratação no navegador — confirmado direto no HTML
  // servido em produção, não aparecia nenhuma tag <script> literal. Por isso aqui é uma tag
  // <script> nativa, escrita à mão dentro de um <head> explícito, sem passar pelo next/script.
  const [adSenseClientId, gaId] = await Promise.all([
    getSetting("google_adsense_client_id"),
    getSetting("seo_google_analytics_id"),
  ]);

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {adSenseClientId && (
          <script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adSenseClientId}`}
            crossOrigin="anonymous"
          />
        )}
        {gaId && (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} />
            <script
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());\ngtag('config', '${gaId}');`,
              }}
            />
          </>
        )}
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Rodar `tsc --noEmit` e o build**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: verificacao do Search Console e Google Analytics no layout raiz"
```

---

## Parte B — Campos administráveis (sem IA ainda)

### Task 9: `/admin/seo` — configurações globais de SEO

**Files:**
- Create: `app/admin/seo/page.tsx`
- Create: `components/admin/SeoSettingsForm.tsx`
- Modify: `components/admin/AdminNav.tsx:27-28`

**Interfaces:**
- Produces: chaves `seo_default_title`, `seo_default_description`, `seo_default_og_image`,
  `seo_brand_context`, `seo_google_site_verification`, `seo_google_analytics_id` em
  `PlatformSetting`, salvas via `POST /api/admin/settings` (rota genérica já existente, sem
  mudança nela).

Sem teste automatizado (página Server Component + formulário Client Component, convenção do
projeto).

- [ ] **Step 1: Criar o formulário**

Criar `components/admin/SeoSettingsForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  defaultTitle: string;
  defaultDescription: string;
  defaultOgImage: string;
  brandContext: string;
  googleSiteVerification: string;
  googleAnalyticsId: string;
}

async function saveSetting(key: string, value: string) {
  const res = await fetch("/api/admin/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
}

export default function SeoSettingsForm({
  defaultTitle,
  defaultDescription,
  defaultOgImage,
  brandContext,
  googleSiteVerification,
  googleAnalyticsId,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);
  const [ogImage, setOgImage] = useState(defaultOgImage);
  const [context, setContext] = useState(brandContext);
  const [siteVerification, setSiteVerification] = useState(googleSiteVerification);
  const [analyticsId, setAnalyticsId] = useState(googleAnalyticsId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await Promise.all([
        saveSetting("seo_default_title", title),
        saveSetting("seo_default_description", description),
        saveSetting("seo_default_og_image", ogImage),
        saveSetting("seo_brand_context", context),
        saveSetting("seo_google_site_verification", siteVerification),
        saveSetting("seo_google_analytics_id", analyticsId),
      ]);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar configurações de SEO");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {saved && (
        <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded px-3 py-2">
          Configurações de SEO salvas com sucesso!
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Título padrão do site</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={70} className="input-field w-full" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição padrão do site</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={160} rows={3} className="input-field w-full" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Imagem padrão de compartilhamento (URL)</label>
        <input value={ogImage} onChange={(e) => setOgImage(e.target.value)} className="input-field w-full" placeholder="https://..." />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Objetivo/posicionamento do site</label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
          Contexto de marca usado como fallback e injetado nos prompts de geração por IA.
        </p>
        <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={3} className="input-field w-full" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Verificação Google Search Console</label>
          <input value={siteVerification} onChange={(e) => setSiteVerification(e.target.value)} className="input-field w-full" placeholder="Código de verificação" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Google Analytics (GA4)</label>
          <input value={analyticsId} onChange={(e) => setAnalyticsId(e.target.value)} className="input-field w-full" placeholder="G-XXXXXXX" />
        </div>
      </div>

      <button type="submit" disabled={saving} className="btn-primary px-6 disabled:opacity-50">
        {saving ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Criar a página**

Criar `app/admin/seo/page.tsx`:

```tsx
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/rbac";
import { getSetting } from "@/lib/settings";
import SeoSettingsForm from "@/components/admin/SeoSettingsForm";

export const metadata: Metadata = { title: "SEO — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminSeoPage() {
  await requireAdmin();

  const [defaultTitle, defaultDescription, defaultOgImage, brandContext, googleSiteVerification, googleAnalyticsId] =
    await Promise.all([
      getSetting("seo_default_title"),
      getSetting("seo_default_description"),
      getSetting("seo_default_og_image"),
      getSetting("seo_brand_context"),
      getSetting("seo_google_site_verification"),
      getSetting("seo_google_analytics_id"),
    ]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">SEO</h1>
      <div className="card">
        <SeoSettingsForm
          defaultTitle={defaultTitle ?? ""}
          defaultDescription={defaultDescription ?? ""}
          defaultOgImage={defaultOgImage ?? ""}
          brandContext={brandContext ?? ""}
          googleSiteVerification={googleSiteVerification ?? ""}
          googleAnalyticsId={googleAnalyticsId ?? ""}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Link no menu do Admin**

Em `components/admin/AdminNav.tsx`, trocar (linhas 27-28):

```tsx
          <Link href="/admin/anuncios" className="hover:text-gray-300">Anúncios</Link>
          <Link href="/admin/configuracoes" className="hover:text-gray-300">Config.</Link>
```

por:

```tsx
          <Link href="/admin/anuncios" className="hover:text-gray-300">Anúncios</Link>
          <Link href="/admin/seo" className="hover:text-gray-300">SEO</Link>
          <Link href="/admin/configuracoes" className="hover:text-gray-300">Config.</Link>
```

- [ ] **Step 4: Rodar `tsc --noEmit` e o build**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 5: Commit**

```bash
git add app/admin/seo/page.tsx components/admin/SeoSettingsForm.tsx components/admin/AdminNav.tsx
git commit -m "feat: aba SEO no admin com configuracoes globais"
```

---

### Task 10: Campos `metaTitle`/`metaDescription` na edição de evento

**Files:**
- Modify: `app/organizador/eventos/[id]/editar/page.tsx:19-27`
- Modify: `components/organizer/EditEventForm.tsx`
- Modify: `app/api/events/[id]/route.ts:7-9`

**Interfaces:**
- Consumes: `Event.metaTitle`/`metaDescription` (Task 1).
- Produces: `updateEventSchema` aceita `metaTitle`/`metaDescription` — consumido pela Task 17.

- [ ] **Step 1: Rota `PATCH` aceita os 2 campos novos**

Em `app/api/events/[id]/route.ts`, no `updateEventSchema` (linhas 7-9), adicionar depois da linha
`regulationText: z.string().optional().nullable(),`:

```ts
  metaTitle: z.string().max(70).optional().nullable(),
  metaDescription: z.string().max(160).optional().nullable(),
```

- [ ] **Step 2: Página de edição inclui os campos no `select`**

Em `app/organizador/eventos/[id]/editar/page.tsx`, no `select` de `db.event.findFirst` (linhas
19-27), adicionar `metaTitle: true, metaDescription: true,` depois de `regulationText: true,`.

- [ ] **Step 3: Formulário — campos + botão "Gerar com IA" (placeholder de UI, IA real na Task 17)**

Em `components/organizer/EditEventForm.tsx`, adicionar ao schema Zod (linha 22, depois de
`regulationText`):

```ts
  metaTitle: z.string().max(70).optional().nullable(),
  metaDescription: z.string().max(160).optional().nullable(),
```

Adicionar ao tipo `EventData` (linha 63, depois de `regulationText`):

```ts
  metaTitle?: string | null;
  metaDescription?: string | null;
```

No `useForm` `defaultValues` (linha 98, depois de `regulationText: event.regulationText ?? "",`):

```ts
      metaTitle: event.metaTitle ?? "",
      metaDescription: event.metaDescription ?? "",
```

No `onSubmit`, dentro do `body: JSON.stringify({...})` (linha 121, depois de
`regulationText: data.regulationText || null,`):

```ts
        metaTitle: data.metaTitle || null,
        metaDescription: data.metaDescription || null,
```

No JSX, depois do bloco de "Regulamento (texto)" (linha 244, antes do `<div className="border-t
pt-5...">` de "Permitir inscrição por procuração"), adicionar uma nova seção:

```tsx
      <div className="border-t pt-5 dark:border-gray-700 space-y-4">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">SEO</h3>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Meta título</label>
          <input {...register("metaTitle")} maxLength={70} className="input w-full" placeholder="Deixe em branco para usar o nome do evento" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Meta descrição</label>
          <textarea {...register("metaDescription")} maxLength={160} rows={2} className="input w-full" placeholder="Deixe em branco para usar a descrição do evento" />
        </div>
      </div>
```

(O botão "Gerar com IA" ao lado de cada campo é adicionado na Task 17, depois que a rota de
geração existir — evita um componente com uma chamada de API que ainda não existe.)

- [ ] **Step 4: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 5: Commit**

```bash
git add app/api/events/\[id\]/route.ts "app/organizador/eventos/[id]/editar/page.tsx" components/organizer/EditEventForm.tsx
git commit -m "feat: campos de meta titulo/descricao na edicao de evento"
```

---

## Parte C — Geração de texto por IA

### Task 11: Abstração de provedor de IA (`lib/ai/`)

**Files:**
- Create: `lib/ai/types.ts`
- Create: `lib/ai/claude.ts`
- Create: `lib/ai/openai.ts`
- Create: `lib/ai/google.ts`
- Create: `lib/ai/index.ts`
- Create: `lib/ai-settings.ts`
- Test: `tests/lib-ai-claude.test.ts`
- Test: `tests/lib-ai-openai.test.ts`
- Test: `tests/lib-ai-google.test.ts`
- Test: `tests/lib-ai-index.test.ts`

**Interfaces:**
- Produces: `AiTextProvider.generateText(prompt: string): Promise<string>`,
  `getAiProvider(): Promise<AiTextProvider>`, `getAiProviderSetting(): Promise<AiProviderKey>` —
  consumidos pelas Tasks 13, 14.

- [ ] **Step 1: `lib/ai/types.ts`**

```ts
export interface AiTextProvider {
  generateText(prompt: string): Promise<string>;
}
```

- [ ] **Step 2: `lib/ai-settings.ts`**

```ts
import { getSetting } from "@/lib/settings";

export type AiProviderKey = "CLAUDE" | "OPENAI" | "GOOGLE";

export async function getAiProviderSetting(): Promise<AiProviderKey> {
  const value = await getSetting("ai_provider");
  if (value === "OPENAI" || value === "GOOGLE") return value;
  return "CLAUDE";
}
```

- [ ] **Step 3: Escrever os testes que falham (Claude)**

Criar `tests/lib-ai-claude.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));

import { ClaudeProvider } from "@/lib/ai/claude";
import { getSetting } from "@/lib/settings";

describe("ClaudeProvider.generateText", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(global, "fetch" as any) as any;
  });

  it("lança erro quando a chave de API não está configurada", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce(null);
    await expect(new ClaudeProvider().generateText("prompt")).rejects.toThrow(
      "Chave de API do Claude não configurada",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("chama a API do Claude e retorna o texto gerado", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("sk-ant-test");
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ content: [{ text: "  Título gerado  " }] }), { status: 200 }),
    );

    const result = await new ClaudeProvider().generateText("prompt");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "sk-ant-test" }),
      }),
    );
    expect(result).toBe("Título gerado");
  });

  it("lança erro quando a API retorna status de erro", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("sk-ant-test");
    fetchSpy.mockResolvedValueOnce(new Response("erro", { status: 500 }));
    await expect(new ClaudeProvider().generateText("prompt")).rejects.toThrow(/Falha ao gerar texto com Claude/);
  });
});
```

- [ ] **Step 4: Rodar e confirmar que falha**

Run: `npx vitest run tests/lib-ai-claude.test.ts`
Expected: FAIL — `@/lib/ai/claude` não existe.

- [ ] **Step 5: Implementar `lib/ai/claude.ts`**

```ts
import { getSetting } from "@/lib/settings";
import type { AiTextProvider } from "./types";

const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

export class ClaudeProvider implements AiTextProvider {
  async generateText(prompt: string): Promise<string> {
    const apiKey = await getSetting("ai_claude_api_key");
    if (!apiKey) throw new Error("Chave de API do Claude não configurada");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Falha ao gerar texto com Claude (${res.status}): ${body}`);
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text;
    if (typeof text !== "string") throw new Error("Resposta inesperada do Claude");
    return text.trim();
  }
}
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npx vitest run tests/lib-ai-claude.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 7: Repetir Steps 3-6 pra OpenAI**

Criar `tests/lib-ai-openai.test.ts` (mesmo formato do Claude, trocando o provedor):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));

import { OpenAiProvider } from "@/lib/ai/openai";
import { getSetting } from "@/lib/settings";

describe("OpenAiProvider.generateText", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(global, "fetch" as any) as any;
  });

  it("lança erro quando a chave de API não está configurada", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce(null);
    await expect(new OpenAiProvider().generateText("prompt")).rejects.toThrow(
      "Chave de API da OpenAI não configurada",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("chama a API da OpenAI e retorna o texto gerado", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("sk-test");
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "  Título gerado  " } }] }), { status: 200 }),
    );

    const result = await new OpenAiProvider().generateText("prompt");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
    expect(result).toBe("Título gerado");
  });

  it("lança erro quando a API retorna status de erro", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("sk-test");
    fetchSpy.mockResolvedValueOnce(new Response("erro", { status: 500 }));
    await expect(new OpenAiProvider().generateText("prompt")).rejects.toThrow(/Falha ao gerar texto com OpenAI/);
  });
});
```

Implementar `lib/ai/openai.ts`:

```ts
import { getSetting } from "@/lib/settings";
import type { AiTextProvider } from "./types";

const OPENAI_MODEL = "gpt-4o-mini";

export class OpenAiProvider implements AiTextProvider {
  async generateText(prompt: string): Promise<string> {
    const apiKey = await getSetting("ai_openai_api_key");
    if (!apiKey) throw new Error("Chave de API da OpenAI não configurada");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Falha ao gerar texto com OpenAI (${res.status}): ${body}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("Resposta inesperada da OpenAI");
    return text.trim();
  }
}
```

Run: `npx vitest run tests/lib-ai-openai.test.ts` — Expected: PASS (3 testes)

- [ ] **Step 8: Repetir Steps 3-6 pro Google**

Criar `tests/lib-ai-google.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));

import { GoogleAiProvider } from "@/lib/ai/google";
import { getSetting } from "@/lib/settings";

describe("GoogleAiProvider.generateText", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(global, "fetch" as any) as any;
  });

  it("lança erro quando a chave de API não está configurada", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce(null);
    await expect(new GoogleAiProvider().generateText("prompt")).rejects.toThrow(
      "Chave de API do Google não configurada",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("chama a API do Gemini e retorna o texto gerado", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("google-key");
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "  Título gerado  " }] } }] }),
        { status: 200 },
      ),
    );

    const result = await new GoogleAiProvider().generateText("prompt");

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("generativelanguage.googleapis.com"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toBe("Título gerado");
  });

  it("lança erro quando a API retorna status de erro", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("google-key");
    fetchSpy.mockResolvedValueOnce(new Response("erro", { status: 500 }));
    await expect(new GoogleAiProvider().generateText("prompt")).rejects.toThrow(/Falha ao gerar texto com Google/);
  });
});
```

Implementar `lib/ai/google.ts`:

```ts
import { getSetting } from "@/lib/settings";
import type { AiTextProvider } from "./types";

const GOOGLE_MODEL = "gemini-1.5-flash";

export class GoogleAiProvider implements AiTextProvider {
  async generateText(prompt: string): Promise<string> {
    const apiKey = await getSetting("ai_google_api_key");
    if (!apiKey) throw new Error("Chave de API do Google não configurada");

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Falha ao gerar texto com Google (${res.status}): ${body}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") throw new Error("Resposta inesperada do Google");
    return text.trim();
  }
}
```

Run: `npx vitest run tests/lib-ai-google.test.ts` — Expected: PASS (3 testes)

- [ ] **Step 9: `lib/ai/index.ts` — escolhe o provedor ativo**

Criar `tests/lib-ai-index.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai-settings", () => ({ getAiProviderSetting: vi.fn() }));
vi.mock("@/lib/ai/claude", () => ({ ClaudeProvider: vi.fn().mockImplementation(() => ({ kind: "claude" })) }));
vi.mock("@/lib/ai/openai", () => ({ OpenAiProvider: vi.fn().mockImplementation(() => ({ kind: "openai" })) }));
vi.mock("@/lib/ai/google", () => ({ GoogleAiProvider: vi.fn().mockImplementation(() => ({ kind: "google" })) }));

import { getAiProvider } from "@/lib/ai";
import { getAiProviderSetting } from "@/lib/ai-settings";

describe("getAiProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("instancia ClaudeProvider por padrão", async () => {
    vi.mocked(getAiProviderSetting).mockResolvedValueOnce("CLAUDE");
    const provider = await getAiProvider();
    expect((provider as any).kind).toBe("claude");
  });

  it("instancia OpenAiProvider quando configurado", async () => {
    vi.mocked(getAiProviderSetting).mockResolvedValueOnce("OPENAI");
    const provider = await getAiProvider();
    expect((provider as any).kind).toBe("openai");
  });

  it("instancia GoogleAiProvider quando configurado", async () => {
    vi.mocked(getAiProviderSetting).mockResolvedValueOnce("GOOGLE");
    const provider = await getAiProvider();
    expect((provider as any).kind).toBe("google");
  });
});
```

Implementar `lib/ai/index.ts`:

```ts
import type { AiTextProvider } from "./types";
import { ClaudeProvider } from "./claude";
import { OpenAiProvider } from "./openai";
import { GoogleAiProvider } from "./google";
import { getAiProviderSetting } from "@/lib/ai-settings";

export async function getAiProvider(): Promise<AiTextProvider> {
  const provider = await getAiProviderSetting();
  if (provider === "OPENAI") return new OpenAiProvider();
  if (provider === "GOOGLE") return new GoogleAiProvider();
  return new ClaudeProvider();
}

export type { AiTextProvider } from "./types";
```

Run: `npx vitest run tests/lib-ai-index.test.ts` — Expected: PASS (3 testes)

- [ ] **Step 10: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 11: Commit**

```bash
git add lib/ai lib/ai-settings.ts tests/lib-ai-claude.test.ts tests/lib-ai-openai.test.ts tests/lib-ai-google.test.ts tests/lib-ai-index.test.ts
git commit -m "feat: abstracao de provedor de IA (Claude/OpenAI/Google) para geracao de texto"
```

---

### Task 12: `lib/seo/build-seo-prompt.ts`

**Files:**
- Create: `lib/seo/build-seo-prompt.ts`
- Test: `tests/lib-build-seo-prompt.test.ts`

**Interfaces:**
- Produces: `buildSeoPrompt(ctx: SeoPromptContext): string`, `truncateSeoText(text, field): string` — consumidos pelas Tasks 13, 14.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-build-seo-prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSeoPrompt, truncateSeoText } from "@/lib/seo/build-seo-prompt";

describe("buildSeoPrompt", () => {
  it("monta o prompt de evento com dados do evento e contexto de marca", () => {
    const prompt = buildSeoPrompt({
      kind: "event",
      field: "metaTitle",
      title: "Corrida da Serra",
      description: "Uma corrida linda.",
      city: "Belo Horizonte",
      state: "MG",
      modality: "TRAIL_RUN",
      startAt: new Date("2026-09-01T09:00:00Z"),
      brandContext: "plataforma de inscrições esportivas",
    });

    expect(prompt).toContain("Corrida da Serra");
    expect(prompt).toContain("trail run");
    expect(prompt).toContain("Belo Horizonte/MG");
    expect(prompt).toContain("plataforma de inscrições esportivas");
    expect(prompt).toContain("Máximo de 60 caracteres");
    expect(prompt).toContain("português do Brasil");
  });

  it("monta o prompt de descrição com limite de 155 caracteres", () => {
    const prompt = buildSeoPrompt({
      kind: "event",
      field: "metaDescription",
      title: "Corrida da Serra",
      description: null,
      city: "Belo Horizonte",
      state: "MG",
      modality: "ROAD_RACE",
      startAt: new Date("2026-09-01T09:00:00Z"),
      brandContext: null,
    });
    expect(prompt).toContain("Máximo de 155 caracteres");
    expect(prompt).not.toContain("Contexto do site");
  });

  it("monta o prompt do site usando o nome do app e o contexto de marca", () => {
    const prompt = buildSeoPrompt({
      kind: "site",
      field: "metaTitle",
      appName: "Circuito das Corridas",
      brandContext: "foco em corridas de rua no interior de MG",
    });
    expect(prompt).toContain("Circuito das Corridas");
    expect(prompt).toContain("foco em corridas de rua no interior de MG");
  });
});

describe("truncateSeoText", () => {
  it("corta o título em 70 caracteres", () => {
    const text = "a".repeat(100);
    expect(truncateSeoText(text, "metaTitle")).toHaveLength(70);
  });

  it("corta a descrição em 160 caracteres", () => {
    const text = "a".repeat(200);
    expect(truncateSeoText(text, "metaDescription")).toHaveLength(160);
  });

  it("remove espaços nas pontas antes de truncar", () => {
    expect(truncateSeoText("  título  ", "metaTitle")).toBe("título");
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-build-seo-prompt.test.ts`
Expected: FAIL — `@/lib/seo/build-seo-prompt` não existe.

- [ ] **Step 3: Implementar**

Criar `lib/seo/build-seo-prompt.ts`:

```ts
export interface EventPromptContext {
  kind: "event";
  field: "metaTitle" | "metaDescription";
  title: string;
  description?: string | null;
  city: string;
  state: string;
  modality: string;
  startAt: Date;
  brandContext?: string | null;
}

export interface SitePromptContext {
  kind: "site";
  field: "metaTitle" | "metaDescription";
  appName: string;
  brandContext?: string | null;
}

export type SeoPromptContext = EventPromptContext | SitePromptContext;

const MODALITY_LABEL: Record<string, string> = {
  ROAD_RACE: "corrida de rua",
  TRAIL_RUN: "trail run",
  MTB: "mountain bike",
  CYCLING: "ciclismo",
  WALK: "caminhada",
  TRIATHLON: "triathlon",
  OTHER: "evento esportivo",
};

export function buildSeoPrompt(ctx: SeoPromptContext): string {
  const limit = ctx.field === "metaTitle" ? 60 : 155;
  const fieldLabel = ctx.field === "metaTitle" ? "título" : "descrição";
  const rules = [
    "Escreva em português do Brasil.",
    "Gere só o texto final, sem aspas, sem explicação, sem markdown.",
    `Máximo de ${limit} caracteres.`,
    "Tom convidativo, adequado pra um resultado de busca do Google.",
  ];

  if (ctx.kind === "event") {
    const modalityLabel = MODALITY_LABEL[ctx.modality] ?? "evento esportivo";
    const dateLabel = ctx.startAt.toLocaleDateString("pt-BR");
    return [
      `Gere um(a) ${fieldLabel} de SEO para a página de um evento esportivo de inscrição online.`,
      `Evento: "${ctx.title}", modalidade ${modalityLabel}, em ${ctx.city}/${ctx.state}, no dia ${dateLabel}.`,
      ctx.description ? `Descrição do evento: ${ctx.description.slice(0, 500)}` : "",
      ctx.brandContext ? `Contexto do site: ${ctx.brandContext}` : "",
      `Inclua palavras-chave relevantes (ex.: inscrição, ${modalityLabel}, ${ctx.city}/${ctx.state}) sem forçar.`,
      ...rules,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `Gere um(a) ${fieldLabel} de SEO para a página inicial de uma plataforma de inscrição em corridas e eventos esportivos chamada "${ctx.appName}".`,
    ctx.brandContext ? `Contexto do site: ${ctx.brandContext}` : "",
    ...rules,
  ]
    .filter(Boolean)
    .join("\n");
}

export function truncateSeoText(text: string, field: "metaTitle" | "metaDescription"): string {
  const limit = field === "metaTitle" ? 70 : 160;
  return text.trim().slice(0, limit);
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-build-seo-prompt.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/seo/build-seo-prompt.ts tests/lib-build-seo-prompt.test.ts
git commit -m "feat: build-seo-prompt monta o prompt de geracao por evento ou site"
```

---

### Task 13: `POST /api/events/[id]/seo/generate`

**Files:**
- Create: `app/api/events/[id]/seo/generate/route.ts`
- Test: `tests/events-seo-generate-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission` (`lib/auth/rbac.ts`), `getAiProvider` (Task 11), `buildSeoPrompt`/`truncateSeoText` (Task 12).
- Produces: `POST /api/events/:id/seo/generate` — body `{ field: "metaTitle" | "metaDescription" }` → `200 { text: string }` — consumido pela Task 17.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/events-seo-generate-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(), getAppName: vi.fn() }));
vi.mock("@/lib/ai", () => ({ getAiProvider: vi.fn() }));

import { POST } from "@/app/api/events/[id]/seo/generate/route";
import { auth } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { getAiProvider } from "@/lib/ai";

const authMock = vi.mocked(auth);
const dbMock = db as any;

const EVENT = {
  id: "event-1",
  organizerId: "organizer-1",
  title: "Corrida da Serra",
  description: "Uma corrida linda.",
  city: "Belo Horizonte",
  state: "MG",
  modality: "TRAIL_RUN",
  startAt: new Date("2026-09-01T09:00:00Z"),
};

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/events/event-1/seo/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/events/[id]/seo/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findUnique.mockResolvedValue(EVENT);
    vi.mocked(getSetting).mockResolvedValue(null);
  });

  it("retorna 403 para quem não pode editar eventos", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest({ field: "metaTitle" }), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(403);
  });

  it("retorna 400 com field inválido", async () => {
    const res = await POST(makeRequest({ field: "banana" }), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando o evento não existe", async () => {
    dbMock.event.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ field: "metaTitle" }), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(404);
  });

  it("retorna 502 quando o provedor de IA falha", async () => {
    vi.mocked(getAiProvider).mockResolvedValueOnce({
      generateText: vi.fn().mockRejectedValueOnce(new Error("Chave de API do Claude não configurada")),
    });
    const res = await POST(makeRequest({ field: "metaTitle" }), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Chave de API do Claude não configurada");
  });

  it("retorna 200 com o texto gerado e truncado", async () => {
    vi.mocked(getAiProvider).mockResolvedValueOnce({
      generateText: vi.fn().mockResolvedValueOnce("a".repeat(100)),
    });
    const res = await POST(makeRequest({ field: "metaTitle" }), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toHaveLength(70);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/events-seo-generate-route.test.ts`
Expected: FAIL — a rota não existe.

- [ ] **Step 3: Implementar**

Criar `app/api/events/[id]/seo/generate/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { getSetting } from "@/lib/settings";
import { getAiProvider } from "@/lib/ai";
import { buildSeoPrompt, truncateSeoText } from "@/lib/seo/build-seo-prompt";

const schema = z.object({ field: z.enum(["metaTitle", "metaDescription"]) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("events.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : scope.organizerId
      ? await db.event.findFirst({ where: { id, organizerId: scope.organizerId } })
      : null;

  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const brandContext = await getSetting("seo_brand_context");
  const prompt = buildSeoPrompt({
    kind: "event",
    field: parsed.data.field,
    title: event.title,
    description: event.description,
    city: event.city,
    state: event.state,
    modality: event.modality,
    startAt: event.startAt,
    brandContext,
  });

  try {
    const provider = await getAiProvider();
    const generated = await provider.generateText(prompt);
    return NextResponse.json({ text: truncateSeoText(generated, parsed.data.field) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Falha ao gerar texto" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/events-seo-generate-route.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add "app/api/events/[id]/seo/generate/route.ts" tests/events-seo-generate-route.test.ts
git commit -m "feat: rota de geracao por IA do meta titulo/descricao do evento"
```

---

### Task 14: `POST /api/admin/seo/generate`

**Files:**
- Create: `app/api/admin/seo/generate/route.ts`
- Test: `tests/admin-seo-generate-route.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`... na verdade rota de API usa `auth()` direto (padrão já usado em
  `app/api/admin/settings/route.ts`), `getAiProvider` (Task 11), `buildSeoPrompt`/`truncateSeoText` (Task 12).
- Produces: `POST /api/admin/seo/generate` — body `{ field: "metaTitle" | "metaDescription" }` → `200 { text: string }` — consumido pela Task 18.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/admin-seo-generate-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(), getAppName: vi.fn() }));
vi.mock("@/lib/ai", () => ({ getAiProvider: vi.fn() }));

import { POST } from "@/app/api/admin/seo/generate/route";
import { auth } from "@/lib/auth";
import { getSetting, getAppName } from "@/lib/settings";
import { getAiProvider } from "@/lib/ai";

const authMock = vi.mocked(auth);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/seo/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/seo/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    vi.mocked(getSetting).mockResolvedValue(null);
    vi.mocked(getAppName).mockResolvedValue("Circuito das Corridas");
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest({ field: "metaTitle" }));
    expect(res.status).toBe(403);
  });

  it("retorna 400 com field inválido", async () => {
    const res = await POST(makeRequest({ field: "banana" }));
    expect(res.status).toBe(400);
  });

  it("retorna 502 quando o provedor de IA falha", async () => {
    vi.mocked(getAiProvider).mockResolvedValueOnce({
      generateText: vi.fn().mockRejectedValueOnce(new Error("Chave de API do Claude não configurada")),
    });
    const res = await POST(makeRequest({ field: "metaTitle" }));
    expect(res.status).toBe(502);
  });

  it("retorna 200 com o texto gerado e truncado", async () => {
    vi.mocked(getAiProvider).mockResolvedValueOnce({
      generateText: vi.fn().mockResolvedValueOnce("a".repeat(200)),
    });
    const res = await POST(makeRequest({ field: "metaDescription" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toHaveLength(160);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-seo-generate-route.test.ts`
Expected: FAIL — a rota não existe.

- [ ] **Step 3: Implementar**

Criar `app/api/admin/seo/generate/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getAppName, getSetting } from "@/lib/settings";
import { getAiProvider } from "@/lib/ai";
import { buildSeoPrompt, truncateSeoText } from "@/lib/seo/build-seo-prompt";

const schema = z.object({ field: z.enum(["metaTitle", "metaDescription"]) });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [appName, brandContext] = await Promise.all([getAppName(), getSetting("seo_brand_context")]);
  const prompt = buildSeoPrompt({ kind: "site", field: parsed.data.field, appName, brandContext });

  try {
    const provider = await getAiProvider();
    const generated = await provider.generateText(prompt);
    return NextResponse.json({ text: truncateSeoText(generated, parsed.data.field) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Falha ao gerar texto" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-seo-generate-route.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/seo/generate/route.ts tests/admin-seo-generate-route.test.ts
git commit -m "feat: rota de geracao por IA do meta titulo/descricao globais do site"
```

---

### Task 15: `components/admin/AiProviderSettingsForm.tsx`

**Files:**
- Create: `components/admin/AiProviderSettingsForm.tsx`
- Modify: `app/admin/seo/page.tsx`

**Interfaces:**
- Produces: chaves `ai_provider`, `ai_claude_api_key`, `ai_openai_api_key`, `ai_google_api_key` em `PlatformSetting`.

Sem teste automatizado (Client Component, convenção do projeto).

- [ ] **Step 1: Criar o formulário**

Criar `components/admin/AiProviderSettingsForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AiProviderKey = "CLAUDE" | "OPENAI" | "GOOGLE";

interface Props {
  currentProvider: AiProviderKey;
  claudeConfigured: boolean;
  openaiConfigured: boolean;
  googleConfigured: boolean;
}

async function saveSetting(key: string, value: string) {
  const res = await fetch("/api/admin/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
}

export default function AiProviderSettingsForm({
  currentProvider,
  claudeConfigured,
  openaiConfigured,
  googleConfigured,
}: Props) {
  const router = useRouter();
  const [provider, setProvider] = useState<AiProviderKey>(currentProvider);
  const [claudeKey, setClaudeKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveSetting("ai_provider", provider);
      if (claudeKey.trim()) await saveSetting("ai_claude_api_key", claudeKey.trim());
      if (openaiKey.trim()) await saveSetting("ai_openai_api_key", openaiKey.trim());
      if (googleKey.trim()) await saveSetting("ai_google_api_key", googleKey.trim());
      setClaudeKey("");
      setOpenaiKey("");
      setGoogleKey("");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar configuração de IA");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {saved && (
        <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded px-3 py-2">
          Configuração de IA salva com sucesso!
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Provedor ativo</label>
        <select value={provider} onChange={(e) => setProvider(e.target.value as AiProviderKey)} className="input-field w-full md:w-64">
          <option value="CLAUDE">Claude (Anthropic)</option>
          <option value="OPENAI">OpenAI</option>
          <option value="GOOGLE">Google (Gemini)</option>
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Chave da API — Claude</label>
          <input
            type="password"
            value={claudeKey}
            onChange={(e) => setClaudeKey(e.target.value)}
            className="input-field w-full"
            placeholder={claudeConfigured ? "••••••• (configurada)" : "Cole a chave"}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Chave da API — OpenAI</label>
          <input
            type="password"
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            className="input-field w-full"
            placeholder={openaiConfigured ? "••••••• (configurada)" : "Cole a chave"}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Chave da API — Google</label>
          <input
            type="password"
            value={googleKey}
            onChange={(e) => setGoogleKey(e.target.value)}
            className="input-field w-full"
            placeholder={googleConfigured ? "••••••• (configurada)" : "Cole a chave"}
            autoComplete="off"
          />
        </div>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">Deixe um campo em branco para manter a chave já salva.</p>

      <button type="submit" disabled={saving} className="btn-primary px-6 disabled:opacity-50">
        {saving ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Wire na página `/admin/seo`**

Em `app/admin/seo/page.tsx`, adicionar o import:

```tsx
import AiProviderSettingsForm from "@/components/admin/AiProviderSettingsForm";
```

Adicionar aos `Promise.all` (junto com as outras chamadas de `getSetting`):

```ts
    getSetting("ai_provider"),
    getSetting("ai_claude_api_key"),
    getSetting("ai_openai_api_key"),
    getSetting("ai_google_api_key"),
```

(ajustar a desestruturação do array pra capturar `aiProvider, claudeKey, openaiKey, googleKey`) e
adicionar depois do `<div className="card">` existente:

```tsx
      <div className="card">
        <h2 className="font-semibold mb-3">Geração por IA</h2>
        <AiProviderSettingsForm
          currentProvider={(aiProvider === "OPENAI" || aiProvider === "GOOGLE" ? aiProvider : "CLAUDE") as any}
          claudeConfigured={Boolean(claudeKey)}
          openaiConfigured={Boolean(openaiKey)}
          googleConfigured={Boolean(googleKey)}
        />
      </div>
```

- [ ] **Step 3: Rodar `tsc --noEmit` e o build**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 4: Commit**

```bash
git add components/admin/AiProviderSettingsForm.tsx app/admin/seo/page.tsx
git commit -m "feat: formulario de provedor de IA e chaves de API na aba SEO"
```

---

### Task 16: Botão "Gerar com IA" no `SeoSettingsForm` (campos globais)

**Files:**
- Modify: `components/admin/SeoSettingsForm.tsx`

Sem teste automatizado (Client Component, convenção do projeto).

- [ ] **Step 1: Implementar**

Em `components/admin/SeoSettingsForm.tsx`, adicionar estado de geração e uma função auxiliar
depois da declaração de `saveSetting` (fora do componente):

```tsx
async function generateSiteText(field: "metaTitle" | "metaDescription"): Promise<string> {
  const res = await fetch("/api/admin/seo/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Erro ao gerar texto");
  return data.text as string;
}
```

Dentro do componente `SeoSettingsForm`, adicionar estado:

```tsx
  const [generating, setGenerating] = useState<"metaTitle" | "metaDescription" | null>(null);

  async function handleGenerate(field: "metaTitle" | "metaDescription") {
    setGenerating(field);
    setError(null);
    try {
      const text = await generateSiteText(field);
      if (field === "metaTitle") setTitle(text);
      else setDescription(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gerar texto com IA");
    } finally {
      setGenerating(null);
    }
  }
```

Trocar o bloco do campo "Título padrão do site":

```tsx
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Título padrão do site</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={70} className="input-field w-full" />
      </div>
```

por:

```tsx
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Título padrão do site</label>
          <button
            type="button"
            onClick={() => handleGenerate("metaTitle")}
            disabled={generating !== null}
            className="text-xs text-primary-600 hover:underline disabled:opacity-50"
          >
            {generating === "metaTitle" ? "Gerando..." : "✨ Gerar com IA"}
          </button>
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={70} className="input-field w-full" />
      </div>
```

E o bloco "Descrição padrão do site":

```tsx
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição padrão do site</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={160} rows={3} className="input-field w-full" />
      </div>
```

por:

```tsx
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Descrição padrão do site</label>
          <button
            type="button"
            onClick={() => handleGenerate("metaDescription")}
            disabled={generating !== null}
            className="text-xs text-primary-600 hover:underline disabled:opacity-50"
          >
            {generating === "metaDescription" ? "Gerando..." : "✨ Gerar com IA"}
          </button>
        </div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={160} rows={3} className="input-field w-full" />
      </div>
```

- [ ] **Step 2: Rodar `tsc --noEmit` e o build**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 3: Commit**

```bash
git add components/admin/SeoSettingsForm.tsx
git commit -m "feat: botao gerar com IA nos campos globais de SEO"
```

---

### Task 17: Botão "Gerar com IA" no `EditEventForm` (campos por evento)

**Files:**
- Modify: `components/organizer/EditEventForm.tsx`

Sem teste automatizado (Client Component, convenção do projeto).

- [ ] **Step 1: Implementar**

Em `components/organizer/EditEventForm.tsx`, adicionar (fora do componente, perto do topo):

```tsx
async function generateEventText(eventId: string, field: "metaTitle" | "metaDescription"): Promise<string> {
  const res = await fetch(`/api/events/${eventId}/seo/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Erro ao gerar texto");
  return data.text as string;
}
```

Dentro do componente, usar `setValue` do `useForm` (adicionar `setValue` à desestruturação
existente em `const { register, handleSubmit, formState: { errors, isSubmitting } } =
useForm<FormData>({...})`, trocando para `const { register, handleSubmit, setValue, formState: {
errors, isSubmitting } } = useForm<FormData>({...})`), e adicionar estado:

```tsx
  const [generating, setGenerating] = useState<"metaTitle" | "metaDescription" | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  async function handleGenerate(field: "metaTitle" | "metaDescription") {
    setGenerating(field);
    setGenerateError(null);
    try {
      const text = await generateEventText(event.id, field);
      setValue(field, text, { shouldValidate: true });
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Erro ao gerar texto com IA");
    } finally {
      setGenerating(null);
    }
  }
```

Trocar o bloco de SEO adicionado na Task 10:

```tsx
      <div className="border-t pt-5 dark:border-gray-700 space-y-4">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">SEO</h3>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Meta título</label>
          <input {...register("metaTitle")} maxLength={70} className="input w-full" placeholder="Deixe em branco para usar o nome do evento" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Meta descrição</label>
          <textarea {...register("metaDescription")} maxLength={160} rows={2} className="input w-full" placeholder="Deixe em branco para usar a descrição do evento" />
        </div>
      </div>
```

por:

```tsx
      <div className="border-t pt-5 dark:border-gray-700 space-y-4">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">SEO</h3>
        {generateError && <p className="text-red-500 text-xs">{generateError}</p>}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Meta título</label>
            <button
              type="button"
              onClick={() => handleGenerate("metaTitle")}
              disabled={generating !== null}
              className="text-xs text-primary-600 hover:underline disabled:opacity-50"
            >
              {generating === "metaTitle" ? "Gerando..." : "✨ Gerar com IA"}
            </button>
          </div>
          <input {...register("metaTitle")} maxLength={70} className="input w-full" placeholder="Deixe em branco para usar o nome do evento" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Meta descrição</label>
            <button
              type="button"
              onClick={() => handleGenerate("metaDescription")}
              disabled={generating !== null}
              className="text-xs text-primary-600 hover:underline disabled:opacity-50"
            >
              {generating === "metaDescription" ? "Gerando..." : "✨ Gerar com IA"}
            </button>
          </div>
          <textarea {...register("metaDescription")} maxLength={160} rows={2} className="input w-full" placeholder="Deixe em branco para usar a descrição do evento" />
        </div>
      </div>
```

- [ ] **Step 2: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 3: Commit**

```bash
git add components/organizer/EditEventForm.tsx
git commit -m "feat: botao gerar com IA nos campos de SEO do evento"
```

---

## Parte D — Refatoração do link de destino dos anúncios

### Task 18: `lib/validate-url.ts`

**Files:**
- Create: `lib/validate-url.ts`
- Test: `tests/lib-validate-url.test.ts`

**Interfaces:**
- Produces: `validateAdDestinationUrl(input: string, options?: { allowRelative?: boolean }): { ok: true; url: string } | { ok: false; error: string }` — consumido pelas Tasks 19, 21, 22, 24.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-validate-url.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateAdDestinationUrl } from "@/lib/validate-url";

describe("validateAdDestinationUrl", () => {
  it("aceita URL https absoluta", () => {
    expect(validateAdDestinationUrl("https://empresa.com/pagina")).toEqual({
      ok: true,
      url: "https://empresa.com/pagina",
    });
  });

  it("rejeita http (exige https)", () => {
    const result = validateAdDestinationUrl("http://empresa.com");
    expect(result.ok).toBe(false);
  });

  it("rejeita javascript:", () => {
    const result = validateAdDestinationUrl("javascript:alert(1)");
    expect(result.ok).toBe(false);
  });

  it("rejeita data:", () => {
    expect(validateAdDestinationUrl("data:text/html,<script>alert(1)</script>").ok).toBe(false);
  });

  it("rejeita file:", () => {
    expect(validateAdDestinationUrl("file:///etc/passwd").ok).toBe(false);
  });

  it("rejeita ftp:", () => {
    expect(validateAdDestinationUrl("ftp://empresa.com").ok).toBe(false);
  });

  it("rejeita URL malformada", () => {
    expect(validateAdDestinationUrl("não é uma url").ok).toBe(false);
  });

  it("rejeita string vazia", () => {
    expect(validateAdDestinationUrl("").ok).toBe(false);
  });

  it("remove espaços nas pontas antes de validar", () => {
    expect(validateAdDestinationUrl("  https://empresa.com  ")).toEqual({
      ok: true,
      url: "https://empresa.com/",
    });
  });

  it("rejeita URL maior que 500 caracteres", () => {
    const long = "https://empresa.com/" + "a".repeat(500);
    expect(validateAdDestinationUrl(long).ok).toBe(false);
  });

  it("rejeita localhost", () => {
    expect(validateAdDestinationUrl("https://localhost/pagina").ok).toBe(false);
  });

  it("rejeita IP privado (192.168.x.x)", () => {
    expect(validateAdDestinationUrl("https://192.168.1.1/pagina").ok).toBe(false);
  });

  it("rejeita caminho relativo por padrão", () => {
    expect(validateAdDestinationUrl("/auth/cadastro-anunciante").ok).toBe(false);
  });

  it("aceita caminho relativo quando allowRelative é true", () => {
    expect(validateAdDestinationUrl("/auth/cadastro-anunciante", { allowRelative: true })).toEqual({
      ok: true,
      url: "/auth/cadastro-anunciante",
    });
  });

  it("continua rejeitando protocolo perigoso mesmo com allowRelative true", () => {
    expect(validateAdDestinationUrl("javascript:alert(1)", { allowRelative: true }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-validate-url.test.ts`
Expected: FAIL — `@/lib/validate-url` não existe.

- [ ] **Step 3: Implementar**

Criar `lib/validate-url.ts`:

```ts
const MAX_LENGTH = 500;
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function isPrivateHost(hostname: string): boolean {
  if (BLOCKED_HOSTS.has(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

export interface ValidateAdUrlOptions {
  allowRelative?: boolean;
}

export type ValidateAdUrlResult = { ok: true; url: string } | { ok: false; error: string };

export function validateAdDestinationUrl(
  input: string,
  options: ValidateAdUrlOptions = {},
): ValidateAdUrlResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { ok: false, error: "URL de destino não pode ser vazia" };
  }
  if (trimmed.length > MAX_LENGTH) {
    return { ok: false, error: `URL de destino excede o limite de ${MAX_LENGTH} caracteres` };
  }
  if (options.allowRelative && trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return { ok: true, url: trimmed };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "URL de destino inválida" };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, error: "URL de destino precisa começar com https://" };
  }
  if (isPrivateHost(parsed.hostname)) {
    return { ok: false, error: "URL de destino não pode apontar para um endereço interno" };
  }

  return { ok: true, url: parsed.toString() };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-validate-url.test.ts`
Expected: PASS (15 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/validate-url.ts tests/lib-validate-url.test.ts
git commit -m "feat: validateAdDestinationUrl centraliza validacao de link de anuncio"
```

---

### Task 19: Aplicar `validateAdDestinationUrl` nas rotas do anúncio da casa + tornar o link opcional

**Files:**
- Modify: `app/api/admin/ads/slots/[id]/house-ad/route.ts:32-46`
- Modify: `app/api/admin/ads/slots/[id]/route.ts:29-38`
- Modify: `tests/admin-house-ad-upload-route.test.ts`
- Modify: `tests/admin-ad-slots-route.test.ts`

**Interfaces:**
- Consumes: `validateAdDestinationUrl` (Task 18).

- [ ] **Step 1: Ajustar os testes existentes de `house-ad/route.ts`**

Em `tests/admin-house-ad-upload-route.test.ts`, trocar o teste "retorna 400 com URL de destino
inválida" (linhas 56-61) por dois testes:

```ts
  it("retorna 400 com URL de destino malformada", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const res = await POST(makeRequest({ targetUrl: "não-é-url" }), { params: Promise.resolve({ id: "slot-1" }) });
    expect(res.status).toBe(400);
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a URL de destino usa http em vez de https", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const res = await POST(makeRequest({ targetUrl: "http://empresa.com" }), { params: Promise.resolve({ id: "slot-1" }) });
    expect(res.status).toBe(400);
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("aceita cadastro sem URL de destino (link opcional)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.adSlot.findUnique.mockResolvedValueOnce(SLOT);
    validateImageDimensionsMock.mockResolvedValueOnce(true);

    const res = await POST(makeRequest({ targetUrl: "" }), { params: Promise.resolve({ id: "slot-1" }) });

    expect(res.status).toBe(200);
    expect(updateAdSlotMock).toHaveBeenCalledWith("slot-1", {
      source: "HOUSE",
      houseAdImageUrl: expect.any(String),
      houseAdTargetUrl: null,
    });
  });
```

Trocar o teste "retorna 400 quando a URL de destino usa esquema não-http (ex: javascript:)"
(linhas 102-111) — já cobre `javascript:`, mantém como está.

Trocar o teste "retorna 400 quando o campo `targetUrl` está ausente" implícito em "retorna 400
com Campos obrigatórios ausentes" — como `targetUrl` deixa de ser obrigatório, ajustar
`makeRequest` (linhas 22-36) removendo `targetUrl` dos `defaults` (o campo some do FormData
quando não passado) e o teste "retorna 200 e atualiza a posição no caminho de sucesso" (linha
84-100) continua passando `targetUrl: "https://empresa.com"` explicitamente via `fields`.

Ajustar `makeRequest`:

```ts
function makeRequest(fields: Record<string, string | Blob> = {}) {
  const formData = new FormData();
  const defaults: Record<string, string | Blob> = {
    targetUrl: "https://empresa.com",
    image: new File(["fake-image-bytes"], "ad.png", { type: "image/png" }),
  };
  const merged = { ...defaults, ...fields };
  for (const [key, value] of Object.entries(merged)) {
    if (value === "") continue; // simula campo não preenchido, igual a um form real
    formData.append(key, value as any);
  }
  return new Request("http://localhost/api/admin/ads/slots/slot-1/house-ad", {
    method: "POST",
    body: formData,
  }) as any;
}
```

- [ ] **Step 2: Ajustar o teste existente de `slots/[id]/route.ts`**

Em `tests/admin-ad-slots-route.test.ts`, o teste "retorna 400 quando houseAdTargetUrl usa esquema
não-http (ex: javascript:)" (linhas 96-103) continua válido como está. Adicionar um novo teste
depois dele:

```ts
  it("retorna 400 quando houseAdTargetUrl usa http em vez de https", async () => {
    const res = await PATCH(
      makeRequest({ source: "HOUSE", houseAdTargetUrl: "http://empresa.com" }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );
    expect(res.status).toBe(400);
    expect(updateAdSlot).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-house-ad-upload-route.test.ts tests/admin-ad-slots-route.test.ts`
Expected: FAIL — os novos casos (http rejeitado, link vazio aceito) ainda não são tratados assim
pela implementação atual.

- [ ] **Step 4: Implementar — `house-ad/route.ts`**

Em `app/api/admin/ads/slots/[id]/house-ad/route.ts`, adicionar o import:

```ts
import { validateAdDestinationUrl } from "@/lib/validate-url";
```

Trocar (linhas 32-46):

```ts
  const targetUrl = formData.get("targetUrl") as string | null;
  const image = formData.get("image") as File | null;

  if (!targetUrl || !image) {
    return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 });
  }

  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
  }
```

por:

```ts
  const targetUrlRaw = formData.get("targetUrl") as string | null;
  const image = formData.get("image") as File | null;

  if (!image) {
    return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 });
  }

  let targetUrl: string | null = null;
  if (targetUrlRaw && targetUrlRaw.trim()) {
    const validated = validateAdDestinationUrl(targetUrlRaw, { allowRelative: true });
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    targetUrl = validated.url;
  }
```

E no `updateAdSlot` no fim da função (linha 99-103), `houseAdTargetUrl: targetUrl` já vai
receber `null` corretamente quando o link não for informado — nenhuma mudança adicional
necessária ali. Ajustar também a resposta final (linha 112) que já usa `targetUrl` — segue igual.

- [ ] **Step 5: Implementar — `slots/[id]/route.ts`**

Em `app/api/admin/ads/slots/[id]/route.ts`, adicionar o import:

```ts
import { validateAdDestinationUrl } from "@/lib/validate-url";
```

Trocar (linhas 29-38):

```ts
  if (parsed.data.houseAdTargetUrl) {
    try {
      const url = new URL(parsed.data.houseAdTargetUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
    }
  }
```

por:

```ts
  if (parsed.data.houseAdTargetUrl) {
    const validated = validateAdDestinationUrl(parsed.data.houseAdTargetUrl, { allowRelative: true });
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    parsed.data.houseAdTargetUrl = validated.url;
  }
```

- [ ] **Step 6: Remover o `required` do formulário**

Em `components/admin/HouseAdUploadForm.tsx`, trocar o input de URL (linhas 62-69):

```tsx
        <input
          type="url"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="URL de destino"
          className="input-field text-sm py-1 w-56"
          required
        />
```

por:

```tsx
        <input
          type="url"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="URL de destino (opcional)"
          className="input-field text-sm py-1 w-56"
        />
```

E no `handleSubmit`, remover a validação que exige `targetUrl` implicitamente — como o backend já
aceita vazio, não é preciso mudar mais nada no componente (o `FormData.append("targetUrl",
targetUrl)` já manda string vazia quando o campo estiver em branco, e o backend trata isso como
"sem link").

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-house-ad-upload-route.test.ts tests/admin-ad-slots-route.test.ts`
Expected: PASS

- [ ] **Step 8: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 9: Commit**

```bash
git add app/api/admin/ads/slots components/admin/HouseAdUploadForm.tsx tests/admin-house-ad-upload-route.test.ts tests/admin-ad-slots-route.test.ts
git commit -m "fix: valida link do anuncio da casa com validateAdDestinationUrl e torna opcional"
```

---

### Task 20: Corrigir `AdSlotRenderer` — link opcional, nova aba, acessibilidade

**Files:**
- Modify: `components/ads/AdSlotRenderer.tsx`

Sem teste automatizado (Server Component, convenção do projeto — a decisão de validação já está
coberta pelos testes das Tasks 18/19/23).

- [ ] **Step 1: Implementar**

Trocar o arquivo inteiro `components/ads/AdSlotRenderer.tsx` por:

```tsx
import Image from "next/image";
import { getAdSlot } from "@/lib/ad-slots";
import { getSetting } from "@/lib/settings";
import { db } from "@/lib/db";
import { recordImpression } from "@/lib/ads/private-ad-metrics";

function ClickableAd({
  href,
  imageUrl,
  imageAlt,
  width,
  height,
}: {
  href: string;
  imageUrl: string;
  imageAlt: string;
  width: number;
  height: number;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Anúncio publicitário — abre em nova aba"
      className="relative inline-block group"
      style={{ width, height }}
    >
      <Image src={imageUrl} alt={imageAlt} width={width} height={height} style={{ objectFit: "cover" }} />
      <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] leading-tight text-center py-0.5 opacity-90 group-hover:opacity-100">
        Publicidade · Saiba mais
      </span>
    </a>
  );
}

export default async function AdSlotRenderer({ position }: { position: string }) {
  const slot = await getAdSlot(position);
  if (!slot) return null;
  if (!slot.enabled) return null;

  if (slot.source === "PRIVATE") {
    const ad = await db.privateAd.findFirst({ where: { adSlotId: slot.id, status: "APPROVED" } });
    if (!ad) return null;
    await recordImpression(slot.id, "PRIVATE");
    return (
      <ClickableAd
        href={`/api/ads/click/${ad.id}`}
        imageUrl={ad.imageUrl}
        imageAlt=""
        width={slot.width}
        height={slot.height}
      />
    );
  }

  if (slot.source === "HOUSE") {
    if (!slot.houseAdImageUrl) return null;
    await recordImpression(slot.id, "HOUSE");
    if (!slot.houseAdTargetUrl) {
      // Anúncio da casa sem link de destino: continua visível, sem ação de navegação — não
      // envolve em <a> nenhuma pra não ter âncora sem destino.
      return (
        <Image
          src={slot.houseAdImageUrl}
          alt=""
          width={slot.width}
          height={slot.height}
          style={{ objectFit: "cover" }}
        />
      );
    }
    return (
      <ClickableAd
        href={`/api/ads/click/house/${slot.id}`}
        imageUrl={slot.houseAdImageUrl}
        imageAlt=""
        width={slot.width}
        height={slot.height}
      />
    );
  }

  if (!slot || !slot.enabled || slot.source !== "GOOGLE" || !slot.googleAdUnitId) return null;

  const clientId = await getSetting("google_adsense_client_id");
  if (!clientId) return null;

  return (
    <div style={{ width: slot.width, maxWidth: "100%" }} className="mx-auto">
      <ins
        className="adsbygoogle"
        style={{ display: "inline-block", width: slot.width, height: slot.height }}
        data-ad-client={clientId}
        data-ad-slot={slot.googleAdUnitId}
      />
      <script
        dangerouslySetInnerHTML={{ __html: "(adsbygoogle = window.adsbygoogle || []).push({});" }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 3: Commit**

```bash
git add components/ads/AdSlotRenderer.tsx
git commit -m "fix: anuncio da casa sem link continua visivel; cliques abrem em nova aba com acessibilidade"
```

---

### Task 21: Aplicar `validateAdDestinationUrl` na criação de anúncio privado

**Files:**
- Modify: `app/api/anunciante/ads/route.ts:56-60`
- Modify: `tests/advertiser-ads-route.test.ts`

**Interfaces:**
- Consumes: `validateAdDestinationUrl` (Task 18).

- [ ] **Step 1: Adicionar os testes que falham**

Em `tests/advertiser-ads-route.test.ts`, adicionar depois do teste "retorna 400 quando a
dimensão da imagem não bate..." (antes do teste de sucesso, linha ~140):

```ts
  it("retorna 400 quando a URL de destino usa http em vez de https", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });

    const res = await POST(makeRequest({ targetUrl: "http://empresa.com" }));

    expect(res.status).toBe(400);
    expect(dbMock.adPurchase.findFirst).not.toHaveBeenCalled();
    expect(dbMock.privateAd.create).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a URL de destino usa protocolo perigoso (javascript:)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });

    const res = await POST(makeRequest({ targetUrl: "javascript:alert(1)" }));

    expect(res.status).toBe(400);
    expect(dbMock.privateAd.create).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/advertiser-ads-route.test.ts`
Expected: FAIL — a validação atual aceita `http://` e não checa protocolo perigoso de forma
consistente.

- [ ] **Step 3: Implementar**

Em `app/api/anunciante/ads/route.ts`, adicionar o import:

```ts
import { validateAdDestinationUrl } from "@/lib/validate-url";
```

Trocar (linhas 56-60):

```ts
  try {
    new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
  }
```

por:

```ts
  const validatedUrl = validateAdDestinationUrl(targetUrl);
  if (!validatedUrl.ok) {
    return NextResponse.json({ error: validatedUrl.error }, { status: 400 });
  }
```

E no `db.privateAd.create` (linha 132-140), trocar `targetUrl,` por `targetUrl: validatedUrl.url,`.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/advertiser-ads-route.test.ts`
Expected: PASS

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/api/anunciante/ads/route.ts tests/advertiser-ads-route.test.ts
git commit -m "fix: valida link do anuncio privado com validateAdDestinationUrl (https obrigatorio)"
```

---

### Task 22: `PATCH /api/anunciante/ads/[id]` — editar link com remoderação

**Files:**
- Create: `app/api/anunciante/ads/[id]/route.ts`
- Test: `tests/advertiser-ads-edit-route.test.ts`

**Interfaces:**
- Consumes: `checkAdvertiserApiPermission` (`lib/auth/rbac.ts`), `validateAdDestinationUrl` (Task 18).
- Produces: `PATCH /api/anunciante/ads/:id` — body `{ targetUrl: string }` → `200 { ok: true }` — consumido pela Task 23.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/advertiser-ads-edit-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH } from "@/app/api/anunciante/ads/[id]/route";
import { auth } from "@/lib/auth";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/anunciante/ads/ad-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("PATCH /api/anunciante/ads/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValue({ id: "advertiser-1" });
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(401);
  });

  it("retorna 400 com URL inválida", async () => {
    const res = await PATCH(makeRequest({ targetUrl: "http://empresa.com" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(400);
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o anúncio não pertence ao anunciante autenticado", async () => {
    dbMock.privateAd.findFirst.mockResolvedValueOnce(null);
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(404);
    expect(dbMock.privateAd.findFirst).toHaveBeenCalledWith({
      where: { id: "ad-1", adPurchase: { advertiserId: "advertiser-1" } },
      select: { id: true, status: true },
    });
  });

  it("retorna 400 quando o anúncio está REJECTED/EXPIRED/CANCELLED", async () => {
    dbMock.privateAd.findFirst.mockResolvedValueOnce({ id: "ad-1", status: "CANCELLED" });
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(400);
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("atualiza o link sem mudar o status quando o anúncio está PENDING_APPROVAL", async () => {
    dbMock.privateAd.findFirst.mockResolvedValueOnce({ id: "ad-1", status: "PENDING_APPROVAL" });
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com/nova-pagina" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(200);
    expect(dbMock.privateAd.update).toHaveBeenCalledWith({
      where: { id: "ad-1" },
      data: { targetUrl: "https://empresa.com/nova-pagina" },
    });
  });

  it("atualiza o link e volta pra PENDING_APPROVAL quando o anúncio estava APPROVED", async () => {
    dbMock.privateAd.findFirst.mockResolvedValueOnce({ id: "ad-1", status: "APPROVED" });
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com/nova-pagina" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(200);
    expect(dbMock.privateAd.update).toHaveBeenCalledWith({
      where: { id: "ad-1" },
      data: { targetUrl: "https://empresa.com/nova-pagina", status: "PENDING_APPROVAL", rejectionReason: null },
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/advertiser-ads-edit-route.test.ts`
Expected: FAIL — a rota não existe.

- [ ] **Step 3: Implementar**

Criar `app/api/anunciante/ads/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkAdvertiserApiPermission } from "@/lib/auth/rbac";
import { validateAdDestinationUrl } from "@/lib/validate-url";

const schema = z.object({ targetUrl: z.string() });
const EDITABLE_STATUSES = ["PENDING_APPROVAL", "APPROVED"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdvertiserApiPermission();
  if (!check.allowed) return check.response;
  if (!check.advertiser) {
    return NextResponse.json({ error: "Perfil de anunciante não encontrado" }, { status: 404 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const validatedUrl = validateAdDestinationUrl(parsed.data.targetUrl);
  if (!validatedUrl.ok) {
    return NextResponse.json({ error: validatedUrl.error }, { status: 400 });
  }

  const ad = await db.privateAd.findFirst({
    where: { id, adPurchase: { advertiserId: check.advertiser.id } },
    select: { id: true, status: true },
  });
  if (!ad) {
    return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });
  }
  if (!EDITABLE_STATUSES.includes(ad.status)) {
    return NextResponse.json({ error: "Este anúncio não pode mais ser editado" }, { status: 400 });
  }

  const wasApproved = ad.status === "APPROVED";
  await db.privateAd.update({
    where: { id },
    data: wasApproved
      ? { targetUrl: validatedUrl.url, status: "PENDING_APPROVAL", rejectionReason: null }
      : { targetUrl: validatedUrl.url },
  });

  return NextResponse.json({ ok: true, requiresReview: wasApproved });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/advertiser-ads-edit-route.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add "app/api/anunciante/ads/[id]/route.ts" tests/advertiser-ads-edit-route.test.ts
git commit -m "feat: edicao do link do anuncio privado com remoderacao automatica"
```

---

### Task 23: `EditPrivateAdLinkButton` — UI do anunciante

**Files:**
- Create: `components/advertiser/EditPrivateAdLinkButton.tsx`
- Modify: `app/anunciante/anuncios/page.tsx`

**Interfaces:**
- Consumes: `PATCH /api/anunciante/ads/[id]` (Task 22).

Sem teste automatizado (Client Component, convenção do projeto).

- [ ] **Step 1: Criar o componente**

Criar `components/advertiser/EditPrivateAdLinkButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function EditPrivateAdLinkButton({
  id,
  currentUrl,
  isApproved,
}: {
  id: string;
  currentUrl: string;
  isApproved: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetUrl, setTargetUrl] = useState(currentUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/anunciante/ads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUrl }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao editar link");
      setLoading(false);
      return;
    }
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary py-1.5 px-3 text-sm"
      >
        Editar link
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Editar link do anúncio</h2>
            {isApproved && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                Este anúncio já está aprovado. Ao trocar o link, ele volta a aguardar aprovação.
              </p>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">URL de destino</label>
              <input
                type="url"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                className="input-field w-full"
                placeholder="https://minhaempresa.com"
              />
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={loading}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={loading || !targetUrl.trim()}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {loading ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Wire na listagem**

Em `app/anunciante/anuncios/page.tsx`, adicionar o import:

```tsx
import EditPrivateAdLinkButton from "@/components/advertiser/EditPrivateAdLinkButton";
```

Trocar a linha final do card de cada anúncio (linha 64):

```tsx
                {ACTIVE_STATUSES.includes(ad.status) && <PrivateAdCancelButton id={ad.id} />}
```

por:

```tsx
                {ACTIVE_STATUSES.includes(ad.status) && (
                  <div className="flex gap-2">
                    <EditPrivateAdLinkButton id={ad.id} currentUrl={ad.targetUrl} isApproved={ad.status === "APPROVED"} />
                    <PrivateAdCancelButton id={ad.id} />
                  </div>
                )}
```

- [ ] **Step 3: Rodar `tsc --noEmit` e o build**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 4: Commit**

```bash
git add components/advertiser/EditPrivateAdLinkButton.tsx app/anunciante/anuncios/page.tsx
git commit -m "feat: botao de editar link do anuncio privado na listagem do anunciante"
```

---

### Task 24: `PATCH /api/admin/ads/private/[id]` — admin edita o link

**Files:**
- Create: `app/api/admin/ads/private/[id]/route.ts`
- Test: `tests/admin-private-ad-edit-route.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`... na rota de API usa `auth()` direto (mesmo padrão das rotas de
  approve/reject já existentes), `validateAdDestinationUrl` (Task 18).
- Produces: `PATCH /api/admin/ads/private/:id` — body `{ targetUrl: string }` → `200 { ok: true }` — consumido pela Task 25.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/admin-private-ad-edit-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH } from "@/app/api/admin/ads/private/[id]/route";
import { auth } from "@/lib/auth";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/ads/private/ad-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("PATCH /api/admin/ads/private/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(403);
  });

  it("retorna 400 com URL inválida", async () => {
    const res = await PATCH(makeRequest({ targetUrl: "http://empresa.com" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(400);
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o anúncio não existe", async () => {
    dbMock.privateAd.findUnique.mockResolvedValueOnce(null);
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(404);
  });

  it("atualiza o link sem mudar o status (admin é quem modera)", async () => {
    dbMock.privateAd.findUnique.mockResolvedValueOnce({ id: "ad-1", status: "APPROVED" });
    const res = await PATCH(makeRequest({ targetUrl: "https://empresa.com/nova" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(200);
    expect(dbMock.privateAd.update).toHaveBeenCalledWith({
      where: { id: "ad-1" },
      data: { targetUrl: "https://empresa.com/nova" },
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-private-ad-edit-route.test.ts`
Expected: FAIL — a rota não existe.

- [ ] **Step 3: Implementar**

Criar `app/api/admin/ads/private/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateAdDestinationUrl } from "@/lib/validate-url";

const schema = z.object({ targetUrl: z.string() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const validatedUrl = validateAdDestinationUrl(parsed.data.targetUrl);
  if (!validatedUrl.ok) {
    return NextResponse.json({ error: validatedUrl.error }, { status: 400 });
  }

  const ad = await db.privateAd.findUnique({ where: { id }, select: { id: true } });
  if (!ad) {
    return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });
  }

  await db.privateAd.update({ where: { id }, data: { targetUrl: validatedUrl.url } });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-private-ad-edit-route.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add "app/api/admin/ads/private/[id]/route.ts" tests/admin-private-ad-edit-route.test.ts
git commit -m "feat: rota de admin para editar o link de um anuncio privado sem remoderar"
```

---

### Task 25: UI de edição do link na tela de detalhe do admin

**Files:**
- Create: `components/admin/EditPrivateAdLinkForm.tsx`
- Modify: `app/admin/anuncios/privados/[id]/page.tsx`

**Interfaces:**
- Consumes: `PATCH /api/admin/ads/private/[id]` (Task 24).

Sem teste automatizado (Client Component + Server Component, convenção do projeto).

- [ ] **Step 1: Criar o componente**

Criar `components/admin/EditPrivateAdLinkForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function EditPrivateAdLinkForm({ id, currentUrl }: { id: string; currentUrl: string }) {
  const router = useRouter();
  const [targetUrl, setTargetUrl] = useState(currentUrl);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const domain = (() => {
    try {
      return new URL(targetUrl).hostname;
    } catch {
      return null;
    }
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch(`/api/admin/ads/private/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUrl }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao editar link");
      setSaving(false);
      return;
    }
    setSaved(true);
    setSaving(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <input
        type="url"
        value={targetUrl}
        onChange={(e) => setTargetUrl(e.target.value)}
        className="input-field w-full text-sm"
      />
      {domain && <p className="text-xs text-gray-500 dark:text-gray-400">Domínio: {domain}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {saved && <p className="text-xs text-green-600">Link atualizado!</p>}
      <button type="submit" disabled={saving} className="btn-secondary text-xs py-1 px-3 disabled:opacity-50">
        {saving ? "Salvando..." : "Salvar link"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Wire na página de detalhe**

Em `app/admin/anuncios/privados/[id]/page.tsx`, adicionar o import:

```tsx
import EditPrivateAdLinkForm from "@/components/admin/EditPrivateAdLinkForm";
```

Trocar o bloco que mostra o link (linhas 66-73):

```tsx
        <a
          href={data.targetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:underline break-all"
        >
          {data.targetUrl}
        </a>
```

por:

```tsx
        <EditPrivateAdLinkForm id={id} currentUrl={data.targetUrl} />
```

- [ ] **Step 3: Rodar `tsc --noEmit` e o build**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 4: Commit**

```bash
git add components/admin/EditPrivateAdLinkForm.tsx "app/admin/anuncios/privados/[id]/page.tsx"
git commit -m "feat: admin edita o link do anuncio privado direto na tela de detalhe"
```

---

## Revisão final (depois de todas as 25 tasks)

- [ ] Rodar `npx vitest run` inteiro — suíte completa passando.
- [ ] Rodar `npx tsc --noEmit` — sem erros.
- [ ] Rodar `npm run build` — build de produção limpo.
- [ ] Conferir que `Event.metaTitle`/`metaDescription` são sempre opcionais e nunca quebram a
  geração de metadata quando vazios (fallback pro título/descrição do evento).
- [ ] Conferir que nenhuma chave de API de IA/AdSense aparece em texto plano em nenhuma resposta
  de API (só os booleanos "configurada").
- [ ] Conferir que `validateAdDestinationUrl` é a ÚNICA validação de URL usada nas 4 rotas de
  escrita de link de anúncio (house-ad criação, slot PATCH, anunciante criação, anunciante edição,
  admin edição) — nenhuma reimplementação manual de `new URL()` sobrando.
- [ ] Conferir manualmente (leitura de código) que `AdSlotRenderer` nunca renderiza `<a href="#">`
  nem âncora vazia — HOUSE sem link renderiza só `<Image>`, sem `<a>` ao redor.
- [ ] Conferir que a rota `PATCH /api/anunciante/ads/[id]` nunca deixa um anunciante editar
  anúncio de outro (mesmo padrão de posse já usado no cancelamento).
