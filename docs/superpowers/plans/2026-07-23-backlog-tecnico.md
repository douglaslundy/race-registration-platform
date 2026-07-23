# Backlog técnico (4 itens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver 4 itens de backlog técnico de baixo risco, registrados em revisões anteriores e
nunca corrigidos: (1) posições Google/House aparecendo por engano como disponíveis pro anunciante
no marketplace, (2) 2 pares de mapas de status/cor duplicados entre páginas do mesmo domínio, (3)
`PageViewLogger` usando `fetch` bloqueante em vez de `sendBeacon`, (4) gráficos `recharts` sem
lazy-load, inflando o bundle inicial dos 2 dashboards.

**Architecture:** 5 tasks independentes, sem sobreposição de arquivos entre elas. Nenhuma mudança
de schema.

**Tech Stack:** Next.js (App Router), Prisma, Vitest.

## Global Constraints

- Nenhuma mudança de comportamento visível além do que cada item pede especificamente — são
  correções de tech debt, não features novas.
- TDD nas mudanças de `lib/`.
- Componentes/páginas sem teste automatizado — convenção já estabelecida no projeto.

---

### Task 1: `listAvailableSlotsForAdvertiser` filtra por `source`/`enabled`

**Contexto:** a função que lista posições disponíveis pro anunciante comprar/usar no marketplace
só filtra por não ter `PrivateAd` `APPROVED` ativo — não filtra `source` (deveria ser só
`"PRIVATE"`, nunca `"GOOGLE"`/`"HOUSE"`) nem `enabled` (posição desativada não deveria ser
oferecida). Confirmado: só 2 call sites (`app/api/anunciante/ads/route.ts`,
`app/anunciante/anuncios/novo/page.tsx`), ambos só consomem o resultado, sem lógica própria de
filtro — o fix é isolado nesta função.

**Files:**
- Modify: `lib/ads/private-ads.ts`
- Test: `tests/lib-private-ads.test.ts`

**Interfaces:** Nenhuma nova — mesma assinatura, `where` mais restritivo.

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/lib-private-ads.test.ts`, trocar a asserção do teste existente
"retorna só posições sem PrivateAd APPROVED ativo":

```ts
    expect(dbMock.adSlot.findMany).toHaveBeenCalledWith({
      where: { privateAds: { none: { status: "APPROVED" } } },
      orderBy: { key: "asc" },
    });
```

por:

```ts
    expect(dbMock.adSlot.findMany).toHaveBeenCalledWith({
      where: { privateAds: { none: { status: "APPROVED" } }, source: "PRIVATE", enabled: true },
      orderBy: { key: "asc" },
    });
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/lib-private-ads.test.ts`
Expected: FAIL — o `where` atual não inclui `source`/`enabled`.

- [ ] **Step 3: Corrigir `listAvailableSlotsForAdvertiser`**

Em `lib/ads/private-ads.ts`, trocar:

```ts
export async function listAvailableSlotsForAdvertiser() {
  return db.adSlot.findMany({
    where: { privateAds: { none: { status: "APPROVED" } } },
    orderBy: { key: "asc" },
  });
}
```

por:

```ts
export async function listAvailableSlotsForAdvertiser() {
  return db.adSlot.findMany({
    where: { privateAds: { none: { status: "APPROVED" } }, source: "PRIVATE", enabled: true },
    orderBy: { key: "asc" },
  });
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/lib-private-ads.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add lib/ads/private-ads.ts tests/lib-private-ads.test.ts
git commit -m "fix: marketplace de anunciantes so oferece posicoes com source PRIVATE e habilitadas"
```

---

### Task 2: Unificar mapa de status do `PrivateAd` (fonte única, corrige gap de `CANCELLED`)

**Contexto:** `app/anunciante/anuncios/page.tsx` tem `STATUS` (5 entradas, `{label, cls}`, inclui
`CANCELLED`) e `app/admin/anuncios/privados/[id]/page.tsx` tem `STATUS_LABEL`/`STATUS_COLOR`
separados (4 entradas, sem `CANCELLED` — bug real: um `PrivateAd` cancelado aparece com badge
vazio "" e o texto cru "CANCELLED" na tela do admin, em vez de um badge cinza "Cancelado"). Ambos
já importam `BADGE` de `lib/badge-colors.ts`.

**Files:**
- Create: `lib/private-ad-status.ts`
- Modify: `app/anunciante/anuncios/page.tsx`
- Modify: `app/admin/anuncios/privados/[id]/page.tsx`

**Interfaces:**
- Produces: `PRIVATE_AD_STATUS: Record<string, { label: string; color: string }>` — consumido
  pelas 2 páginas.

Sem teste automatizado (Server Components, convenção do projeto) — a correção do gap de
`CANCELLED` é conferida por leitura de código, não por teste.

- [ ] **Step 1: Criar `lib/private-ad-status.ts`**

```ts
import { BADGE } from "@/lib/badge-colors";

export const PRIVATE_AD_STATUS: Record<string, { label: string; color: string }> = {
  PENDING_APPROVAL: { label: "Aguardando aprovação", color: BADGE.yellow },
  APPROVED: { label: "Aprovado", color: BADGE.green },
  REJECTED: { label: "Rejeitado", color: BADGE.red },
  EXPIRED: { label: "Expirado", color: BADGE.gray },
  CANCELLED: { label: "Cancelado", color: BADGE.gray },
};
```

- [ ] **Step 2: Atualizar `app/anunciante/anuncios/page.tsx`**

Trocar o import de `BADGE`:

```ts
import { BADGE } from "@/lib/badge-colors";
```

por:

```ts
import { PRIVATE_AD_STATUS } from "@/lib/private-ad-status";
```

Remover o const local:

```ts
const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING_APPROVAL: { label: "Aguardando aprovação", cls: BADGE.yellow },
  APPROVED: { label: "Aprovado", cls: BADGE.green },
  REJECTED: { label: "Rejeitado", cls: BADGE.red },
  EXPIRED: { label: "Expirado", cls: BADGE.gray },
  CANCELLED: { label: "Cancelado", cls: BADGE.gray },
};
```

Trocar a linha que monta o status de cada anúncio:

```ts
            const status = STATUS[ad.status] ?? { label: ad.status, cls: BADGE.gray };
```

por:

```ts
            const status = PRIVATE_AD_STATUS[ad.status] ?? { label: ad.status, color: BADGE.gray };
```

E trocar o uso de `status.cls` no JSX (mesma linha do badge):

```tsx
                <span className={`text-xs px-2 py-1 rounded font-medium ${status.cls}`}>{status.label}</span>
```

por:

```tsx
                <span className={`text-xs px-2 py-1 rounded font-medium ${status.color}`}>{status.label}</span>
```

(Confirme se `BADGE` ainda é usado em algum outro ponto do arquivo antes de remover o import —
se não for, remova; se for, mantenha os dois imports.)

- [ ] **Step 3: Atualizar `app/admin/anuncios/privados/[id]/page.tsx`**

Trocar o import de `BADGE`:

```ts
import { BADGE } from "@/lib/badge-colors";
```

por:

```ts
import { PRIVATE_AD_STATUS } from "@/lib/private-ad-status";
```

Remover os 2 consts locais:

```ts
const STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: "Aguardando aprovação",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  EXPIRED: "Expirado",
};

const STATUS_COLOR: Record<string, string> = {
  PENDING_APPROVAL: BADGE.yellow,
  APPROVED: BADGE.green,
  REJECTED: BADGE.red,
  EXPIRED: BADGE.gray,
};
```

Trocar o uso no JSX:

```tsx
        <span className={`text-sm px-3 py-1 rounded-full font-medium ${STATUS_COLOR[existing.status] ?? ""}`}>
          {STATUS_LABEL[existing.status] ?? existing.status}
```

por:

```tsx
        <span className={`text-sm px-3 py-1 rounded-full font-medium ${PRIVATE_AD_STATUS[existing.status]?.color ?? BADGE.gray}`}>
          {PRIVATE_AD_STATUS[existing.status]?.label ?? existing.status}
```

(Igual à Task anterior: confirme se `BADGE` ainda é usado em outro ponto do arquivo antes de
remover o import — aqui provavelmente ainda é, por causa do `?? BADGE.gray` acima, então mantenha
os dois imports.)

- [ ] **Step 4: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam (nenhum teste cobre estas 2 páginas)

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 5: Commit**

```bash
git add lib/private-ad-status.ts "app/anunciante/anuncios/page.tsx" "app/admin/anuncios/privados/[id]/page.tsx"
git commit -m "fix: unificar mapa de status do PrivateAd, corrige badge vazio pra CANCELLED no admin"
```

---

### Task 3: Reaproveitar `lib/registration-status.ts` nos 2 filtros de "Inscritos"

**Contexto:** `app/organizador/eventos/[id]/inscritos/page.tsx` e
`app/admin/eventos/[id]/inscritos/page.tsx` cada um redefine localmente um `REGISTRATION_STATUS`
com as mesmas 6 entradas já existentes em `lib/registration-status.ts` (usado por outros
arquivos), mais 2 entradas extras (`REFUNDED`, `REFUND_PENDING`) que são **valores sintéticos de
filtro** (não são valores reais do enum `RegistrationStatus` do Prisma — são tratados
especialmente em `lib/organizer/registrations.ts::buildRegistrationWhere`, que os traduz num
filtro por status do `Payment` relacionado). Por isso o fix correto **não é** simplesmente
importar o mapa compartilhado no lugar do local — é reaproveitar as 6 entradas reais dele e
manter as 2 sintéticas como um acréscimo local, com nome que deixe claro que são opções de filtro,
não status reais.

**Files:**
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx`
- Modify: `app/admin/eventos/[id]/inscritos/page.tsx`

**Interfaces:** Nenhuma nova — reaproveita `REGISTRATION_STATUS` já exportado por
`lib/registration-status.ts`.

Sem teste automatizado (Server Components, convenção do projeto).

- [ ] **Step 1: Atualizar `app/organizador/eventos/[id]/inscritos/page.tsx`**

Confirme se o arquivo já importa `BADGE` de `@/lib/badge-colors` — se sim, adicionar o import
novo ao lado; se o `BADGE` só era usado dentro do `REGISTRATION_STATUS` que vai ser removido,
trocar o import por completo. Adicionar:

```ts
import { REGISTRATION_STATUS } from "@/lib/registration-status";
```

Trocar o const local:

```ts
const REGISTRATION_STATUS: Record<string, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: BADGE.yellow },
  CONFIRMED:       { label: "Confirmada", color: BADGE.green },
  CANCELLED:       { label: "Cancelada", color: BADGE.red },
  TRANSFERRED:     { label: "Transferida", color: BADGE.blue },
  WAITLISTED:      { label: "Lista de espera", color: BADGE.gray },
  CANCELLATION_REQUESTED: { label: "Cancelamento solicitado", color: BADGE.orange },
  REFUNDED:        { label: "Estornado", color: BADGE.purple },
  REFUND_PENDING:  { label: "Cancelado — reembolso pendente", color: BADGE.orange },
};
```

por (nome novo, deixa claro que são opções de filtro — inclui os valores sintéticos junto com os
reais reaproveitados):

```ts
const FILTER_STATUS_OPTIONS: Record<string, { label: string; color: string }> = {
  ...REGISTRATION_STATUS,
  REFUNDED:       { label: "Estornado", color: BADGE.purple },
  REFUND_PENDING: { label: "Cancelado — reembolso pendente", color: BADGE.orange },
};
```

Trocar o único uso (dropdown de filtro):

```tsx
            {Object.entries(REGISTRATION_STATUS).map(([value, info]) => (
```

por:

```tsx
            {Object.entries(FILTER_STATUS_OPTIONS).map(([value, info]) => (
```

- [ ] **Step 2: Atualizar `app/admin/eventos/[id]/inscritos/page.tsx`**

Mesma mudança, mesmo padrão — confirme se `BADGE` já está importado (é, pra `REFUNDED`/
`REFUND_PENDING`), adicionar:

```ts
import { REGISTRATION_STATUS } from "@/lib/registration-status";
```

Trocar o const local:

```ts
const REGISTRATION_STATUS: Record<string, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: BADGE.yellow },
  CONFIRMED: { label: "Confirmada", color: BADGE.green },
  CANCELLED: { label: "Cancelada", color: BADGE.red },
  TRANSFERRED: { label: "Transferida", color: BADGE.blue },
  WAITLISTED: { label: "Lista de espera", color: BADGE.gray },
  CANCELLATION_REQUESTED: { label: "Cancelamento solicitado", color: BADGE.orange },
  REFUNDED: { label: "Estornado", color: BADGE.purple },
  REFUND_PENDING: { label: "Cancelado — reembolso pendente", color: BADGE.orange },
};
```

por:

```ts
const FILTER_STATUS_OPTIONS: Record<string, { label: string; color: string }> = {
  ...REGISTRATION_STATUS,
  REFUNDED: { label: "Estornado", color: BADGE.purple },
  REFUND_PENDING: { label: "Cancelado — reembolso pendente", color: BADGE.orange },
};
```

Trocar o único uso (dropdown de filtro):

```tsx
            {Object.entries(REGISTRATION_STATUS).map(([value, info]) => (
```

por:

```tsx
            {Object.entries(FILTER_STATUS_OPTIONS).map(([value, info]) => (
```

- [ ] **Step 3: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 4: Commit**

```bash
git add "app/organizador/eventos/[id]/inscritos/page.tsx" "app/admin/eventos/[id]/inscritos/page.tsx"
git commit -m "fix: filtro de status de inscritos reaproveita lib/registration-status.ts"
```

---

### Task 4: `PageViewLogger` usa `sendBeacon` em vez de `fetch`

**Contexto:** o log de auditoria de navegação usa `fetch` fire-and-forget. `navigator.sendBeacon`
é a API do browser feita exatamente pra esse caso (log best-effort que não deve bloquear nem ser
cancelado por navegação rápida/fechamento de aba) — mais leve que segurar uma conexão `fetch`
aberta a cada troca de rota. Mesma origem, então cookies de sessão são enviados normalmente (a
rota `/api/audit/pageview` autentica via cookie).

**Files:**
- Modify: `components/audit/PageViewLogger.tsx`

**Interfaces:** Nenhuma — mesmo endpoint, mesmo payload.

Sem teste automatizado (componente client, convenção do projeto).

- [ ] **Step 1: Implementar**

Substituir o conteúdo inteiro de `components/audit/PageViewLogger.tsx` por:

```tsx
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function PageViewLogger() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    const body = JSON.stringify({ path: pathname });

    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      const sent = navigator.sendBeacon("/api/audit/pageview", blob);
      if (sent) return;
    }

    // Fallback pra navegadores sem sendBeacon (raro) ou se o envio foi recusado.
    fetch("/api/audit/pageview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => {
      // Registro de auditoria é best-effort; falha de rede não deve afetar a navegação.
    });
  }, [pathname]);

  return null;
}
```

- [ ] **Step 2: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 3: Commit**

```bash
git add components/audit/PageViewLogger.tsx
git commit -m "perf: PageViewLogger usa sendBeacon em vez de fetch bloqueante"
```

---

### Task 5: `recharts` carregado sob demanda (`next/dynamic`, `ssr: false`) nos 2 dashboards

**Contexto:** `LineChart.tsx`/`MultiLineChart.tsx` (client components) são importados
estaticamente por 2 Server Components (`app/organizador/page.tsx`, `app/admin/page.tsx`),
colocando `recharts` inteiro no bundle JS inicial dessas 2 páginas de dashboard. `next/dynamic`
com `ssr: false` não é permitido direto dentro de um Server Component — o padrão correto é um
wrapper client component que faz o `dynamic(...)` por dentro, e o Server Component importa o
wrapper normalmente (sem `dynamic()` nele mesmo).

**Files:**
- Create: `components/ui/LineChartLazy.tsx`
- Create: `components/ui/MultiLineChartLazy.tsx`
- Modify: `app/organizador/page.tsx`
- Modify: `app/admin/page.tsx`

**Interfaces:**
- Produces: `LineChartLazy` (mesmos props de `LineChart`), `MultiLineChartLazy` (mesmos props de
  `MultiLineChart`) — export default, consumidos pelos 2 dashboards no lugar dos originais.

Sem teste automatizado (componentes client, convenção do projeto) — confirmar visualmente (ou por
leitura do output de `npm run build`) que o bundle das 2 páginas não inclui mais `recharts`
diretamente.

- [ ] **Step 1: Criar `components/ui/LineChartLazy.tsx`**

```tsx
"use client";

import dynamic from "next/dynamic";

const LineChartLazy = dynamic(() => import("./LineChart"), {
  ssr: false,
  loading: () => <div style={{ height: 260 }} />,
});

export default LineChartLazy;
```

- [ ] **Step 2: Criar `components/ui/MultiLineChartLazy.tsx`**

```tsx
"use client";

import dynamic from "next/dynamic";

const MultiLineChartLazy = dynamic(() => import("./MultiLineChart"), {
  ssr: false,
  loading: () => <div style={{ height: 260 }} />,
});

export default MultiLineChartLazy;
```

- [ ] **Step 3: Atualizar os imports em `app/organizador/page.tsx`**

Trocar:

```ts
import LineChart from "@/components/ui/LineChart";
import MultiLineChart from "@/components/ui/MultiLineChart";
```

por:

```ts
import LineChart from "@/components/ui/LineChartLazy";
import MultiLineChart from "@/components/ui/MultiLineChartLazy";
```

(Só a linha do import muda — os 3 usos de `<LineChart .../>`/`<MultiLineChart .../>` no JSX
continuam exatamente iguais, mesmo nome local, mesmos props.)

- [ ] **Step 4: Atualizar os imports em `app/admin/page.tsx`**

Mesma troca:

```ts
import LineChart from "@/components/ui/LineChart";
import MultiLineChart from "@/components/ui/MultiLineChart";
```

por:

```ts
import LineChart from "@/components/ui/LineChartLazy";
import MultiLineChart from "@/components/ui/MultiLineChartLazy";
```

- [ ] **Step 5: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo — conferir no output que `recharts` não aparece mais listado
direto no First Load JS de `/organizador` nem `/admin` (só aparece num chunk separado, carregado
sob demanda).

- [ ] **Step 6: Commit**

```bash
git add components/ui/LineChartLazy.tsx components/ui/MultiLineChartLazy.tsx app/organizador/page.tsx app/admin/page.tsx
git commit -m "perf: recharts carregado sob demanda nos dashboards do organizador e admin"
```

---

## Revisão final (depois de todas as 5 tasks)

- [ ] Rodar `npx vitest run` inteiro — suíte completa passando.
- [ ] Rodar `npx tsc --noEmit` — sem erros.
- [ ] Rodar `npm run build` — build de produção limpo, conferir a redução do First Load JS de
  `/organizador` e `/admin` no output do build.
- [ ] Conferir manualmente (leitura de código) que os 2 filtros de "Inscritos" (Task 3) ainda
  aceitam `REFUNDED`/`REFUND_PENDING` como valores de busca válidos — `buildRegistrationWhere`
  não foi tocado, só a UI do dropdown.
