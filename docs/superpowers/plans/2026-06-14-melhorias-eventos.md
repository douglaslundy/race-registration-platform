# Melhorias de Eventos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar 9 melhorias na plataforma de inscrições de corridas: carrossel de banners, taxa de serviço, upload de banner quadrado, redirecionamento pós-login, disclaimer de responsabilidade, taxas nos lotes, termos dinâmicos, info do organizador e disclaimer no regulamento.

**Architecture:** Next.js 14 App Router com Prisma/PostgreSQL. Configurações da plataforma ficam na tabela `platform_settings` (chave/valor). Taxa de serviço segue o mesmo padrão da taxa da plataforma (`default_platform_fee`). Banner da página de listagem é um campo novo `listBannerUrl` no modelo `Event`. Carrossel usa componente client-side com intervalo configurável via `platform_settings`.

**Tech Stack:** Next.js 14, React, Prisma, TypeScript, TailwindCSS, Zod

---

## File Map

### Novos arquivos
- `components/events/EventsBanner.tsx` — carrossel client-side de banners
- `components/admin/ServiceFeeForm.tsx` — formulário de taxa de serviço
- `components/admin/BannerIntervalForm.tsx` — formulário de intervalo do carrossel
- `components/events/OrganizerInfo.tsx` — bloco de informações do organizador
- `components/events/EventDisclaimer.tsx` — disclaimer de responsabilidade (reutilizável)
- `app/api/events/banners/route.ts` — endpoint que retorna eventos com banner

### Arquivos modificados
- `prisma/schema.prisma` — adicionar campo `listBannerUrl` no model Event
- `lib/settings.ts` — adicionar `getServiceFee`, `getBannerInterval`
- `lib/events.ts` — incluir `listBannerUrl` no select; incluir email/phone do organizador
- `components/checkout/CheckoutForm.tsx` — exibir taxa de serviço; adicionar disclaimer
- `app/(public)/eventos/page.tsx` — inserir carrossel acima da lista
- `app/(public)/eventos/[slug]/page.tsx` — info organizador, disclaimer regulamento
- `app/(public)/privacidade/page.tsx` — usar nome dinâmico da plataforma
- `app/(public)/termos/page.tsx` — usar nome dinâmico da plataforma
- `app/admin/configuracoes/page.tsx` — adicionar seções de taxa de serviço e intervalo do carrossel
- `app/organizador/eventos/[id]/editar/page.tsx` e o formulário de edição — campo upload listBannerUrl
- `app/api/events/[id]/route.ts` — aceitar `listBannerUrl` no schema de update
- `app/api/checkout/route.ts` — calcular e armazenar taxa de serviço

---

## Tarefa 0 — Carrossel de banners na página de eventos

**Pré-requisito:** Eventos com `bannerUrl` preenchido aparecem no carrossel. Intervalo configurável via `banner_interval_seconds` na `platform_settings`.

**Files:**
- Create: `components/events/EventsBanner.tsx`
- Create: `app/api/events/banners/route.ts`
- Create: `components/admin/BannerIntervalForm.tsx`
- Modify: `app/(public)/eventos/page.tsx`
- Modify: `lib/settings.ts`
- Modify: `app/admin/configuracoes/page.tsx`

- [ ] **Step 1: Adicionar `getBannerInterval` em `lib/settings.ts`**

```typescript
// Adicionar ao final de lib/settings.ts:
export const getBannerInterval = cache(async (): Promise<number> => {
  const val = await getSetting("banner_interval_seconds");
  return val ? parseInt(val, 10) : 3;
});
```

- [ ] **Step 2: Criar endpoint `app/api/events/banners/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const events = await db.event.findMany({
    where: {
      status: { in: ["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT"] },
      bannerUrl: { not: null },
    },
    select: { id: true, title: true, slug: true, bannerUrl: true },
    orderBy: { startAt: "asc" },
    take: 10,
  });
  return NextResponse.json(events);
}
```

- [ ] **Step 3: Criar componente `components/events/EventsBanner.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

interface BannerEvent {
  id: string;
  title: string;
  slug: string;
  bannerUrl: string;
}

export default function EventsBanner({ intervalSeconds }: { intervalSeconds: number }) {
  const [events, setEvents] = useState<BannerEvent[]>([]);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    fetch("/api/events/banners")
      .then((r) => r.json())
      .then((data: BannerEvent[]) => setEvents(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (events.length < 2) return;
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % events.length);
    }, intervalSeconds * 1000);
    return () => clearInterval(timer);
  }, [events.length, intervalSeconds]);

  if (events.length === 0) return null;

  const event = events[current];

  return (
    <div className="relative w-full aspect-[16/5] rounded-2xl overflow-hidden mb-8 bg-gray-100 dark:bg-gray-800">
      <Link href={`/eventos/${event.slug}`} className="block w-full h-full">
        <Image
          src={event.bannerUrl}
          alt={event.title}
          fill
          className="object-cover transition-opacity duration-700"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
        <div className="absolute bottom-4 left-4 right-4">
          <p className="text-white font-bold text-lg drop-shadow">{event.title}</p>
        </div>
      </Link>

      {events.length > 1 && (
        <div className="absolute bottom-2 right-4 flex gap-1">
          {events.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`w-2 h-2 rounded-full transition-colors ${i === current ? "bg-white" : "bg-white/40"}`}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Criar componente `components/admin/BannerIntervalForm.tsx`**

```tsx
"use client";

import { useState } from "react";

export default function BannerIntervalForm({ currentInterval }: { currentInterval: number }) {
  const [value, setValue] = useState(String(currentInterval));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const seconds = parseInt(value, 10);
    if (isNaN(seconds) || seconds < 1) {
      setError("Informe um valor válido (mínimo 1 segundo)");
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "banner_interval_seconds", value: String(seconds) }),
    });
    if (res.ok) {
      setSaved(true);
    } else {
      setError("Erro ao salvar");
    }
    setSaving(false);
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          min={1}
          max={30}
          step={1}
          className="input-field w-24 text-sm py-1"
          placeholder="3"
        />
        <span className="text-sm text-gray-600 dark:text-gray-400">segundos</span>
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-primary py-1 px-3 text-sm disabled:opacity-50"
      >
        {saving ? "Salvando…" : saved ? "Salvo!" : "Salvar"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Modificar `app/(public)/eventos/page.tsx` para incluir o carrossel**

Tornar a função `async`, buscar `getBannerInterval` e inserir `<EventsBanner>` acima do grid:

```tsx
import type { Metadata } from "next";
import { listPublicEvents, listDistinctCities } from "@/lib/events";
import EventCard from "@/components/events/EventCard";
import EventFilters from "@/components/events/EventFilters";
import EventsBanner from "@/components/events/EventsBanner";
import { getBannerInterval } from "@/lib/settings";
import type { EventModality } from "@prisma/client";

export const metadata: Metadata = { title: "Eventos" };
export const revalidate = 60;

interface SearchParams {
  cidade?: string;
  modalidade?: string;
  de?: string;
  ate?: string;
  pagina?: string;
}

export default async function EventosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;

  const [{ events, total, totalPages, page }, cities, bannerInterval] = await Promise.all([
    listPublicEvents({
      city: params.cidade,
      modality: params.modalidade as EventModality | undefined,
      from: params.de ? new Date(params.de) : undefined,
      to: params.ate ? new Date(params.ate) : undefined,
      page: params.pagina ? Number(params.pagina) : 1,
    }),
    listDistinctCities(),
    getBannerInterval(),
  ]);

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <EventsBanner intervalSeconds={bannerInterval} />

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Eventos</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">{total} evento{total !== 1 ? "s" : ""} encontrado{total !== 1 ? "s" : ""}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <aside>
          <EventFilters cities={cities} />
        </aside>

        <div className="lg:col-span-3">
          {events.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-lg">Nenhum evento encontrado</p>
              <p className="text-sm mt-2">Tente ajustar os filtros</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {events.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex justify-center mt-8 gap-2">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <a
                      key={p}
                      href={`?pagina=${p}`}
                      className={`px-3 py-1 rounded ${p === page ? "bg-primary-600 text-white" : "bg-white dark:bg-gray-800 border dark:border-gray-700 dark:text-gray-300"}`}
                    >
                      {p}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Adicionar seção de configuração do carrossel em `app/admin/configuracoes/page.tsx`**

No topo, importar `BannerIntervalForm` e `getBannerInterval`, depois adicionar bloco de card após o bloco do nome da plataforma.

- [ ] **Step 7: Commit**

```bash
git add components/events/EventsBanner.tsx app/api/events/banners/route.ts components/admin/BannerIntervalForm.tsx app/(public)/eventos/page.tsx lib/settings.ts app/admin/configuracoes/page.tsx
git commit -m "feat: carrossel de banners na página de eventos com intervalo configurável"
```

---

## Tarefa 1 — Taxa de serviço de ingresso

**Lógica:** Nova chave `service_fee` em `platform_settings` (em centavos, igual à `default_platform_fee`). Exibida no checkout ao lado da taxa da plataforma. Somada ao total do pedido.

**Files:**
- Modify: `lib/settings.ts`
- Modify: `components/checkout/CheckoutForm.tsx`
- Modify: `app/(public)/inscricao/[slug]/page.tsx`
- Modify: `app/api/checkout/route.ts`
- Create: `components/admin/ServiceFeeForm.tsx`
- Modify: `app/admin/configuracoes/page.tsx`

- [ ] **Step 1: Adicionar `getServiceFee` em `lib/settings.ts`**

```typescript
export const getServiceFee = cache(async (): Promise<number> => {
  const val = await getSetting("service_fee");
  return val ? parseInt(val, 10) : 0;
});
```

- [ ] **Step 2: Criar `components/admin/ServiceFeeForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";

export default function ServiceFeeForm({ currentFee }: { currentFee: number }) {
  const [value, setValue] = useState((currentFee / 100).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const cents = Math.round(parseFloat(value) * 100);
    if (isNaN(cents) || cents < 0) {
      setError("Informe um valor válido");
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "service_fee", value: String(cents) }),
    });
    if (res.ok) {
      setSaved(true);
    } else {
      setError("Erro ao salvar");
    }
    setSaving(false);
  }

  const cents = Math.round(parseFloat(value) * 100);
  const preview = !isNaN(cents) && cents >= 0 ? formatCurrency(cents) : null;

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">R$</span>
        <input
          type="number"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          min={0}
          step={0.01}
          className="input-field w-28 text-sm py-1"
          placeholder="0,97"
        />
        {preview && <span className="text-xs text-gray-500">{preview}</span>}
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-primary py-1 px-3 text-sm disabled:opacity-50"
      >
        {saving ? "Salvando…" : saved ? "Salvo!" : "Salvar"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Passar `serviceFee` como prop para `CheckoutForm` via `app/(public)/inscricao/[slug]/page.tsx`**

Adicionar `getServiceFee()` ao `Promise.all` e passar `serviceFee` como prop.

- [ ] **Step 4: Modificar `CheckoutForm` para receber e exibir `serviceFee`**

- Adicionar `serviceFee: number` às props
- Na função `calcPlatformFee`, o total = subtotal + platformFee + serviceFee
- No resumo de valores exibir:
  ```
  Taxa da plataforma   +R$ X,XX
  Taxa de serviço      +R$ X,XX
  Total                R$ Y,YY
  ```

- [ ] **Step 5: Modificar `app/api/checkout/route.ts` para incluir a taxa de serviço no `paymentFeeAmount`**

Buscar `getServiceFee()` e adicionar ao `paymentFeeAmount` calculado.

- [ ] **Step 6: Adicionar seção de taxa de serviço em `app/admin/configuracoes/page.tsx`**

- [ ] **Step 7: Commit**

```bash
git add lib/settings.ts components/admin/ServiceFeeForm.tsx components/checkout/CheckoutForm.tsx app/(public)/inscricao/[slug]/page.tsx app/api/checkout/route.ts app/admin/configuracoes/page.tsx
git commit -m "feat: taxa de serviço de ingresso configurável no checkout"
```

---

## Tarefa 2 — Campo de banner da listagem (quase quadrado)

**Lógica:** Novo campo `listBannerUrl` no modelo `Event` (string, nullable). Upload via mesmo mecanismo do `bannerUrl` mas com `purpose: "list_banner"`. Exibido no `EventCard` com aspecto ~1:1.

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `lib/events.ts`
- Modify: `components/events/EventCard.tsx`
- Modify: `app/api/events/[id]/route.ts`
- Modify: `app/organizador/eventos/[id]/editar/page.tsx` (ou o form de criação)

- [ ] **Step 1: Adicionar campo `listBannerUrl` ao model `Event` em `prisma/schema.prisma`**

```prisma
// Em model Event, após bannerUrl:
listBannerUrl      String?
```

- [ ] **Step 2: Criar e aplicar migração**

```bash
npx prisma migrate dev --name add_list_banner_url
```

- [ ] **Step 3: Incluir `listBannerUrl` no select de `listPublicEvents` em `lib/events.ts`**

```typescript
// No select de db.event.findMany:
listBannerUrl: true,
```

- [ ] **Step 4: Atualizar `EventCard` para usar `listBannerUrl` quando disponível**

```tsx
// No EventCardProps adicionar:
listBannerUrl?: string | null;

// Na div de imagem mudar de h-40 aspect para aspect-square quando listBannerUrl existe:
<div className={`relative bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900/30 dark:to-primary-800/30 ${event.listBannerUrl ? "aspect-square" : "h-40"}`}>
  {(event.listBannerUrl || event.bannerUrl) ? (
    <Image src={event.listBannerUrl ?? event.bannerUrl!} alt={event.title} fill className="object-cover" />
  ) : (
    <div className="absolute inset-0 flex items-center justify-center">
      <span className="text-4xl">🏃</span>
    </div>
  )}
</div>
```

- [ ] **Step 5: Aceitar `listBannerUrl` no schema de PATCH em `app/api/events/[id]/route.ts`**

```typescript
listBannerUrl: z.string().url().optional().nullable(),
```

- [ ] **Step 6: Adicionar campo de upload do banner de listagem no formulário de edição do organizador**

Localizar o componente de edição do evento e adicionar campo `listBannerUrl` junto ao campo `bannerUrl`, com label "Banner da Listagem (formato quadrado)".

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma lib/events.ts components/events/EventCard.tsx app/api/events/[id]/route.ts
git commit -m "feat: campo listBannerUrl para banner quadrado na listagem de eventos"
```

---

## Tarefa 3 — Redirecionamento para inscrição após login

**Lógica:** O link "Inscrever-se" deve apontar para `/auth/login?callbackUrl=/inscricao/[slug]` quando não logado. Após o login com `callbackUrl`, NextAuth já redireciona automaticamente. A página de inscrição já faz isso via `redirect` server-side. O que falta é o botão na página do evento apontar para login quando não autenticado.

**Files:**
- Modify: `app/(public)/eventos/[slug]/page.tsx`

- [ ] **Step 1: Buscar sessão na página do evento e passar para o botão de inscrição**

```tsx
// No topo do arquivo, importar:
import { auth } from "@/lib/auth";

// No corpo da função, adicionar:
const session = await auth();
const isLoggedIn = Boolean(session?.user);

// Substituir o Link de inscrição:
{canRegister && availableBatches.length > 0 ? (
  isLoggedIn ? (
    <Link href={`/inscricao/${event.slug}`} className="btn-primary w-full text-center block">
      Inscrever-se
    </Link>
  ) : (
    <Link
      href={`/auth/login?callbackUrl=/inscricao/${event.slug}`}
      className="btn-primary w-full text-center block"
    >
      Inscrever-se
    </Link>
  )
) : (
  <button disabled className="btn-primary w-full opacity-50 cursor-not-allowed">
    {event.status === "SOLD_OUT" ? "Esgotado" : "Inscrições fechadas"}
  </button>
)}
```

- [ ] **Step 2: Commit**

```bash
git add app/(public)/eventos/[slug]/page.tsx
git commit -m "feat: redirecionar para login com callbackUrl ao clicar em inscrever-se"
```

---

## Tarefa 4 — Disclaimer de responsabilidade no checkout

**Lógica:** Acima do bloco de aceite de termos, mostrar texto com nome dinâmico da plataforma. Buscar `appName` server-side e passar para `CheckoutForm`.

**Files:**
- Create: `components/events/EventDisclaimer.tsx`
- Modify: `components/checkout/CheckoutForm.tsx`
- Modify: `app/(public)/inscricao/[slug]/page.tsx`

- [ ] **Step 1: Criar `components/events/EventDisclaimer.tsx`**

```tsx
export default function EventDisclaimer({ appName }: { appName: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-300 space-y-2">
      <p>
        <strong>{appName}</strong> não é responsável pela organização e realização deste evento. Apenas gerenciamos o processo de inscrição online.
      </p>
      <p>
        Caso tenha dúvidas sobre o evento, pedido de reembolso, alteração cadastral ou outras informações, contate o organizador.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Adicionar `appName` às props de `CheckoutForm` e inserir `<EventDisclaimer>` antes do bloco de termos**

```tsx
// Adicionar à interface de props:
appName: string;

// Antes do card de termos (antes da div com id="terms"):
<EventDisclaimer appName={appName} />
```

- [ ] **Step 3: Passar `appName` em `app/(public)/inscricao/[slug]/page.tsx`**

```typescript
// Adicionar getAppName ao Promise.all:
const [athleteProfile, paymentMethods, defaultPlatformFee, serviceFee, appName] = await Promise.all([
  // ... existentes ...
  getAppName(),
]);

// Passar para CheckoutForm:
appName={appName}
```

- [ ] **Step 4: Commit**

```bash
git add components/events/EventDisclaimer.tsx components/checkout/CheckoutForm.tsx app/(public)/inscricao/[slug]/page.tsx
git commit -m "feat: disclaimer de responsabilidade acima dos termos no checkout"
```

---

## Tarefa 5 — Taxas exibidas abaixo de cada lote

**Lógica:** Na seção de "Lote de inscrição" do `CheckoutForm`, abaixo do preço de cada lote, mostrar em fonte menor as taxas calculadas para aquele lote.

**Files:**
- Modify: `components/checkout/CheckoutForm.tsx`

- [ ] **Step 1: Adicionar exibição das taxas em cada item de lote no `CheckoutForm`**

```tsx
// Dentro do map de batches, após o priceAmount:
<div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
  {(() => {
    const fee = calcPlatformFee(b.priceAmount, platformFeePercent, defaultPlatformFee);
    return (
      <>
        <span>+{formatCurrency(fee)} taxa da plataforma</span>
        {serviceFee > 0 && <span className="ml-2">+{formatCurrency(serviceFee)} taxa de serviço</span>}
      </>
    );
  })()}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add components/checkout/CheckoutForm.tsx
git commit -m "feat: exibir taxas abaixo do valor de cada lote no checkout"
```

---

## Tarefa 6 — Nome dinâmico nos termos e privacidade

**Lógica:** Páginas de termos e privacidade são server components, então buscamos `getAppName()` e substituímos todas as menções estáticas "Corridas App" pelo nome dinâmico.

**Files:**
- Modify: `app/(public)/privacidade/page.tsx`
- Modify: `app/(public)/termos/page.tsx`

- [ ] **Step 1: Modificar `app/(public)/privacidade/page.tsx`**

```tsx
import type { Metadata } from "next";
import { getAppName } from "@/lib/settings";

export const metadata: Metadata = { title: "Política de Privacidade" };
export const dynamic = "force-dynamic";

export default async function PrivacidadePage() {
  const appName = await getAppName();
  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold mb-2">Política de Privacidade</h1>
      {/* ... manter conteúdo igual mas substituir "Corridas App" por {appName} ... */}
    </main>
  );
}
```

- [ ] **Step 2: Modificar `app/(public)/termos/page.tsx`**

```tsx
import type { Metadata } from "next";
import { getAppName } from "@/lib/settings";

export const metadata: Metadata = { title: "Termos de Uso" };
export const dynamic = "force-dynamic";

export default async function TermosPage() {
  const appName = await getAppName();
  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold mb-2">Termos de Uso</h1>
      {/* ... manter conteúdo igual mas substituir "Corridas App" por {appName} ... */}
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/(public)/privacidade/page.tsx app/(public)/termos/page.tsx
git commit -m "feat: nome da plataforma dinâmico nos termos de uso e privacidade"
```

---

## Tarefa 7 — Informações do organizador na página do evento

**Lógica:** Abaixo de "Sobre o evento", mostrar bloco com nome, email e telefone do organizador. O email é do `User`, o telefone é do `OrganizerProfile`.

**Files:**
- Modify: `lib/events.ts`
- Create: `components/events/OrganizerInfo.tsx`
- Modify: `app/(public)/eventos/[slug]/page.tsx`

- [ ] **Step 1: Expandir `getEventBySlug` para incluir email e telefone do organizador**

```typescript
// Em getEventBySlug, no include de organizer:
organizer: {
  select: {
    companyName: true,
    website: true,
    bio: true,
    phone: true,
    user: { select: { name: true, email: true } },
  },
},
```

- [ ] **Step 2: Criar `components/events/OrganizerInfo.tsx`**

```tsx
interface OrganizerInfoProps {
  name: string;
  email: string;
  phone?: string | null;
  companyName?: string | null;
}

export default function OrganizerInfo({ name, email, phone, companyName }: OrganizerInfoProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">Organizador</h2>
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-1 text-sm">
        <p className="font-medium text-gray-900 dark:text-gray-100">{companyName ?? name}</p>
        {companyName && <p className="text-gray-500 dark:text-gray-400">{name}</p>}
        <p className="text-gray-600 dark:text-gray-400">✉️ {email}</p>
        {phone && <p className="text-gray-600 dark:text-gray-400">📞 {phone}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Inserir `<OrganizerInfo>` na página do evento, abaixo de "Sobre o evento"**

```tsx
import OrganizerInfo from "@/components/events/OrganizerInfo";

// Após o bloco de description:
<OrganizerInfo
  name={event.organizer.user.name}
  email={event.organizer.user.email}
  phone={event.organizer.phone}
  companyName={event.organizer.companyName}
/>
```

- [ ] **Step 4: Commit**

```bash
git add lib/events.ts components/events/OrganizerInfo.tsx app/(public)/eventos/[slug]/page.tsx
git commit -m "feat: exibir informações do organizador na página do evento"
```

---

## Tarefa 8 — Disclaimer abaixo do regulamento na página do evento

**Lógica:** Reutilizar `EventDisclaimer` (já criado na Tarefa 4). Buscar `appName` server-side na página do evento.

**Files:**
- Modify: `app/(public)/eventos/[slug]/page.tsx`

- [ ] **Step 1: Importar `getAppName` e `EventDisclaimer` na página do evento**

```tsx
import { getAppName } from "@/lib/settings";
import EventDisclaimer from "@/components/events/EventDisclaimer";

// No corpo da função, buscar appName:
const [event, appName] = await Promise.all([
  getEventBySlug(slug),
  getAppName(),
]);
```

- [ ] **Step 2: Inserir `<EventDisclaimer>` após o bloco do regulamento**

```tsx
// Após o bloco do regulamento:
<EventDisclaimer appName={appName} />
```

- [ ] **Step 3: Commit**

```bash
git add app/(public)/eventos/[slug]/page.tsx
git commit -m "feat: disclaimer de responsabilidade após regulamento na página do evento"
```

---

## Ordem de execução recomendada

Execute as tarefas na seguinte ordem, pois algumas dependem de outras:
1. Tarefa 2 (schema migration) — deve ser feita primeiro pois altera o banco
2. Tarefa 0 (carrossel)
3. Tarefa 1 (taxa de serviço)
4. Tarefa 4 (disclaimer checkout) — componente `EventDisclaimer` criado aqui
5. Tarefa 5 (taxas nos lotes) — depende da prop `serviceFee` da Tarefa 1
6. Tarefa 3 (redirecionamento login)
7. Tarefa 6 (termos dinâmicos)
8. Tarefa 7 (info organizador)
9. Tarefa 8 (disclaimer regulamento) — reutiliza componente da Tarefa 4
