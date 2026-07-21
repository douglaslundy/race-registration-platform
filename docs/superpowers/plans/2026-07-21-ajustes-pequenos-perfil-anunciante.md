# Ajustes pequenos: modal de completar cadastro, telas do anunciante, CHECK constraint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar os 4 itens pequenos aprovados na spec `docs/superpowers/specs/2026-07-21-ajustes-pequenos-perfil-anunciante-design.md`: modal opcional de completar cadastro do atleta, as duas páginas do anunciante hoje com link morto (`/anunciante/anuncios` + cancelamento, `/anunciante/perfil`), e uma `CHECK` constraint de integridade em `Payment`.

**Architecture:** Cada item é independente e usa exclusivamente padrões já existentes no
código (nenhuma biblioteca nova): rotas API com `auth()` + Zod, páginas server component com
`requireAuth()`, modais compartilhados `ConfirmModal`/`ErrorModal` (nunca dialogs nativos),
Prisma via `db` singleton.

**Tech Stack:** Next.js (App Router), Prisma, Zod, Vitest, TypeScript.

## Global Constraints

- Nunca usar `alert()`/`confirm()`/`prompt()` nativos — sempre `components/ui/ConfirmModal.tsx` /
  `components/ui/ErrorModal.tsx` (regra do `CLAUDE.md`).
- TDD em toda rota de API e função de `lib/`: teste falha primeiro, depois implementação mínima.
- Este projeto **não tem infraestrutura de teste de componente React** (sem RTL/testing-library
  configurado) — componentes client-side novos não ganham teste automatizado, só a lógica em
  `lib/` e as rotas de API. Siga essa convenção existente, não introduza uma ferramenta de teste
  nova.
- Todo texto de UI em português brasileiro.
- Rotas de API seguem o padrão de resolução de posse já usado em `POST /api/anunciante/ads`:
  nunca vazar existência de recurso de outro usuário (respostas 404/400 genéricas).
- Deploy roda `prisma db push --skip-generate`, que **não executa** arquivos `migration.sql` —
  qualquer mudança de schema via SQL puro (Task 6) precisa de aplicação manual documentada.

---

## Task 1: `getSuggestedAthleteProfileFields` (lib)

**Files:**
- Modify: `lib/auth/profile-completion.ts`
- Test: `tests/profile-completion.test.ts`

**Interfaces:**
- Produces: `export type SuggestedAthleteField = "gender" | "preferredShirtSize" | "city" | "state";`
  e `export async function getSuggestedAthleteProfileFields(userId: string): Promise<SuggestedAthleteField[]>`
  — usados pelo componente da Task 2.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `tests/profile-completion.test.ts` (mesmo arquivo, novo `describe`):

```ts
describe("getSuggestedAthleteProfileFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna lista vazia quando gender, preferredShirtSize, city e state estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      gender: "M",
      preferredShirtSize: "M",
      city: "São Paulo",
      state: "SP",
    });

    const suggested = await getSuggestedAthleteProfileFields("user-1");

    expect(suggested).toEqual([]);
  });

  it("retorna os 4 campos quando não há perfil nenhum", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce(null);

    const suggested = await getSuggestedAthleteProfileFields("user-1");

    expect(suggested).toEqual(["gender", "preferredShirtSize", "city", "state"]);
  });

  it("retorna só os campos vazios quando o perfil está parcialmente preenchido", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      gender: "F",
      preferredShirtSize: null,
      city: null,
      state: "RJ",
    });

    const suggested = await getSuggestedAthleteProfileFields("user-1");

    expect(suggested).toEqual(["preferredShirtSize", "city"]);
  });
});
```

Também adicionar o import no topo do arquivo (junto ao import já existente de
`getMissingAthleteProfileFields`):

```ts
import { getMissingAthleteProfileFields, getSuggestedAthleteProfileFields } from "@/lib/auth/profile-completion";
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/profile-completion.test.ts`
Expected: FAIL — `getSuggestedAthleteProfileFields is not a function` (ou erro de import).

- [ ] **Step 3: Implementar**

Em `lib/auth/profile-completion.ts`, adicionar depois de `getMissingAthleteProfileFields`:

```ts
export type SuggestedAthleteField = "gender" | "preferredShirtSize" | "city" | "state";

export async function getSuggestedAthleteProfileFields(userId: string): Promise<SuggestedAthleteField[]> {
  const profile = await db.athleteProfile.findUnique({
    where: { userId },
    select: { gender: true, preferredShirtSize: true, city: true, state: true },
  });

  const suggested: SuggestedAthleteField[] = [];
  if (!profile?.gender) suggested.push("gender");
  if (!profile?.preferredShirtSize) suggested.push("preferredShirtSize");
  if (!profile?.city) suggested.push("city");
  if (!profile?.state) suggested.push("state");
  return suggested;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/profile-completion.test.ts`
Expected: PASS (8 testes: 5 já existentes + 3 novos)

- [ ] **Step 5: Type-check e commit**

Run: `npx tsc --noEmit`
Expected: sem erros

```bash
git add lib/auth/profile-completion.ts tests/profile-completion.test.ts
git commit -m "feat: getSuggestedAthleteProfileFields para o modal opcional de completar perfil"
```

---

## Task 2: Modal "complete seu cadastro" (dispensável)

**Files:**
- Create: `components/dashboard/ProfileCompletionNudge.tsx`
- Modify: `app/dashboard/layout.tsx`
- Modify: `components/dashboard/DashboardNav.tsx`

**Interfaces:**
- Consumes: `SuggestedAthleteField`, `getSuggestedAthleteProfileFields` (Task 1).
- Produces: `export const PROFILE_NUDGE_DISMISS_KEY = "profile-nudge-dismissed";` e
  `export default function ProfileCompletionNudge({ suggestedFields }: { suggestedFields:
  SuggestedAthleteField[] })` — usados só dentro deste task (layout + nav).

Sem teste automatizado neste task (componente client-side, ver Global Constraints).

- [ ] **Step 1: Criar o componente do modal**

Criar `components/dashboard/ProfileCompletionNudge.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SuggestedAthleteField } from "@/lib/auth/profile-completion";

export const PROFILE_NUDGE_DISMISS_KEY = "profile-nudge-dismissed";

const FIELD_LABELS: Record<SuggestedAthleteField, string> = {
  gender: "Gênero",
  preferredShirtSize: "Tamanho de camiseta",
  city: "Cidade/Estado",
  state: "Cidade/Estado",
};

function buildSuggestionLabel(fields: SuggestedAthleteField[]): string {
  const labels: string[] = [];
  if (fields.includes("gender")) labels.push(FIELD_LABELS.gender);
  if (fields.includes("preferredShirtSize")) labels.push(FIELD_LABELS.preferredShirtSize);
  if (fields.includes("city") || fields.includes("state")) labels.push("Cidade/Estado");
  return labels.join(", ");
}

export default function ProfileCompletionNudge({
  suggestedFields,
}: {
  suggestedFields: SuggestedAthleteField[];
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(PROFILE_NUDGE_DISMISS_KEY) === "1") return;
    setOpen(true);
  }, []);

  function dismiss() {
    sessionStorage.setItem(PROFILE_NUDGE_DISMISS_KEY, "1");
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Complete seu cadastro</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Faltam alguns dados no seu perfil: {buildSuggestionLabel(suggestedFields)}.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Agora não
          </button>
          <Link href="/dashboard/perfil" onClick={dismiss} className="btn-primary text-sm">
            Completar agora
          </Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rodar `tsc` (ainda sem uso, só checando o arquivo novo)**

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 3: Commit do componente**

```bash
git add components/dashboard/ProfileCompletionNudge.tsx
git commit -m "feat: componente do modal opcional de completar cadastro"
```

- [ ] **Step 4: Ler o arquivo atual do layout antes de editar**

`app/dashboard/layout.tsx` hoje é:

```tsx
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { getAppName } from "@/lib/settings";
import { getMissingAthleteProfileFields } from "@/lib/auth/profile-completion";
import DashboardNav from "@/components/dashboard/DashboardNav";
import PageViewLogger from "@/components/audit/PageViewLogger";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, appName] = await Promise.all([requireAuth(), getAppName()]);

  if (session.user.role === "ATHLETE") {
    const missing = await getMissingAthleteProfileFields(session.user.id);
    if (missing.length > 0) redirect("/completar-cadastro");
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <PageViewLogger />
      <DashboardNav userName={session.user.name} userRole={session.user.role} appName={appName} />
      <div className="max-w-5xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
```

- [ ] **Step 5: Editar o layout pra buscar e renderizar o modal**

Substituir o conteúdo inteiro de `app/dashboard/layout.tsx` por:

```tsx
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { getAppName } from "@/lib/settings";
import {
  getMissingAthleteProfileFields,
  getSuggestedAthleteProfileFields,
  type SuggestedAthleteField,
} from "@/lib/auth/profile-completion";
import DashboardNav from "@/components/dashboard/DashboardNav";
import PageViewLogger from "@/components/audit/PageViewLogger";
import ProfileCompletionNudge from "@/components/dashboard/ProfileCompletionNudge";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, appName] = await Promise.all([requireAuth(), getAppName()]);

  let suggestedFields: SuggestedAthleteField[] = [];
  if (session.user.role === "ATHLETE") {
    const missing = await getMissingAthleteProfileFields(session.user.id);
    if (missing.length > 0) redirect("/completar-cadastro");
    suggestedFields = await getSuggestedAthleteProfileFields(session.user.id);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <PageViewLogger />
      <DashboardNav userName={session.user.name} userRole={session.user.role} appName={appName} />
      {suggestedFields.length > 0 && <ProfileCompletionNudge suggestedFields={suggestedFields} />}
      <div className="max-w-5xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
```

- [ ] **Step 6: Limpar a flag de dismiss no logout**

Em `components/dashboard/DashboardNav.tsx`, adicionar o import:

```tsx
import { PROFILE_NUDGE_DISMISS_KEY } from "@/components/dashboard/ProfileCompletionNudge";
```

E trocar a linha do botão de sair:

```tsx
<button onClick={() => signOut({ callbackUrl: "/" })} className="btn-secondary text-xs px-3 py-1">
```

por:

```tsx
<button
  onClick={() => {
    sessionStorage.removeItem(PROFILE_NUDGE_DISMISS_KEY);
    signOut({ callbackUrl: "/" });
  }}
  className="btn-secondary text-xs px-3 py-1"
>
```

- [ ] **Step 7: Rodar a suíte completa e o build**

Run: `npx vitest run`
Expected: todos os testes passam (nenhum teste cobre estes 2 arquivos modificados — mudança
puramente de UI/wiring)

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build limpo

- [ ] **Step 8: Commit**

```bash
git add app/dashboard/layout.tsx components/dashboard/DashboardNav.tsx
git commit -m "feat: exibir modal opcional de completar cadastro no dashboard do atleta"
```

---

## Task 3: Cancelamento de anúncio (`POST /api/anunciante/ads/[id]/cancel`)

**Files:**
- Create: `app/api/anunciante/ads/[id]/cancel/route.ts`
- Create: `components/advertiser/PrivateAdCancelButton.tsx`
- Test: `tests/advertiser-ads-cancel-route.test.ts`

**Interfaces:**
- Consumes: `ACTIVE_STATUSES` de `lib/ads/private-ads.ts` (já existe:
  `["APPROVED", "PENDING_APPROVAL"]`).
- Produces: `POST /api/anunciante/ads/[id]/cancel` (200 `{ ok: true }` no sucesso; 401/403/404/409
  nos erros) e `<PrivateAdCancelButton id={string} />` — consumido pela Task 4.

- [ ] **Step 1: Escrever o teste da rota (falha)**

Criar `tests/advertiser-ads-cancel-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { POST } from "@/app/api/anunciante/ads/[id]/cancel/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/anunciante/ads/ad-1/cancel", { method: "POST" }) as any;
}

function makeParams(id = "ad-1") {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/anunciante/ads/[id]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(401);
  });

  it("retorna 403 para quem não é ADVERTISER", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(403);
  });

  it("retorna 404 quando o usuário ADVERTISER não tem AdvertiserProfile", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(404);
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o anúncio não pertence ao anunciante autenticado (IDOR), sem vazar existência", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    dbMock.privateAd.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(404);
    expect(dbMock.privateAd.findFirst).toHaveBeenCalledWith({
      where: { id: "ad-1", adPurchase: { advertiserId: "advertiser-1" } },
      select: { id: true, status: true },
    });
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("retorna 409 quando o anúncio já não está mais ativo (ex.: já expirado)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    dbMock.privateAd.findFirst.mockResolvedValueOnce({ id: "ad-1", status: "EXPIRED" });

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(409);
    expect(dbMock.privateAd.update).not.toHaveBeenCalled();
  });

  it("cancela um anúncio PENDING_APPROVAL e retorna 200", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    dbMock.privateAd.findFirst.mockResolvedValueOnce({ id: "ad-1", status: "PENDING_APPROVAL" });

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(200);
    expect(dbMock.privateAd.update).toHaveBeenCalledWith({
      where: { id: "ad-1" },
      data: { status: "CANCELLED" },
    });
  });

  it("cancela um anúncio APPROVED e retorna 200", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ADVERTISER" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "advertiser-1" });
    dbMock.privateAd.findFirst.mockResolvedValueOnce({ id: "ad-1", status: "APPROVED" });

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(200);
    expect(dbMock.privateAd.update).toHaveBeenCalledWith({
      where: { id: "ad-1" },
      data: { status: "CANCELLED" },
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/advertiser-ads-cancel-route.test.ts`
Expected: FAIL — módulo `@/app/api/anunciante/ads/[id]/cancel/route` não existe.

- [ ] **Step 3: Implementar a rota**

Criar `app/api/anunciante/ads/[id]/cancel/route.ts`:

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

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/advertiser-ads-cancel-route.test.ts`
Expected: PASS (7 testes)

- [ ] **Step 5: Criar o botão de cancelar (sem teste automatizado — componente client)**

Criar `components/advertiser/PrivateAdCancelButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

export default function PrivateAdCancelButton({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleCancel() {
    setLoading(true);
    const res = await fetch(`/api/anunciante/ads/${id}/cancel`, { method: "POST" });
    setLoading(false);
    setConfirming(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao cancelar anúncio.");
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className="btn-secondary py-1.5 px-3 text-sm text-red-700 border-red-200 hover:bg-red-50"
      >
        Cancelar
      </button>
      <ConfirmModal
        open={confirming}
        title="Cancelar anúncio"
        message="Tem certeza que deseja cancelar este anúncio? A vaga ficará disponível para cadastrar outro."
        confirmLabel="Cancelar anúncio"
        tone="danger"
        loading={loading}
        onConfirm={handleCancel}
        onCancel={() => setConfirming(false)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
```

- [ ] **Step 6: Type-check e commit**

Run: `npx tsc --noEmit`
Expected: sem erros

```bash
git add app/api/anunciante/ads/\[id\]/cancel/route.ts components/advertiser/PrivateAdCancelButton.tsx tests/advertiser-ads-cancel-route.test.ts
git commit -m "feat: rota e botão de cancelamento de anúncio pelo anunciante"
```

---

## Task 4: `/anunciante/anuncios` (Meus Anúncios) — listagem

**Files:**
- Create: `app/anunciante/anuncios/page.tsx`

**Interfaces:**
- Consumes: `ACTIVE_STATUSES` (`lib/ads/private-ads.ts`), `BADGE` (`lib/badge-colors.ts`),
  `formatDate` (`lib/format.ts`), `PrivateAdCancelButton` (Task 3).

Sem teste automatizado (server component de página — mesmo padrão de
`app/admin/anuncios/moderacao/page.tsx` e `app/anunciante/page.tsx`, nenhuma das duas tem teste).

- [ ] **Step 1: Implementar a página**

Criar `app/anunciante/anuncios/page.tsx`:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { BADGE } from "@/lib/badge-colors";
import { ACTIVE_STATUSES } from "@/lib/ads/private-ads";
import PrivateAdCancelButton from "@/components/advertiser/PrivateAdCancelButton";

export const metadata: Metadata = { title: "Meus Anúncios — Anunciante" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING_APPROVAL: { label: "Aguardando aprovação", cls: BADGE.yellow },
  APPROVED: { label: "Aprovado", cls: BADGE.green },
  REJECTED: { label: "Rejeitado", cls: BADGE.red },
  EXPIRED: { label: "Expirado", cls: BADGE.gray },
  CANCELLED: { label: "Cancelado", cls: BADGE.gray },
};

export default async function AdvertiserAnunciosPage() {
  const session = await requireAuth();
  if (session.user.role !== "ADVERTISER") redirect("/acesso-negado");

  const advertiser = await db.advertiserProfile.findUnique({ where: { userId: session.user.id } });

  const ads = advertiser
    ? await db.privateAd.findMany({
        where: { adPurchase: { advertiserId: advertiser.id } },
        include: { adSlot: true },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Meus Anúncios</h1>

      {ads.length === 0 ? (
        <div className="card text-center text-gray-500 dark:text-gray-400">
          Você ainda não cadastrou nenhum anúncio.
        </div>
      ) : (
        <div className="card divide-y dark:divide-gray-700">
          {ads.map((ad) => {
            const status = STATUS[ad.status] ?? { label: ad.status, cls: BADGE.gray };
            return (
              <div key={ad.id} className="py-4 first:pt-0 last:pb-0 flex flex-wrap items-center gap-4">
                <img
                  src={ad.imageUrl}
                  alt={`Anúncio — ${ad.adSlot.label}`}
                  className="w-32 h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="font-medium">{ad.adSlot.label}</p>
                  <a
                    href={ad.targetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline break-all"
                  >
                    {ad.targetUrl}
                  </a>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Cadastrado em {formatDate(ad.createdAt)}
                    {ad.status === "REJECTED" && ad.rejectionReason && <> — Motivo: {ad.rejectionReason}</>}
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded font-medium ${status.cls}`}>{status.label}</span>
                {ACTIVE_STATUSES.includes(ad.status) && <PrivateAdCancelButton id={ad.id} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes continuam passando

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build limpo, rota `/anunciante/anuncios` aparece na listagem de rotas

- [ ] **Step 3: Commit**

```bash
git add app/anunciante/anuncios/page.tsx
git commit -m "feat: pagina Meus Anuncios do anunciante (listagem + cancelamento)"
```

---

## Task 5: `/anunciante/perfil` (Meus Dados)

**Files:**
- Create: `app/api/anunciante/profile/route.ts`
- Create: `app/anunciante/perfil/page.tsx`
- Test: `tests/advertiser-profile-route.test.ts`

**Interfaces:**
- Produces: `GET /api/anunciante/profile` (200 `{ profile }`), `PUT /api/anunciante/profile`
  (200 `{ profile }` ou 400 de validação) — consumidos só pela página deste task.

- [ ] **Step 1: Escrever os testes da rota (falha)**

Criar `tests/advertiser-profile-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/anunciante/profile/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/anunciante/profile", {
    method: "PUT",
    body: JSON.stringify(body),
  }) as any;
}

const validBody = {
  companyName: "Empresa Teste Ltda",
  contactEmail: "contato@empresa.com",
  contactPhone: "11999999999",
};

describe("GET /api/anunciante/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 quando não autenticado", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("retorna o perfil do anunciante autenticado", async () => {
    authMock.mockResolvedValue({ user: { id: "advertiser-user-1" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ companyName: "Empresa Teste" });

    const res = await GET();
    const body = await res.json();

    expect(dbMock.advertiserProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: "advertiser-user-1" },
    });
    expect(body.profile).toEqual({ companyName: "Empresa Teste" });
  });
});

describe("PUT /api/anunciante/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "advertiser-user-1" } } as any);
  });

  it("retorna 401 quando não autenticado", async () => {
    authMock.mockResolvedValueOnce(null as any);
    const res = await PUT(makeRequest(validBody));
    expect(res.status).toBe(401);
  });

  it("rejeita quando falta razão social", async () => {
    const res = await PUT(makeRequest({ ...validBody, companyName: "" }));
    expect(res.status).toBe(400);
    expect(dbMock.advertiserProfile.upsert).not.toHaveBeenCalled();
  });

  it("rejeita e-mail de contato inválido", async () => {
    const res = await PUT(makeRequest({ ...validBody, contactEmail: "invalido" }));
    expect(res.status).toBe(400);
    expect(dbMock.advertiserProfile.upsert).not.toHaveBeenCalled();
  });

  it("salva os 3 campos quando válidos", async () => {
    dbMock.advertiserProfile.upsert.mockResolvedValueOnce(validBody);

    const res = await PUT(makeRequest(validBody));

    expect(res.status).toBe(200);
    expect(dbMock.advertiserProfile.upsert).toHaveBeenCalledWith({
      where: { userId: "advertiser-user-1" },
      create: { userId: "advertiser-user-1", ...validBody },
      update: validBody,
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/advertiser-profile-route.test.ts`
Expected: FAIL — módulo `@/app/api/anunciante/profile/route` não existe.

- [ ] **Step 3: Implementar a rota**

Criar `app/api/anunciante/profile/route.ts`:

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

  const profile = await db.advertiserProfile.findUnique({
    where: { userId: session.user.id },
  });

  return NextResponse.json({ profile });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

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

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/advertiser-profile-route.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Implementar a página (sem teste automatizado — componente client)**

Criar `app/anunciante/perfil/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

type AdvertiserProfileData = {
  companyName?: string;
  contactEmail?: string;
  contactPhone?: string;
};

export default function AdvertiserPerfilPage() {
  const [form, setForm] = useState<AdvertiserProfileData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/anunciante/profile")
      .then((r) => r.json())
      .then(({ profile }) => {
        if (profile) setForm(profile);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/anunciante/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const fieldMessage = Object.values(data.error?.fieldErrors ?? {}).flat()[0];
      setError((fieldMessage as string) ?? data.error ?? "Erro ao salvar dados.");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  function set(field: keyof AdvertiserProfileData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl space-y-6 mx-auto">
      <h1 className="text-2xl font-bold">Meus Dados</h1>

      <form onSubmit={handleSubmit} className="card space-y-4">
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Razão social *</label>
          <input
            type="text"
            value={form.companyName ?? ""}
            onChange={(e) => set("companyName", e.target.value)}
            className="input-field w-full"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">E-mail de contato *</label>
          <input
            type="email"
            value={form.contactEmail ?? ""}
            onChange={(e) => set("contactEmail", e.target.value)}
            className="input-field w-full"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone de contato *</label>
          <input
            type="tel"
            value={form.contactPhone ?? ""}
            onChange={(e) => set("contactPhone", e.target.value)}
            className="input-field w-full"
            placeholder="(11) 99999-9999"
            required
          />
        </div>
        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar dados"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build limpo, rota `/anunciante/perfil` aparece na listagem de rotas

- [ ] **Step 7: Commit**

```bash
git add app/api/anunciante/profile/route.ts app/anunciante/perfil/page.tsx tests/advertiser-profile-route.test.ts
git commit -m "feat: pagina e rota Meus Dados do anunciante"
```

---

## Task 6: `CHECK` constraint em `Payment` (orderId XOR adPurchaseId)

**Files:**
- Create: `prisma/migrations/20260721010000_payment_order_xor_adpurchase_check/migration.sql`
- Modify: `PROGRESSO.md`

**Interfaces:** Nenhuma — mudança de banco pura, sem código de aplicação afetado.

Sem teste automatizado (constraint de banco; já verificado manualmente contra produção antes da
spec — 0 violações nas 147 linhas de `payments` em 2026-07-21).

- [ ] **Step 1: Criar o arquivo de migração manual**

Criar `prisma/migrations/20260721010000_payment_order_xor_adpurchase_check/migration.sql`:

```sql
-- Garante que todo Payment pertence a exatamente um dos dois: um Order (inscricao) ou um
-- AdPurchase (compra de plano de anuncio) -- nunca os dois, nunca nenhum. Ate aqui isso so era
-- garantido "por construcao" no codigo (lib/checkout.ts e lib/checkout-ads.ts), sem garantia no
-- banco.
--
-- ATENCAO: o deploy deste projeto usa `prisma db push --skip-generate`, que NAO executa arquivos
-- migration.sql (ver memoria deploy_vps_process). Este ALTER TABLE precisa ser aplicado
-- manualmente via psql no proximo deploy -- mesmo padrao ja usado pros seeds de AdPlan/AdSlot do
-- sub-projeto de marketplace. Confirmado em 2026-07-21 que as 147 linhas de producao ja respeitam
-- essa regra (0 violacoes), entao e seguro aplicar sem quebrar dados existentes.

ALTER TABLE payments
  ADD CONSTRAINT payment_order_xor_adpurchase_check
  CHECK (
    ((("orderId" IS NOT NULL))::int + (("adPurchaseId" IS NOT NULL))::int) = 1
  );
```

- [ ] **Step 2: Documentar a pendência de aplicação manual em `PROGRESSO.md`**

Adicionar uma nova seção `## CHECK constraint pendente de aplicação manual (Task 6, 2026-07-21)`
no topo do arquivo, junto às outras pendências de deploy manual já registradas. Corpo da seção
(texto corrido, sem bloco de código aninhado — use inline code com crase simples para os nomes de
arquivo/comando):

Primeira linha: menção ao arquivo `prisma/migrations/20260721010000_payment_order_xor_adpurchase_check/migration.sql`,
explicando que garante no banco que `Payment.orderId`/`adPurchaseId` são mutuamente exclusivos
(exatamente um preenchido).

Segunda linha: como o deploy usa `prisma db push` (não roda `migration.sql`), o comando abaixo
precisa ser rodado manualmente via `psql` no próximo deploy — reaproveitar o padrão já documentado
na memória `deploy_vps_process` pra extrair `DATABASE_URL` de `.env.prod.local` sem imprimir o
valor:

```
docker exec -e DBURL="$URL" -i corridas-db sh -c 'psql "$DBURL" -f -' < prisma/migrations/20260721010000_payment_order_xor_adpurchase_check/migration.sql
```

Terceira linha: confirmação de que em 2026-07-21 a produção não tinha nenhuma linha violando a
regra (0 de 147).

- [ ] **Step 3: Rodar a suíte completa e `tsc` (nenhuma mudança de código, só confirmando que nada quebrou)**

Run: `npx vitest run`
Expected: todos os testes continuam passando

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 4: Commit**

```bash
git add "prisma/migrations/20260721010000_payment_order_xor_adpurchase_check/migration.sql" PROGRESSO.md
git commit -m "chore: CHECK constraint para Payment.orderId/adPurchaseId (aplicacao manual no deploy)"
```

---

## Revisão final (depois de todas as 6 tasks)

- [ ] Rodar `npx vitest run` inteiro — suíte completa passando.
- [ ] Rodar `npx tsc --noEmit` — sem erros.
- [ ] Rodar `npm run build` — build de produção limpo, confirmar que `/dashboard`,
  `/anunciante/anuncios` e `/anunciante/perfil` aparecem na listagem de rotas geradas.
- [ ] Conferir manualmente (leitura de código, sem navegador — banco de dev local inacessível
  nesta sessão, mesmo motivo já registrado nas sessões anteriores) que `AdvertiserNav.tsx` não
  precisou de nenhuma mudança — os links já apontavam pros caminhos certos, só faltavam as
  páginas.
