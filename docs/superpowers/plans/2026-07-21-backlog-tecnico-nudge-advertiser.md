# Backlog técnico: helper de logout do nudge + helper de auth do anunciante — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver os 2 itens do backlog técnico aprovados na spec
`docs/superpowers/specs/2026-07-21-backlog-tecnico-nudge-advertiser-design.md`: consolidar a
limpeza da flag do modal de completar cadastro num helper único usado nos 6 pontos de logout do
app, e extrair um helper de auth compartilhado entre as 2 rotas de API do anunciante.

**Architecture:** Dois refactors independentes, puramente internos — nenhuma resposta HTTP nem
comportamento de UI muda. Item 1 consolida lógica client-side já duplicada (3 cópias corrigidas
numa sessão anterior + 3 pontos que nunca tinham o fix) numa função exportada. Item 2 segue o
padrão já estabelecido em `lib/auth/rbac.ts` (`checkApiPermission`/`checkAdminOnlyApiPermission`
— union discriminado `{allowed:true,...} | {allowed:false,response}`) para uma nova função
`checkAdvertiserApiPermission()`.

**Tech Stack:** Next.js (App Router), NextAuth (`next-auth/react` `signOut`), Prisma, Vitest,
TypeScript.

## Global Constraints

- Nenhuma mudança de comportamento visível: nenhuma resposta HTTP das 2 rotas de anunciante muda
  de status/corpo; nenhum fluxo de logout muda de destino (`callbackUrl: "/"` preservado em
  todos).
- Item 1 (componentes client) não ganha teste automatizado — sem infraestrutura de teste de
  componente React neste projeto (convenção já estabelecida, `ProfileCompletionNudge.tsx` em si
  não tem teste).
- Item 2 segue TDD e o padrão de teste já usado em `tests/rbac.test.ts` (mocka `@/lib/auth` via
  `vi.mock`, usa `db as any` de `@/lib/db`).
- Item 3 do backlog original (reaprovação de anúncio não rechecar status/prazo) fica
  explicitamente fora de escopo — decisão do usuário.

---

## Task 1: Helper `signOutAndClearNudge()` + wiring nos 6 pontos de logout

**Files:**
- Modify: `components/dashboard/ProfileCompletionNudge.tsx`
- Modify: `components/dashboard/DashboardNav.tsx`
- Modify: `components/layout/Header.tsx`
- Modify: `components/admin/AdminNav.tsx`
- Modify: `components/organizer/OrganizerNav.tsx`
- Modify: `components/advertiser/AdvertiserNav.tsx`

**Interfaces:**
- Produces: `export function signOutAndClearNudge(): void` em
  `components/dashboard/ProfileCompletionNudge.tsx` — usada pelos 5 outros arquivos deste task.

Sem teste automatizado (componentes client, sem infra de teste de componente neste projeto).

- [ ] **Step 1: Adicionar o helper em `ProfileCompletionNudge.tsx`**

Arquivo atual (`components/dashboard/ProfileCompletionNudge.tsx`) começa assim:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SuggestedAthleteField } from "@/lib/auth/profile-completion";

export const PROFILE_NUDGE_DISMISS_KEY = "profile-nudge-dismissed";
```

Trocar o import e adicionar a função logo após a constante:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import type { SuggestedAthleteField } from "@/lib/auth/profile-completion";

export const PROFILE_NUDGE_DISMISS_KEY = "profile-nudge-dismissed";

/** Limpa a flag de "modal já visto nesta sessão de login" e desloga — chamado por todo botão
 * "Sair" do app, pra garantir que uma nova sessão de login sempre reavalie o nudge. */
export function signOutAndClearNudge() {
  sessionStorage.removeItem(PROFILE_NUDGE_DISMISS_KEY);
  signOut({ callbackUrl: "/" });
}
```

- [ ] **Step 2: Atualizar `DashboardNav.tsx` pra usar o helper**

Trocar o import:

```tsx
import { PROFILE_NUDGE_DISMISS_KEY } from "@/components/dashboard/ProfileCompletionNudge";
```

por:

```tsx
import { signOutAndClearNudge } from "@/components/dashboard/ProfileCompletionNudge";
```

E trocar o botão de sair:

```tsx
<button
  onClick={() => {
    sessionStorage.removeItem(PROFILE_NUDGE_DISMISS_KEY);
    signOut({ callbackUrl: "/" });
  }}
  className="btn-secondary text-xs px-3 py-1"
>
  Sair
</button>
```

por:

```tsx
<button onClick={signOutAndClearNudge} className="btn-secondary text-xs px-3 py-1">
  Sair
</button>
```

O import de `signOut` de `"next-auth/react"` no topo do arquivo fica sem uso — remover essa linha
de import.

- [ ] **Step 3: Atualizar `Header.tsx` pra usar o helper nos 2 botões (desktop e mobile)**

Trocar o import:

```tsx
import { PROFILE_NUDGE_DISMISS_KEY } from "@/components/dashboard/ProfileCompletionNudge";
```

por:

```tsx
import { signOutAndClearNudge } from "@/components/dashboard/ProfileCompletionNudge";
```

Botão desktop — trocar:

```tsx
<button
  onClick={() => {
    sessionStorage.removeItem(PROFILE_NUDGE_DISMISS_KEY);
    signOut({ callbackUrl: "/" });
  }}
  className="btn-secondary text-sm px-3 py-1.5"
>
  Sair
</button>
```

por:

```tsx
<button onClick={signOutAndClearNudge} className="btn-secondary text-sm px-3 py-1.5">
  Sair
</button>
```

Botão mobile — trocar:

```tsx
<button onClick={() => {
  sessionStorage.removeItem(PROFILE_NUDGE_DISMISS_KEY);
  signOut({ callbackUrl: "/" });
}} className="block py-2 text-red-600 dark:text-red-400 w-full text-left">Sair</button>
```

por:

```tsx
<button onClick={signOutAndClearNudge} className="block py-2 text-red-600 dark:text-red-400 w-full text-left">Sair</button>
```

`signOut` continua sendo usado neste arquivo? Não — depois dessa troca, `signOut` importado de
`"next-auth/react"` no topo (`import { useSession, signOut } from "next-auth/react";`) fica sem
uso. Trocar essa linha pra `import { useSession } from "next-auth/react";`.

- [ ] **Step 4: Atualizar `AdminNav.tsx`**

Trocar o import:

```tsx
import { signOut } from "next-auth/react";
```

por:

```tsx
import { signOutAndClearNudge } from "@/components/dashboard/ProfileCompletionNudge";
```

E trocar:

```tsx
<button onClick={() => signOut({ callbackUrl: "/" })} className="text-sm text-gray-400 hover:text-white">
  Sair
</button>
```

por:

```tsx
<button onClick={signOutAndClearNudge} className="text-sm text-gray-400 hover:text-white">
  Sair
</button>
```

- [ ] **Step 5: Atualizar `OrganizerNav.tsx`**

Trocar o import:

```tsx
import { signOut } from "next-auth/react";
```

por:

```tsx
import { signOutAndClearNudge } from "@/components/dashboard/ProfileCompletionNudge";
```

E trocar:

```tsx
<button onClick={() => signOut({ callbackUrl: "/" })} className="btn-secondary text-xs px-3 py-1">
  Sair
</button>
```

por:

```tsx
<button onClick={signOutAndClearNudge} className="btn-secondary text-xs px-3 py-1">
  Sair
</button>
```

- [ ] **Step 6: Atualizar `AdvertiserNav.tsx`**

Trocar o import:

```tsx
import { signOut } from "next-auth/react";
```

por:

```tsx
import { signOutAndClearNudge } from "@/components/dashboard/ProfileCompletionNudge";
```

E trocar:

```tsx
<button onClick={() => signOut({ callbackUrl: "/" })} className="btn-secondary text-xs px-3 py-1">
  Sair
</button>
```

por:

```tsx
<button onClick={signOutAndClearNudge} className="btn-secondary text-xs px-3 py-1">
  Sair
</button>
```

- [ ] **Step 7: Verificar que nenhuma chamada direta a `signOut(` restou fora do helper**

Run: `grep -rn "signOut(" components/dashboard/DashboardNav.tsx components/layout/Header.tsx components/admin/AdminNav.tsx components/organizer/OrganizerNav.tsx components/advertiser/AdvertiserNav.tsx components/dashboard/ProfileCompletionNudge.tsx`

O padrão `signOut(` (com parêntese) não bate com `signOutAndClearNudge` (que não tem parêntese
logo depois de `signOut`), então só aparece onde `signOut` é de fato chamado como função.
Expected: a única ocorrência é dentro de `components/dashboard/ProfileCompletionNudge.tsx`, no
corpo de `signOutAndClearNudge` (`signOut({ callbackUrl: "/" })`). Os outros 5 arquivos não devem
aparecer no resultado — eles só chamam `signOutAndClearNudge` (sem parêntese logo após
`signOut`), nunca `signOut(...)` diretamente.

- [ ] **Step 8: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes continuam passando (nenhum teste cobre estes 6 arquivos — mudança
puramente de UI/wiring)

Run: `npx tsc --noEmit`
Expected: sem erros (confirma que nenhum import ficou órfão/quebrado)

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 9: Commit**

```bash
git add components/dashboard/ProfileCompletionNudge.tsx components/dashboard/DashboardNav.tsx components/layout/Header.tsx components/admin/AdminNav.tsx components/organizer/OrganizerNav.tsx components/advertiser/AdvertiserNav.tsx
git commit -m "refactor: consolidar limpeza da flag do nudge num helper signOutAndClearNudge()"
```

---

## Task 2: `checkAdvertiserApiPermission()` em `lib/auth/rbac.ts` + refactor das 2 rotas de anunciante

**Files:**
- Modify: `lib/auth/rbac.ts`
- Modify: `app/api/anunciante/ads/[id]/cancel/route.ts`
- Modify: `app/api/anunciante/profile/route.ts`
- Test: `tests/rbac.test.ts`

**Interfaces:**
- Consumes: `auth` (`@/lib/auth`), `db` (`@/lib/db`), `Session` (`next-auth`) — já importados em
  `rbac.ts`.
- Produces: `export type AdvertiserPermissionCheck = { allowed: true; session: Session;
  advertiser: AdvertiserProfile | null } | { allowed: false; response: NextResponse };` e
  `export async function checkAdvertiserApiPermission(): Promise<AdvertiserPermissionCheck>` —
  consumidos pelas 2 rotas deste task.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/rbac.test.ts`, adicionar o import de `checkAdvertiserApiPermission` ao bloco de import
já existente do topo do arquivo:

```ts
import {
  resolveActingScope,
  checkApiPermission,
  checkAdminOnlyApiPermission,
  checkAdvertiserApiPermission,
  requireAdmin,
  requireOrganizer,
  requirePermission,
} from "@/lib/auth/rbac";
```

Adicionar um novo `describe` logo depois do bloco `describe("checkAdminOnlyApiPermission", ...)`
(antes de `describe("requireAdmin", ...)`):

```ts
describe("checkAdvertiserApiPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão, sem consultar AdvertiserProfile", async () => {
    authMock.mockResolvedValue(null as any);
    const result = await checkAdvertiserApiPermission();
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(401);
    expect(dbMock.advertiserProfile.findUnique).not.toHaveBeenCalled();
  });

  it("retorna 403 quando o papel não é ADVERTISER, sem consultar AdvertiserProfile", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    const result = await checkAdvertiserApiPermission();
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(403);
    expect(dbMock.advertiserProfile.findUnique).not.toHaveBeenCalled();
  });

  it("ADVERTISER com perfil: allowed=true, advertiser preenchido", async () => {
    authMock.mockResolvedValue({ user: { id: "advertiser-user-1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    const result = await checkAdvertiserApiPermission();
    expect(dbMock.advertiserProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: "advertiser-user-1" },
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.advertiser).toEqual({ id: "advertiser-1" });
  });

  it("ADVERTISER sem perfil ainda: allowed=true, advertiser null (não decide 404 sozinho)", async () => {
    authMock.mockResolvedValue({ user: { id: "advertiser-user-1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce(null);
    const result = await checkAdvertiserApiPermission();
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.advertiser).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/rbac.test.ts`
Expected: FAIL — `checkAdvertiserApiPermission is not a function` (ou erro de import).

- [ ] **Step 3: Implementar em `lib/auth/rbac.ts`**

Adicionar o import de tipo `AdvertiserProfile` à primeira linha do arquivo:

```ts
import type { UserRole, AdvertiserProfile } from "@prisma/client";
```

Adicionar a nova função logo depois do bloco `checkAdminOnlyApiPermission` (antes de
`export async function requireAdmin()`):

```ts
export type AdvertiserPermissionCheck =
  | { allowed: true; session: Session; advertiser: AdvertiserProfile | null }
  | { allowed: false; response: NextResponse };

/** Checagem de auth pras rotas de API do anunciante — mesmo formato de checkApiPermission, mas
 * também resolve o AdvertiserProfile (evita cada rota repetir a mesma query). Nunca decide 404
 * sozinho por perfil ausente: advertiser pode vir null, e cada rota decide o que fazer (algumas
 * tratam ausência como 404, outras como estado válido — ex. perfil ainda não criado). */
export async function checkAdvertiserApiPermission(): Promise<AdvertiserPermissionCheck> {
  const session = await auth();
  if (!session?.user) {
    return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }
  if (session.user.role !== "ADVERTISER") {
    return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 403 }) };
  }
  const advertiser = await db.advertiserProfile.findUnique({ where: { userId: session.user.id } });
  return { allowed: true, session, advertiser };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/rbac.test.ts`
Expected: PASS (todos os testes do arquivo, incluindo os 4 novos)

- [ ] **Step 5: Refatorar `app/api/anunciante/ads/[id]/cancel/route.ts`**

Arquivo atual:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ACTIVE_STATUSES } from "@/lib/ads/private-ads";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  if (session.user.role !== "ADVERTISER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const advertiser = await db.advertiserProfile.findUnique({ where: { userId: session.user.id } });
  if (!advertiser) {
    return NextResponse.json({ error: "Perfil de anunciante não encontrado" }, { status: 404 });
  }

  const { id } = await params;
  const ad = await db.privateAd.findFirst({
    where: { id, adPurchase: { advertiserId: advertiser.id } },
    select: { id: true, status: true },
  });
  if (!ad) {
    return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });
  }

  if (!ACTIVE_STATUSES.includes(ad.status)) {
    return NextResponse.json({ error: "Este anúncio não pode mais ser cancelado" }, { status: 409 });
  }

  await db.privateAd.update({ where: { id }, data: { status: "CANCELLED" } });

  return NextResponse.json({ ok: true });
}
```

Substituir pelo conteúdo completo:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdvertiserApiPermission } from "@/lib/auth/rbac";
import { ACTIVE_STATUSES } from "@/lib/ads/private-ads";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdvertiserApiPermission();
  if (!check.allowed) return check.response;
  if (!check.advertiser) {
    return NextResponse.json({ error: "Perfil de anunciante não encontrado" }, { status: 404 });
  }

  const { id } = await params;
  const ad = await db.privateAd.findFirst({
    where: { id, adPurchase: { advertiserId: check.advertiser.id } },
    select: { id: true, status: true },
  });
  if (!ad) {
    return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });
  }

  if (!ACTIVE_STATUSES.includes(ad.status)) {
    return NextResponse.json({ error: "Este anúncio não pode mais ser cancelado" }, { status: 409 });
  }

  await db.privateAd.update({ where: { id }, data: { status: "CANCELLED" } });

  return NextResponse.json({ ok: true });
}
```

Note que `import { auth } from "@/lib/auth"` some (não é mais usado diretamente nesta rota).

- [ ] **Step 6: Refatorar `app/api/anunciante/profile/route.ts`**

Arquivo atual:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const profileSchema = z.object({
  companyName: z.string().min(1, "Informe a razão social"),
  contactEmail: z.string().email("E-mail inválido"),
  contactPhone: z.string().min(8, "Telefone inválido"),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (session.user.role !== "ADVERTISER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const profile = await db.advertiserProfile.findUnique({
    where: { userId: session.user.id },
  });

  return NextResponse.json({ profile });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (session.user.role !== "ADVERTISER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const profile = await db.advertiserProfile.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...parsed.data },
    update: parsed.data,
  });

  return NextResponse.json({ profile });
}
```

Substituir pelo conteúdo completo:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkAdvertiserApiPermission } from "@/lib/auth/rbac";
import { z } from "zod";

const profileSchema = z.object({
  companyName: z.string().min(1, "Informe a razão social"),
  contactEmail: z.string().email("E-mail inválido"),
  contactPhone: z.string().min(8, "Telefone inválido"),
});

export async function GET() {
  const check = await checkAdvertiserApiPermission();
  if (!check.allowed) return check.response;

  return NextResponse.json({ profile: check.advertiser });
}

export async function PUT(req: NextRequest) {
  const check = await checkAdvertiserApiPermission();
  if (!check.allowed) return check.response;

  const body = await req.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const profile = await db.advertiserProfile.upsert({
    where: { userId: check.session.user.id },
    create: { userId: check.session.user.id, ...parsed.data },
    update: parsed.data,
  });

  return NextResponse.json({ profile });
}
```

Note que `import { auth } from "@/lib/auth"` some (não é mais usado diretamente nesta rota), e a
query `db.advertiserProfile.findUnique` do `GET` some (o helper já resolveu isso).

- [ ] **Step 7: Rodar os testes das 2 rotas refatoradas e confirmar que continuam passando**

Run: `npx vitest run tests/advertiser-ads-cancel-route.test.ts tests/advertiser-profile-route.test.ts`
Expected: PASS, mesma contagem de testes de antes (7 + 8) — esses testes mockam `@/lib/auth` e
`db.advertiserProfile.*` diretamente, não a função `checkAdvertiserApiPermission`, então
continuam validando o comportamento observável de fora sem precisar de nenhuma mudança.

- [ ] **Step 8: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 9: Commit**

```bash
git add lib/auth/rbac.ts app/api/anunciante/ads/\[id\]/cancel/route.ts app/api/anunciante/profile/route.ts tests/rbac.test.ts
git commit -m "refactor: extrair checkAdvertiserApiPermission() compartilhado entre as rotas de anunciante"
```

---

## Revisão final (depois das 2 tasks)

- [ ] Rodar `npx vitest run` inteiro — suíte completa passando.
- [ ] Rodar `npx tsc --noEmit` — sem erros.
- [ ] Rodar `npm run build` — build de produção limpo.
- [ ] Confirmar por leitura (grep) que nenhum dos 6 pontos de logout do app chama `signOut(...)`
  diretamente mais — todos passam por `signOutAndClearNudge()`.
- [ ] Confirmar que as 2 rotas de anunciante não têm mais nenhuma checagem de auth/role inline —
  ambas delegam 100% pra `checkAdvertiserApiPermission()`.
