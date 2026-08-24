# Campanhas — layout, filtro por evento, variáveis e preview na criação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o layout dos botões de ação, adicionar filtro por evento na seleção manual de
destinatários (com vínculo real de inscrição por destinatário), liberar patrocínio/redes sociais
(com cache de cota) e variáveis de evento em campanhas de plataforma com uma guarda de segurança no
envio, adicionar 3 variáveis novas, e corrigir o preview pra funcionar também na criação de uma
nova mensagem.

**Architecture:** 7 tasks. Task 1 (layout) é independente. Task 2 (backend de recipientes) precisa
vir antes da Task 3 (UI do filtro). Task 4 (variáveis novas) precisa vir antes da Task 6 (guarda de
envio, que referencia o catálogo completo). Task 5 (patrocínio/redes sociais, adicionada durante a
execução a pedido do usuário) só tem uma mudança de schema real deste plano — as demais tasks não
mudam schema. Task 7 (preview na criação) é independente.

**Tech Stack:** Next.js App Router + TypeScript + Prisma/Postgres + Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-campanhas-layout-filtro-evento-preview-design.md`

## Global Constraints

- Nenhuma mudança de schema, EXCETO a Task 5 (`CampaignRecipient.redesSociaisText`, adicionada
  durante a execução a pedido do usuário) — as demais tasks são compostas em cima de campos que já
  existem (`Registration.bibNumber`, `Registration.teamName`, `EventRoute.distanceKm`,
  `CampaignRecipient.registrationId`).
- Status de inscrição válido pra fins de mensagem = `CONFIRMED`, único valor — mesma convenção já
  usada em `lib/kit-delivery.ts` e `lib/alerts/daily-summary-metrics.ts`. Não usar nenhum outro
  status.
- Não suportar "mais de um evento na mesma campanha" — confirmado explicitamente fora de escopo.
- Nunca usar `alert()`/`confirm()`/`prompt()` — sempre `ConfirmModal`/`ErrorModal`.
- Permissão das rotas novas/alteradas: `campaigns.view` (leitura) ou `campaigns.edit` (escrita),
  mesma convenção já usada em todas as rotas de campanha existentes.

---

### Task 1: Layout — botões de ação do card de campanha

**Files:**
- Modify: `components/campaigns/CampaignsManager.tsx`

**Interfaces:** nenhuma — só CSS/classNames, sem mudança de comportamento/estado.

Sem suíte de componente pra este arquivo (convenção já estabelecida) — verificado por leitura de
código.

- [ ] **Step 1: Trocar o container das ações pra permitir quebra de linha**

Localize `<div className="flex gap-2 shrink-0">` (dentro do `.map()` de campanhas). Troque por:

```tsx
                <div className="flex flex-wrap gap-2 shrink-0 justify-end">
```

- [ ] **Step 2: Trocar as classNames de cada botão de ação pelo padrão-pill**

No mesmo bloco (procure cada `<button onClick=...>` dentro do `.map()` de campanhas — NÃO mexa
nos botões do formulário de criação/edição, nem nos `ConfirmModal`s), troque cada `className`
exatamente como abaixo (mantém tudo mais — `onClick`, `disabled`, texto — igual):

**Editar** (azul):
```tsx
                      <button onClick={() => openEdit(campaign)} className="text-xs px-2 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20 transition-colors">
                        Editar
                      </button>
```

**Cancelar** (as 2 ocorrências — dentro do bloco DRAFT e no bloco SCHEDULED, vermelho):
```tsx
                      <button onClick={() => setCancelingId(campaign.id)} className="text-xs px-2 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors">
                        Cancelar
                      </button>
```

**Preparar destinatários** (verde):
```tsx
                      <button
                        onClick={() => setPreparingConfirmId(campaign.id)}
                        disabled={preparingId === campaign.id}
                        className="text-xs px-2 py-1.5 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/20 transition-colors disabled:opacity-50"
                      >
                        {preparingId === campaign.id ? "Preparando..." : "Preparar destinatários"}
                      </button>
```

**Selecionar destinatários** (verde, dentro do `{allowManualRecipients && (...)}`):
```tsx
                      {allowManualRecipients && (
                        <button
                          onClick={() => openManualSelect(campaign.id)}
                          className="text-xs px-2 py-1.5 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/20 transition-colors"
                        >
                          Selecionar destinatários
                        </button>
                      )}
```

**Pausar** (âmbar):
```tsx
                  {campaign.status === "RUNNING" && (
                    <button onClick={() => setPausingConfirmId(campaign.id)} className="text-xs px-2 py-1.5 rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20 transition-colors">
                      Pausar
                    </button>
                  )}
```

**Retomar** (verde):
```tsx
                  {campaign.status === "PAUSED" && (
                    <button onClick={() => setResumingConfirmId(campaign.id)} className="text-xs px-2 py-1.5 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/20 transition-colors">
                      Retomar
                    </button>
                  )}
```

**Duplicar** (cinza):
```tsx
                  <button onClick={() => void doDuplicate(campaign.id)} className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors">
                    Duplicar
                  </button>
```

**Excluir** (vermelho):
```tsx
                  {canDeleteCampaign(campaign.id) && (
                    <button onClick={() => setDeletingConfirmId(campaign.id)} className="text-xs px-2 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors">
                      Excluir
                    </button>
                  )}
```

(Confira o texto/condição `onClick`/`disabled` exatos de cada botão no arquivo atual antes de
substituir — copie a `className` acima, mas preserve qualquer prop que já esteja lá que não
aparece nesse resumo.)

- [ ] **Step 3: Rodar `tsc --noEmit` e a suíte inteira**

Rode: `npx tsc --noEmit -p tsconfig.json` e `npx vitest run`.

- [ ] **Step 4: Commit**

```bash
git add components/campaigns/CampaignsManager.tsx
git commit -m "fix: botoes de acao do card de campanha usam o padrao-pill do design system"
```

---

### Task 2: Backend — recipientes: fix de status + vínculo de inscrição por evento

**Files:**
- Modify: `lib/campaigns/recipients.ts`
- Modify: `app/api/admin/campaigns/[campaignId]/prepare-recipients/route.ts`
- Modify: `app/api/admin/campaigns/recipients-directory/route.ts`
- Modify: `app/api/admin/campaigns/recipients-directory/ids/route.ts`
- Create: `app/api/admin/campaigns/events-directory/route.ts`
- Test: `tests/campaigns-recipients.test.ts` (adicionar casos)
- Test: `tests/admin-campaigns-route.test.ts` (adicionar caso no describe de prepare-recipients)
- Test: `tests/admin-campaigns-recipients-directory-route.test.ts` (adicionar casos)
- Test (nova): `tests/admin-campaigns-events-directory-route.test.ts`

**Interfaces:**
- Consumes: nada de outra task.
- Produces: `prepareCampaignRecipients(campaignId, eventId, athleteUserIds?, manualEventId?)`;
  `GET recipients-directory?eventId=` e `.../ids?eventId=`; `GET events-directory?q=&page=` →
  `{ rows: {id, title}[], total, page, pageSize, totalPages }`. Todos consumidos pela Task 3 (UI).

- [ ] **Step 1: Escrever os testes falhando pro fix de status + vínculo de inscrição**

Em `tests/campaigns-recipients.test.ts`, adicione ao final do `describe`
`"prepareCampaignRecipients"` (antes do `});` final):

```ts
  it("modo evento automático só considera inscrições CONFIRMED", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await prepareCampaignRecipients("campaign-1", "event-1");

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: "event-1", status: "CONFIRMED" } }),
    );
  });

  it("seleção manual com manualEventId vincula registrationId da inscrição CONFIRMED do atleta naquele evento", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "athlete-1", receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } },
    ]);
    dbMock.registration.findMany.mockResolvedValueOnce([{ id: "reg-99", athleteUserId: "athlete-1" }]);

    const result = await prepareCampaignRecipients("campaign-1", null, ["athlete-1"], "event-9");

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "event-9", status: "CONFIRMED", athleteUserId: { in: ["athlete-1"] } },
      }),
    );
    expect(dbMock.campaignRecipient.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ athleteUserId: "athlete-1", registrationId: "reg-99" }),
      ],
    });
    expect(result.pending).toBe(1);
  });

  it("seleção manual com manualEventId, mas atleta sem inscrição CONFIRMED naquele evento, cai pra registrationId null", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "athlete-1", receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } },
    ]);
    dbMock.registration.findMany.mockResolvedValueOnce([]); // ninguém com inscrição CONFIRMED nesse evento

    await prepareCampaignRecipients("campaign-1", null, ["athlete-1"], "event-9");

    expect(dbMock.campaignRecipient.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ athleteUserId: "athlete-1", registrationId: null })],
    });
  });

  it("seleção manual sem manualEventId continua com registrationId null (regressão)", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "athlete-1", receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } },
    ]);

    await prepareCampaignRecipients("campaign-1", null, ["athlete-1"]);

    expect(dbMock.registration.findMany).not.toHaveBeenCalled();
    expect(dbMock.campaignRecipient.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ registrationId: null })],
    });
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Rode: `npx vitest run tests/campaigns-recipients.test.ts`. Esperado: as 3 primeiras falham (o
código ainda não filtra por `CONFIRMED` nem aceita `manualEventId`); a 4ª já deve passar (é
regressão do comportamento atual).

- [ ] **Step 3: Modificar `lib/campaigns/recipients.ts`**

Substitua o conteúdo INTEIRO do arquivo por:

```ts
import { db } from "@/lib/db";
import { normalizePhoneForWhatsApp, isValidWhatsAppPhone } from "@/lib/whatsapp";

export type PrepareRecipientsResult = {
  total: number;
  pending: number;
  optedOut: number;
  invalidPhone: number;
  duplicate: number;
};

const BATCH_SIZE = 500;

interface CandidateRow {
  athleteUserId: string;
  registrationId: string | null;
  receivePromotionalMessages: boolean;
  phone: string | null;
}

async function fetchCandidateBatch(
  eventId: string | null,
  skip: number,
  athleteUserIds?: string[],
  manualEventId?: string,
): Promise<CandidateRow[]> {
  if (eventId !== null) {
    const registrations = await db.registration.findMany({
      where: { eventId, status: "CONFIRMED" },
      select: {
        id: true,
        athleteUserId: true,
        athlete: {
          select: {
            receivePromotionalMessages: true,
            athleteProfile: { select: { phone: true } },
          },
        },
      },
      skip,
      take: BATCH_SIZE,
      orderBy: { id: "asc" },
    });

    return registrations.map((r) => ({
      athleteUserId: r.athleteUserId,
      registrationId: r.id,
      receivePromotionalMessages: r.athlete.receivePromotionalMessages,
      phone: r.athlete.athleteProfile?.phone ?? null,
    }));
  }

  const users = await db.user.findMany({
    where: {
      role: "ATHLETE",
      active: true,
      ...(athleteUserIds ? { id: { in: athleteUserIds } } : {}),
    },
    select: {
      id: true,
      receivePromotionalMessages: true,
      athleteProfile: { select: { phone: true } },
    },
    skip,
    take: BATCH_SIZE,
    orderBy: { id: "asc" },
  });

  // Seleção manual filtrada por evento: cada destinatário precisa saber a qual inscrição ele se
  // refere pra variáveis de Evento/Inscrição resolverem corretamente (ver
  // messageUsesEventScopedVariables em lib/campaigns/variables.ts). Busca em lote — 1 query pro
  // batch inteiro, não 1 por atleta.
  let registrationByAthlete = new Map<string, string>();
  if (manualEventId && users.length > 0) {
    const registrations = await db.registration.findMany({
      where: { eventId: manualEventId, status: "CONFIRMED", athleteUserId: { in: users.map((u) => u.id) } },
      select: { id: true, athleteUserId: true },
    });
    registrationByAthlete = new Map(registrations.map((r) => [r.athleteUserId, r.id]));
  }

  return users.map((u) => ({
    athleteUserId: u.id,
    registrationId: registrationByAthlete.get(u.id) ?? null,
    receivePromotionalMessages: u.receivePromotionalMessages,
    phone: u.athleteProfile?.phone ?? null,
  }));
}

/** Repopula os destinatários de uma campanha: apaga os existentes e busca candidatos de novo — do
 * evento (só inscrições CONFIRMED), se `eventId` não for nulo, ou de toda a base de atletas
 * ativos, se for — em lotes, sem carregar tudo em memória de uma vez. Aplica, nesta ordem, o
 * filtro de receivePromotionalMessages (sempre, nunca opcional), validação/normalização de
 * telefone, e deduplicação por telefone dentro da campanha (a 1ª ocorrência permanece PENDING, as
 * demais viram SKIPPED). Idempotente — pode ser chamada de novo a qualquer momento; a rota que
 * chama garante que a campanha ainda está em DRAFT, esta função não checa `status` de novo.
 * Aceita `athleteUserIds` opcional (só usado quando `eventId` é nulo) pra restringir os candidatos
 * a uma lista explícita de atletas — usado pela seleção manual de destinatários. Aceita também
 * `manualEventId` opcional (só junto com `athleteUserIds`) pra vincular cada destinatário
 * selecionado manualmente à sua inscrição CONFIRMED naquele evento específico — sem isso,
 * `registrationId` fica `null` e variáveis de Evento/Inscrição não resolvem pra essa pessoa. */
export async function prepareCampaignRecipients(
  campaignId: string,
  eventId: string | null,
  athleteUserIds?: string[],
  manualEventId?: string,
): Promise<PrepareRecipientsResult> {
  await db.campaignRecipient.deleteMany({ where: { campaignId } });

  const result: PrepareRecipientsResult = { total: 0, pending: 0, optedOut: 0, invalidPhone: 0, duplicate: 0 };
  const seenPhones = new Set<string>();
  let skip = 0;

  while (true) {
    const candidates = await fetchCandidateBatch(eventId, skip, athleteUserIds, manualEventId);
    if (candidates.length === 0) break;
    skip += candidates.length;

    const rows = candidates.map((candidate) => {
      result.total += 1;
      const normalized = candidate.phone ? normalizePhoneForWhatsApp(candidate.phone) : "";

      if (!candidate.receivePromotionalMessages) {
        result.optedOut += 1;
        return {
          campaignId,
          athleteUserId: candidate.athleteUserId,
          registrationId: candidate.registrationId,
          normalizedPhone: "",
          status: "OPTED_OUT" as const,
          failureReason: null,
        };
      }

      if (!candidate.phone || !isValidWhatsAppPhone(normalized)) {
        result.invalidPhone += 1;
        return {
          campaignId,
          athleteUserId: candidate.athleteUserId,
          registrationId: candidate.registrationId,
          normalizedPhone: "",
          status: "INVALID_PHONE" as const,
          failureReason: null,
        };
      }

      if (seenPhones.has(normalized)) {
        result.duplicate += 1;
        return {
          campaignId,
          athleteUserId: candidate.athleteUserId,
          registrationId: candidate.registrationId,
          normalizedPhone: "",
          status: "SKIPPED" as const,
          failureReason: "Telefone duplicado nesta campanha",
        };
      }

      seenPhones.add(normalized);
      result.pending += 1;
      return {
        campaignId,
        athleteUserId: candidate.athleteUserId,
        registrationId: candidate.registrationId,
        normalizedPhone: normalized,
        status: "PENDING" as const,
        failureReason: null,
      };
    });

    await db.campaignRecipient.createMany({ data: rows });

    if (candidates.length < BATCH_SIZE) break;
  }

  return result;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Rode: `npx vitest run tests/campaigns-recipients.test.ts`.

- [ ] **Step 5: Escrever o teste falhando pra rota `prepare-recipients` aceitar `manualEventId`**

Em `tests/admin-campaigns-route.test.ts`, dentro do `describe`
`"POST /api/admin/campaigns/[campaignId]/prepare-recipients"`, adicione (antes do `});` final):

```ts
  it("repassa manualEventId do corpo pra prepareCampaignRecipients", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign });
    prepareMock.mockResolvedValueOnce({ total: 1, pending: 1, optedOut: 0, invalidPhone: 0, duplicate: 0 });

    const res = await PREPARE(
      makeRequest("POST", { athleteUserIds: ["athlete-1"], manualEventId: "event-9" }),
      { params: Promise.resolve({ campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(200);
    expect(prepareMock).toHaveBeenCalledWith("campaign-1", null, ["athlete-1"], "event-9");
  });
```

- [ ] **Step 6: Rodar e confirmar que falha**

Rode: `npx vitest run tests/admin-campaigns-route.test.ts`.

- [ ] **Step 7: Modificar `app/api/admin/campaigns/[campaignId]/prepare-recipients/route.ts`**

Troque a linha `const bodySchema = z.object({ athleteUserIds: z.array(z.string()).optional() });`
por:

```ts
const bodySchema = z.object({
  athleteUserIds: z.array(z.string()).optional(),
  manualEventId: z.string().optional(),
});
```

E troque:

```ts
  const rawBody = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success && rawBody && typeof rawBody === "object" && "athleteUserIds" in rawBody) {
    return NextResponse.json({ error: "athleteUserIds deve ser uma lista de IDs" }, { status: 400 });
  }
  const athleteUserIds = parsed.success ? parsed.data.athleteUserIds : undefined;

  const summary = await prepareCampaignRecipients(campaignId, null, athleteUserIds);
```

por:

```ts
  const rawBody = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(rawBody);
  if (
    !parsed.success &&
    rawBody &&
    typeof rawBody === "object" &&
    ("athleteUserIds" in rawBody || "manualEventId" in rawBody)
  ) {
    return NextResponse.json({ error: "Corpo da requisição inválido" }, { status: 400 });
  }
  const athleteUserIds = parsed.success ? parsed.data.athleteUserIds : undefined;
  const manualEventId = parsed.success ? parsed.data.manualEventId : undefined;

  const summary = await prepareCampaignRecipients(campaignId, null, athleteUserIds, manualEventId);
```

(Se essas linhas não baterem exatamente com o arquivo atual — ele já passou por uma correção
anterior nesta mesma sessão — adapte preservando a mesma lógica: só rejeitar com 400 quando o
corpo tiver uma dessas 2 chaves mas falhar a validação; sem corpo ou com outras chaves, cai pro
modo automático como sempre.)

- [ ] **Step 8: Rodar e confirmar que passa**

Rode: `npx vitest run tests/admin-campaigns-route.test.ts`.

- [ ] **Step 9: Escrever os testes falhando pro filtro `eventId` nos diretórios**

Em `tests/admin-campaigns-recipients-directory-route.test.ts`, adicione dentro do describe de
`GET .../recipients-directory` (antes do `});` final):

```ts
  it("filtra por eventId quando informado (só quem tem inscrição CONFIRMED naquele evento)", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([]);

    await DIRECTORY(makeRequest("http://localhost/api/admin/campaigns/recipients-directory?eventId=event-9"));

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          registrations: { some: { eventId: "event-9", status: "CONFIRMED" } },
        }),
      }),
    );
  });
```

E dentro do describe de `GET .../recipients-directory/ids`:

```ts
  it("filtra por eventId quando informado", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([]);

    await DIRECTORY_IDS(makeRequest("http://localhost/api/admin/campaigns/recipients-directory/ids?eventId=event-9"));

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          registrations: { some: { eventId: "event-9", status: "CONFIRMED" } },
        }),
      }),
    );
  });
```

- [ ] **Step 10: Rodar e confirmar que falha**

Rode: `npx vitest run tests/admin-campaigns-recipients-directory-route.test.ts`.

- [ ] **Step 11: Modificar os 2 diretórios pra aceitar `eventId`**

Em `app/api/admin/campaigns/recipients-directory/route.ts`, adicione logo depois da linha do `q`:

```ts
  const eventId = url.searchParams.get("eventId")?.trim() || undefined;
```

E troque o `where`:

```ts
  const where = {
    role: "ATHLETE" as const,
    active: true,
    receivePromotionalMessages: true,
    ...(eventId ? { registrations: { some: { eventId, status: "CONFIRMED" as const } } } : {}),
    ...searchClause,
  };
```

Aplique a MESMA mudança (adicionar `eventId` da querystring + o mesmo trecho de `where`) em
`app/api/admin/campaigns/recipients-directory/ids/route.ts`.

- [ ] **Step 12: Rodar e confirmar que passa**

Rode: `npx vitest run tests/admin-campaigns-recipients-directory-route.test.ts`.

- [ ] **Step 13: Escrever os testes falhando pro novo endpoint de eventos**

Crie `tests/admin-campaigns-events-directory-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET as EVENTS_DIRECTORY } from "@/app/api/admin/campaigns/events-directory/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(url: string) {
  return new Request(url) as any;
}

describe("GET /api/admin/campaigns/events-directory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.count.mockResolvedValue(0);
  });

  it("lista eventos paginados", async () => {
    dbMock.event.findMany.mockResolvedValueOnce([{ id: "event-1", title: "Corrida Exemplo" }]);
    dbMock.event.count.mockResolvedValueOnce(1);

    const res = await EVENTS_DIRECTORY(makeRequest("http://localhost/api/admin/campaigns/events-directory"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.rows).toEqual([{ id: "event-1", title: "Corrida Exemplo" }]);
    expect(data.total).toBe(1);
  });

  it("filtra por busca (título) quando q é informado", async () => {
    dbMock.event.findMany.mockResolvedValueOnce([]);

    await EVENTS_DIRECTORY(makeRequest("http://localhost/api/admin/campaigns/events-directory?q=corrida"));

    expect(dbMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { title: { contains: "corrida", mode: "insensitive" } },
      }),
    );
  });

  it("rejeita ORGANIZER", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await EVENTS_DIRECTORY(makeRequest("http://localhost/api/admin/campaigns/events-directory"));

    expect(res.status).toBe(403);
    expect(dbMock.event.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 14: Rodar e confirmar que falha**

Rode: `npx vitest run tests/admin-campaigns-events-directory-route.test.ts`.

- [ ] **Step 15: Criar `app/api/admin/campaigns/events-directory/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

const PAGE_SIZE = 20;

export async function GET(req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("campaigns.view");
  if (!check.allowed) return check.response;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || undefined;
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);

  const where = q ? { title: { contains: q, mode: "insensitive" as const } } : {};

  const [rows, total] = await Promise.all([
    db.event.findMany({
      where,
      select: { id: true, title: true },
      orderBy: { title: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.event.count({ where }),
  ]);

  return NextResponse.json({
    rows,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
```

- [ ] **Step 16: Rodar e confirmar que passa**

Rode: `npx vitest run tests/admin-campaigns-events-directory-route.test.ts`.

- [ ] **Step 17: Rodar a suíte inteira e confirmar que não há regressão**

Rode: `npx vitest run`.

- [ ] **Step 18: Commit**

```bash
git add lib/campaigns/recipients.ts app/api/admin/campaigns/[campaignId]/prepare-recipients/route.ts app/api/admin/campaigns/recipients-directory app/api/admin/campaigns/events-directory tests/campaigns-recipients.test.ts tests/admin-campaigns-route.test.ts tests/admin-campaigns-recipients-directory-route.test.ts tests/admin-campaigns-events-directory-route.test.ts
git commit -m "feat: filtro por evento na selecao manual (vinculo real de inscricao) + fix de status CONFIRMED"
```

---

### Task 3: UI — seletor de evento no modal de seleção manual

**Files:**
- Modify: `components/campaigns/CampaignsManager.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/campaigns/events-directory`; `GET recipients-directory?eventId=` e
  `.../ids?eventId=`; `POST prepare-recipients` agora aceita `{ athleteUserIds, manualEventId }`
  (Task 2).

Sem suíte de componente pra este arquivo — verificado por leitura de código.

- [ ] **Step 1: Adicionar os states novos**

Logo depois de `const [manualSelectedIds, setManualSelectedIds] = useState<Set<string>>(new Set());`,
adicione:

```tsx
  const [manualEventOptions, setManualEventOptions] = useState<{ id: string; title: string }[]>([]);
  const [manualEventId, setManualEventId] = useState("");
```

- [ ] **Step 2: Carregar a lista de eventos quando o modal abre**

Modifique `openManualSelect` (adicionar a chamada de carregar eventos, resetar `manualEventId`):

```tsx
  function openManualSelect(campaignId: string) {
    setManualSelectId(campaignId);
    setManualSearch("");
    setAppliedManualSearch("");
    setManualEventId("");
    setManualSelectedIds(new Set());
    void loadManualDirectory(1, "");
    void fetch("/api/admin/campaigns/events-directory")
      .then((res) => (res.ok ? res.json() : { rows: [] }))
      .then((data) => setManualEventOptions(data.rows ?? []));
  }
```

- [ ] **Step 3: Fazer `loadManualDirectory`/`selectAllManual` incluírem `eventId`**

Modifique `loadManualDirectory`:

```tsx
  async function loadManualDirectory(page: number, q: string) {
    setManualLoading(true);
    setAppliedManualSearch(q);
    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set("q", q);
    if (manualEventId) params.set("eventId", manualEventId);
    const res = await fetch(`/api/admin/campaigns/recipients-directory?${params}`);
    setManualLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    setManualRows(data.rows);
    setManualPage(data.page);
    setManualTotalPages(data.totalPages);
  }
```

E `selectAllManual`:

```tsx
  async function selectAllManual() {
    const params = new URLSearchParams();
    if (appliedManualSearch) params.set("q", appliedManualSearch);
    if (manualEventId) params.set("eventId", manualEventId);
    const res = await fetch(`/api/admin/campaigns/recipients-directory/ids?${params}`);
    if (!res.ok) return;
    const data = await res.json();
    setManualSelectedIds((prev) => new Set([...prev, ...(data.ids as string[])]));
  }
```

- [ ] **Step 4: Trocar de evento recarrega a lista (página 1) e limpa a seleção**

Adicione uma função nova, logo depois de `deselectAllManual`:

```tsx
  function changeManualEvent(eventId: string) {
    setManualEventId(eventId);
    setManualSelectedIds(new Set());
    void loadManualDirectory(1, manualSearch);
  }
```

(Troca de evento limpa a seleção de propósito — misturar destinatários de "sem evento" com
destinatários de "evento X" na mesma lista confundiria qual `registrationId` cada um carrega;
mais simples e seguro pedir pra selecionar de novo depois de trocar o filtro.)

- [ ] **Step 5: Enviar `manualEventId` no `confirmManualPrepare`**

Modifique:

```tsx
  async function confirmManualPrepare() {
    if (!manualSelectId) return;
    setManualPreparing(true);
    const res = await fetch(`${apiBase}/${manualSelectId}/prepare-recipients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        athleteUserIds: Array.from(manualSelectedIds),
        ...(manualEventId ? { manualEventId } : {}),
      }),
    });
    setManualPreparing(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Erro ao preparar destinatários");
      return;
    }
    const data = await res.json();
    setRecipientSummaries((prev) => ({ ...prev, [manualSelectId]: data.summary }));
    setManualSelectId(null);
  }
```

- [ ] **Step 6: Adicionar o `<select>` de evento no modal**

Localize o modal de seleção manual (`{manualSelectId && (...)}`). Logo ANTES do
`<div className="flex gap-2">` que contém o campo de busca + botão "Buscar", adicione:

```tsx
            <div>
              <label className="block text-xs text-gray-500 mb-1">Filtrar por evento (opcional)</label>
              <select
                value={manualEventId}
                onChange={(e) => changeManualEvent(e.target.value)}
                className="input text-sm w-full"
              >
                <option value="">Todos os atletas da plataforma</option>
                {manualEventOptions.map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.title}</option>
                ))}
              </select>
            </div>
```

- [ ] **Step 7: Rodar `tsc --noEmit` e a suíte inteira**

Rode: `npx tsc --noEmit -p tsconfig.json` e `npx vitest run`.

- [ ] **Step 8: Commit**

```bash
git add components/campaigns/CampaignsManager.tsx
git commit -m "feat: UI do filtro por evento na selecao manual de destinatarios"
```

---

### Task 4: Backend — 3 variáveis novas (distância, número de peito, equipe da inscrição)

**Files:**
- Modify: `lib/templates/variables.ts`
- Modify: `lib/campaigns/resolve-recipient-variables.ts`
- Test: `tests/templates-variables.test.ts` (se existir um teste que conta o total de variáveis,
  ajustar; senão, adicionar caso novo confirmando que as 3 aparecem em `ALL_VARIABLES`)
- Test: `tests/campaigns-resolve-recipient-variables.test.ts` (adicionar casos)

**Interfaces:**
- Produces: 3 nomes de variável novos (`distancia_percurso`, `numero_peito`, `equipe_inscricao`),
  resolvidos por `resolveCampaignRecipientVariables` em modo evento. Consumido pela Task 5 (guarda
  de envio, que trata essas 3 como qualquer outra variável de categoria Evento/Inscrição — nenhuma
  mudança extra necessária lá além do catálogo já incluir elas).

- [ ] **Step 1: Escrever os testes falhando pra resolução das 3 variáveis novas**

Em `tests/campaigns-resolve-recipient-variables.test.ts`, localize o teste que já existe pro modo
evento com um registro completo (provavelmente algo como "resolve todas as variáveis de evento
quando registrationId não é nulo") e adicione, no mock de `db.registration.findUnique` desse
teste, os campos novos:

```ts
        bibNumber: "1234",
        teamName: "Equipe Teste",
        route: { name: "5km", distanceKm: 5 },
```

E adicione as 3 asserções novas nesse mesmo teste:

```ts
      expect(values.numero_peito).toBe("1234");
      expect(values.equipe_inscricao).toBe("Equipe Teste");
      expect(values.distancia_percurso).toBe("5 km");
```

Adicione também um teste separado cobrindo os campos vazios (registro sem `bibNumber`/`teamName`,
ou sem `route`):

```ts
  it("numero_peito/equipe_inscricao/distancia_percurso ficam vazios quando os campos correspondentes são nulos", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ name: "Maria", email: "maria@example.com", athleteProfile: null });
    dbMock.registration.findUnique.mockResolvedValueOnce({
      status: "CONFIRMED",
      createdAt: new Date("2026-01-01"),
      bibNumber: null,
      teamName: null,
      route: null,
      category: null,
      event: {
        title: "Corrida", description: null, startAt: new Date("2026-06-01T07:00:00Z"),
        venueName: null, city: "São Paulo", state: "SP", addressLine: null, slug: "corrida",
        organizer: { companyName: null, phone: null, user: { name: "Org", email: "org@example.com" } },
      },
      order: null,
    });

    const values = await resolveCampaignRecipientVariables({ athleteUserId: "athlete-1", registrationId: "reg-1" });

    expect(values.numero_peito).toBe("");
    expect(values.equipe_inscricao).toBe("");
    expect(values.distancia_percurso).toBe("");
  });
```

(Ajuste os campos do mock do `event`/`organizer` conforme o `select` real já usado nos outros
testes deste arquivo, se diferir do exemplo acima — copie o padrão de um teste existente no mesmo
arquivo pra manter consistência.)

- [ ] **Step 2: Rodar e confirmar que falha**

Rode: `npx vitest run tests/campaigns-resolve-recipient-variables.test.ts`.

- [ ] **Step 3: Adicionar as 3 variáveis em `lib/templates/variables.ts`**

Localize a seção `// Inscrição` dentro de `ALL_VARIABLES` (linhas com `numero_inscricao`,
`status_inscricao`, etc.). Adicione, logo depois de `codigo_confirmacao`:

```ts
  { name: "numero_peito", label: "Número de peito", category: "Inscrição", description: "Registration.bibNumber. Pode ser vazio.", sample: "1234" },
  { name: "equipe_inscricao", label: "Equipe (inscrição)", category: "Inscrição", description: "Registration.teamName — equipe informada nesta inscrição especificamente, pode diferir da equipe geral do perfil do atleta (equipe_atleta). Pode ser vazio.", sample: "Equipe Exemplo Corrida" },
```

Localize a seção `// Evento` (linhas com `nome_evento`, `nome_modalidade`, etc.). Adicione, logo
depois de `nome_modalidade`:

```ts
  { name: "distancia_percurso", label: "Distância do percurso", category: "Evento", description: "EventRoute.distanceKm da inscrição, formatado em km. Pode ser vazio se a inscrição não tiver percurso associado.", sample: "5 km" },
```

- [ ] **Step 4: Modificar `lib/campaigns/resolve-recipient-variables.ts`**

No `select` de `db.registration.findUnique`, troque:

```ts
      route: { select: { name: true } },
```

por:

```ts
      route: { select: { name: true, distanceKm: true } },
```

E adicione `bibNumber: true, teamName: true,` no nível raiz do `select` (junto de `status`,
`createdAt`, etc.):

```ts
    select: {
      status: true,
      createdAt: true,
      bibNumber: true,
      teamName: true,
      route: { select: { name: true, distanceKm: true } },
```

Por fim, adicione as 3 atribuições novas, logo depois de `values.nome_modalidade = ...`:

```ts
  values.numero_peito = registration.bibNumber ?? "";
  values.equipe_inscricao = registration.teamName ?? "";
  values.distancia_percurso = registration.route?.distanceKm ? `${registration.route.distanceKm} km` : "";
```

- [ ] **Step 5: Rodar e confirmar que passa**

Rode: `npx vitest run tests/campaigns-resolve-recipient-variables.test.ts`.

- [ ] **Step 6: Rodar a suíte inteira**

Rode: `npx vitest run`. Se algum teste existente contar o número total de variáveis em
`ALL_VARIABLES` ou o número de variáveis permitidas por `getAllowedCampaignVariableNames`, ajuste
o número esperado (+3).

- [ ] **Step 7: Commit**

```bash
git add lib/templates/variables.ts lib/campaigns/resolve-recipient-variables.ts tests/campaigns-resolve-recipient-variables.test.ts
git commit -m "feat: variaveis novas — numero_peito, equipe_inscricao, distancia_percurso"
```

---

### Task 5: Backend — liberar patrocínio/redes sociais em campanhas (com cache de cota no 1º envio)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260824000000_add_campaign_recipient_redes_sociais_text/migration.sql`
- Modify: `lib/campaigns/variables.ts`
- Modify: `lib/campaigns/resolve-recipient-variables.ts`
- Modify: `app/api/cron/send-campaign-messages/route.ts`
- Test: `tests/campaigns-resolve-recipient-variables.test.ts` (adicionar casos)
- Test: `tests/cron-send-campaign-messages-route.test.ts` (adicionar casos)
- Test: `tests/lib-campaigns-variables.test.ts` (adicionar caso, se aplicável ao arquivo que a Task 6 já cria/usa — se a Task 6 ainda não rodou quando esta task rodar, crie o caso direto no describe já existente de `getAllowedCampaignVariableNames`)

**Interfaces:**
- Consumes: `getSponsorPromoText(eventId)` (`lib/event-sponsors.ts`, já existe, sem efeito
  colateral) e `getSocialPromoText(eventId, userId)` (`lib/event-social-links.ts`, já existe, COM
  efeito colateral — incrementa `SocialLinkSend.count` a cada chamada bem-sucedida).
- Produces: `resolveCampaignRecipientVariables` passa a retornar
  `{ values: Record<string,string>, redesSociaisText?: string }` em vez de só o objeto de valores
  — mudança de assinatura que a Task 6 (guarda de envio) NÃO precisa conhecer (ela só lê
  `context.campaign.messageBody`, nunca chama este resolver diretamente).

Investigação confirmou que a justificativa original pra excluir essas 2 variáveis (Fase D) estava
parcialmente incorreta: `getSponsorPromoText` (patrocínio) não tem NENHUM efeito colateral nem
limite por destinatário — é conteúdo pago do organizador, aparece sempre que ativo. Só
`getSocialPromoText` (redes sociais) tem efeito colateral real (incrementa cota por link ×
destinatário, numa transação, não é idempotente). Como o worker de campanha já processa um
destinatário por vez (nunca renderiza uma vez só pra todo mundo), a preocupação original de
"campanha renderiza o mesmo texto pra milhares de gente" não se aplica — mas existe um risco
diferente e real: se o envio falhar e for tentado de novo (até 3 tentativas), `getSocialPromoText`
seria chamada de novo a cada tentativa, incrementando a cota mais de uma vez pra uma mensagem que
só foi (ou nunca foi) efetivamente entregue uma vez. Decisão confirmada com o usuário: resolver
`redes_sociais` só na 1ª tentativa, guardar o texto resolvido em `CampaignRecipient.redesSociaisText`,
reaproveitar nas tentativas seguintes sem chamar `getSocialPromoText` de novo.

- [ ] **Step 1: Adicionar o campo novo ao schema**

Em `prisma/schema.prisma`, no `model CampaignRecipient`, adicione `redesSociaisText String?` logo
depois de `sentAt DateTime?`:

```prisma
model CampaignRecipient {
  id              String                  @id @default(cuid())
  campaignId      String
  athleteUserId   String
  registrationId  String?
  normalizedPhone String
  status          CampaignRecipientStatus @default(PENDING)
  failureReason   String?
  attempts        Int                     @default(0)
  providerMessageId String?
  sentAt          DateTime?
  redesSociaisText String?
  createdAt       DateTime                @default(now())
  updatedAt       DateTime                @updatedAt

  campaign     Campaign      @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  athlete      User          @relation(fields: [athleteUserId], references: [id])
  registration Registration? @relation(fields: [registrationId], references: [id])

  @@index([campaignId, status])
  @@map("campaign_recipients")
}
```

- [ ] **Step 2: Criar a migration**

`prisma/migrations/` é gitignored — lembre de usar `git add -f` no Step 10, senão o arquivo fica só
no disco, nunca commitado (incidente já registrado neste projeto antes). Crie
`prisma/migrations/20260824000000_add_campaign_recipient_redes_sociais_text/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "campaign_recipients" ADD COLUMN "redesSociaisText" TEXT;
```

- [ ] **Step 3: Escrever os testes falhando pra `resolveCampaignRecipientVariables`**

Em `tests/campaigns-resolve-recipient-variables.test.ts`, adicione (mockando
`@/lib/event-sponsors` e `@/lib/event-social-links` no topo do arquivo, junto dos outros
`vi.mock`):

```ts
vi.mock("@/lib/event-sponsors", () => ({ getSponsorPromoText: vi.fn() }));
vi.mock("@/lib/event-social-links", () => ({ getSocialPromoText: vi.fn() }));
```

E importe as duas funções mockadas junto dos outros imports:

```ts
import { getSponsorPromoText } from "@/lib/event-sponsors";
import { getSocialPromoText } from "@/lib/event-social-links";
```

Adicione estes testes (ajuste o mock de `db.registration.findUnique` pro mesmo padrão já usado
nos outros testes deste arquivo, garantindo que `eventId` esteja no objeto retornado — se o
`select` atual não inclui `eventId` na raiz, o Step 5 abaixo já adiciona):

```ts
  it("resolve patrocinio sempre, sem cache, sem efeito colateral", async () => {
    vi.mocked(getSponsorPromoText).mockResolvedValueOnce("Patrocinador X");
    dbMock.registration.findUnique.mockResolvedValueOnce({ /* ...mesmo shape completo já usado nos outros testes deste arquivo, com eventId: "event-1" */ });

    const result = await resolveCampaignRecipientVariables({ athleteUserId: "athlete-1", registrationId: "reg-1" });

    expect(getSponsorPromoText).toHaveBeenCalledWith("event-1");
    expect(result.values.patrocinio).toBe("Patrocinador X");
  });

  it("resolve redes_sociais fresco quando redesSociaisText não é informado, e retorna o valor pra ser persistido", async () => {
    vi.mocked(getSocialPromoText).mockResolvedValueOnce("Segue no Instagram!");
    dbMock.registration.findUnique.mockResolvedValueOnce({ /* mesmo shape, eventId: "event-1" */ });

    const result = await resolveCampaignRecipientVariables({ athleteUserId: "athlete-1", registrationId: "reg-1" });

    expect(getSocialPromoText).toHaveBeenCalledWith("event-1", "athlete-1");
    expect(result.values.redes_sociais).toBe("Segue no Instagram!");
    expect(result.redesSociaisText).toBe("Segue no Instagram!");
  });

  it("reaproveita redesSociaisText já cacheado, sem chamar getSocialPromoText de novo", async () => {
    dbMock.registration.findUnique.mockResolvedValueOnce({ /* mesmo shape, eventId: "event-1" */ });

    const result = await resolveCampaignRecipientVariables({
      athleteUserId: "athlete-1",
      registrationId: "reg-1",
      redesSociaisText: "Texto já resolvido antes",
    });

    expect(getSocialPromoText).not.toHaveBeenCalled();
    expect(result.values.redes_sociais).toBe("Texto já resolvido antes");
    expect(result.redesSociaisText).toBeUndefined();
  });
```

(Copie o `select` mock completo de `db.registration.findUnique` de um teste já existente neste
arquivo — só acrescente `eventId: "event-1"` no objeto retornado, e ajuste conforme o Step 5
alterar o `select` real.)

- [ ] **Step 4: Rodar e confirmar que falha**

Rode: `npx vitest run tests/campaigns-resolve-recipient-variables.test.ts`.

- [ ] **Step 5: Modificar `lib/campaigns/resolve-recipient-variables.ts`**

Adicione os imports no topo:

```ts
import { getSponsorPromoText } from "@/lib/event-sponsors";
import { getSocialPromoText } from "@/lib/event-social-links";
```

No `select` de `db.registration.findUnique`, adicione `eventId: true` na raiz (junto de `status`,
`createdAt`, `bibNumber`, `teamName`):

```ts
    select: {
      status: true,
      createdAt: true,
      bibNumber: true,
      teamName: true,
      eventId: true,
```

Troque a assinatura da função e o `return` final. De:

```ts
export async function resolveCampaignRecipientVariables(recipient: {
  athleteUserId: string;
  registrationId: string | null;
}): Promise<Record<string, string>> {
```

para:

```ts
export async function resolveCampaignRecipientVariables(recipient: {
  athleteUserId: string;
  registrationId: string | null;
  redesSociaisText?: string | null;
}): Promise<{ values: Record<string, string>; redesSociaisText?: string }> {
```

Todo `return values;` existente (o early-return de `registrationId === null`, e o de
`!registration`) vira `return { values };` (sem 2º campo — patrocínio/redes_sociais só fazem
sentido quando há uma inscrição/evento real).

Antes do `return` final (depois de `values.codigo_confirmacao = ...`), adicione:

```ts
  values.patrocinio = await getSponsorPromoText(registration.eventId);

  let redesSociaisText: string | undefined;
  if (recipient.redesSociaisText != null) {
    values.redes_sociais = recipient.redesSociaisText;
  } else {
    const resolved = await getSocialPromoText(registration.eventId, recipient.athleteUserId);
    values.redes_sociais = resolved;
    redesSociaisText = resolved;
  }

  return { values, redesSociaisText };
```

- [ ] **Step 6: Rodar e confirmar que passa**

Rode: `npx vitest run tests/campaigns-resolve-recipient-variables.test.ts`.

- [ ] **Step 7: Liberar as 2 variáveis no catálogo**

Em `lib/campaigns/variables.ts`, remova `"patrocinio"` e `"redes_sociais"` do `EXCLUDED_NAMES`, e
atualize o comentário logo acima da constante (que hoje afirma que as duas têm efeito colateral —
isso está incorreto pra patrocínio) pra algo como:

```ts
/** redes_sociais tem efeito colateral real (incrementa cota de envio por link, via
 * getSocialPromoText) — o worker de campanha (app/api/cron/send-campaign-messages/route.ts)
 * resolve essa variável só na 1ª tentativa de cada destinatário e reaproveita o valor cacheado
 * (CampaignRecipient.redesSociaisText) nas tentativas seguintes, pra nunca incrementar a cota
 * mais de uma vez pela mesma mensagem. patrocinio (getSponsorPromoText) não tem efeito colateral
 * nem limite por destinatário — resolve sempre, sem cache.
 *
 * As demais entradas abaixo são variáveis específicas de UM alerta pontual (resumo diário,
 * carrinho abandonado, inscrição por procuração) que resolveCampaignRecipientVariables
 * (lib/campaigns/resolve-recipient-variables.ts) nunca resolve — oferecê-las aqui faria o texto
 * sair com o campo em branco num envio real, já que renderTemplate substitui variável não
 * resolvida por "" silenciosamente. Se um novo alerta específico ganhar uma variável nova que
 * compartilhe categoria com uma variável de campanha, adicione o nome aqui também. */
```

- [ ] **Step 8: Modificar o worker (`app/api/cron/send-campaign-messages/route.ts`)**

Troque a linha:

```ts
    const values = await resolveCampaignRecipientVariables({
      athleteUserId: recipient.athleteUserId,
      registrationId: recipient.registrationId,
    });
```

por:

```ts
    const { values, redesSociaisText } = await resolveCampaignRecipientVariables({
      athleteUserId: recipient.athleteUserId,
      registrationId: recipient.registrationId,
      redesSociaisText: recipient.redesSociaisText,
    });
    // Se redes_sociais foi resolvida fresca nesta tentativa (getSocialPromoText já incrementou a
    // cota de verdade), persiste ANTES de tentar o envio — assim, se o envio falhar e for tentado
    // de novo, a próxima tentativa reaproveita o valor já cacheado em vez de incrementar a cota
    // outra vez pela mesma mensagem que ainda não foi (ou nunca será) entregue.
    if (redesSociaisText !== undefined) {
      await db.campaignRecipient.update({ where: { id: recipient.id }, data: { redesSociaisText } });
    }
```

(Este bloco fica dentro do mesmo `try` que já existe — se a persistência falhar, cai no mesmo
catch/retry de sempre, sem risco de destinatário preso em `PROCESSING`.)

- [ ] **Step 9: Escrever os testes falhando pro worker**

Em `tests/cron-send-campaign-messages-route.test.ts`, ajuste o mock de
`resolveCampaignRecipientVariables` no topo (hoje provavelmente
`vi.fn().mockResolvedValue({ nome_atleta: "Maria" })`) pra devolver a nova forma
`{ values: { nome_atleta: "Maria" } }` em todos os testes existentes que dependem do valor
default (rode a suíte depois de ajustar e veja o que quebra). Adicione 2 casos novos no describe
principal:

```ts
  it("persiste redesSociaisText no CampaignRecipient quando resolvido fresco, antes de tentar o envio", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: "reg-1", campaignId: "campaign-1", redesSociaisText: null,
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    vi.mocked(resolveCampaignRecipientVariables).mockResolvedValueOnce({
      values: { nome_atleta: "Maria" },
      redesSociaisText: "Segue no Instagram!",
    });
    sendMock.mockResolvedValueOnce({ providerMessageId: "wamid.1" });

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith({
      where: { id: "rec-1" },
      data: { redesSociaisText: "Segue no Instagram!" },
    });
  });

  it("não persiste redesSociaisText quando o valor já veio cacheado (redesSociaisText undefined no retorno)", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: "reg-1", campaignId: "campaign-1", redesSociaisText: "já resolvido antes",
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    vi.mocked(resolveCampaignRecipientVariables).mockResolvedValueOnce({
      values: { nome_atleta: "Maria" },
    });
    sendMock.mockResolvedValueOnce({ providerMessageId: "wamid.1" });

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ redesSociaisText: expect.anything() }) }),
    );
  });
```

- [ ] **Step 10: Rodar e confirmar que passa**

Rode: `npx vitest run tests/cron-send-campaign-messages-route.test.ts`.

- [ ] **Step 11: Rodar a suíte inteira e confirmar que não há regressão**

Rode: `npx vitest run`.

- [ ] **Step 12: Commit**

```bash
git add prisma/schema.prisma tests/campaigns-resolve-recipient-variables.test.ts tests/cron-send-campaign-messages-route.test.ts lib/campaigns/variables.ts lib/campaigns/resolve-recipient-variables.ts app/api/cron/send-campaign-messages/route.ts
git add -f prisma/migrations/20260824000000_add_campaign_recipient_redes_sociais_text/migration.sql
git commit -m "feat: libera patrocinio/redes_sociais em campanhas, com cache de cota de redes_sociais no 1o envio"
```

---

### Task 6: Backend — variáveis de evento em campanha de plataforma + guarda no envio

**Files:**
- Modify: `lib/campaigns/variables.ts`
- Modify: `app/api/admin/campaigns/route.ts`
- Modify: `app/api/admin/campaigns/[campaignId]/route.ts`
- Modify: `app/api/admin/campaigns/[campaignId]/schedule/route.ts`
- Modify: `app/api/events/[id]/campaigns/[campaignId]/schedule/route.ts`
- Test: `tests/lib-campaigns-variables.test.ts` (se existir; senão criar) — casos pra
  `messageUsesEventScopedVariables` e pro parâmetro `forceEventCategories`
- Test: `tests/admin-campaigns-route.test.ts` (ajustar/adicionar caso de criar/editar com variável
  de evento numa campanha de plataforma)
- Test: `tests/admin-campaigns-compose-route.test.ts` (adicionar caso na rota de schedule)
- Test: `tests/events-campaigns-compose-route.test.ts` (adicionar caso equivalente, se esse
  arquivo existir — confira o nome exato do arquivo que testa a rota de schedule event-scoped)

**Interfaces:**
- Consumes: as 3 variáveis da Task 4 já estão no catálogo (nenhuma mudança extra necessária aqui
  além de existirem).
- Produces: `messageUsesEventScopedVariables(messageBody)`; `getAllowedCampaignVariables(eventId,
  forceEventCategories?)`/`getAllowedCampaignVariableNames(eventId, forceEventCategories?)`.

- [ ] **Step 1: Escrever os testes falhando pra `lib/campaigns/variables.ts`**

Verifique se já existe um arquivo de teste pra este módulo (`tests/lib-campaigns-variables.test.ts`
ou nome parecido — procure por `getAllowedCampaignVariableNames` nos arquivos de teste). Se
existir, adicione os casos abaixo nele; senão, crie o arquivo com esse conteúdo (ajustando os
imports se o nome real do arquivo/teste existente for diferente):

```ts
import { describe, expect, it } from "vitest";
import {
  getAllowedCampaignVariableNames,
  messageUsesEventScopedVariables,
} from "@/lib/campaigns/variables";

describe("getAllowedCampaignVariableNames com forceEventCategories", () => {
  it("sem forceEventCategories, campanha de plataforma (eventId null) não inclui variáveis de Evento", () => {
    const names = getAllowedCampaignVariableNames(null);
    expect(names).not.toContain("nome_evento");
  });

  it("com forceEventCategories, campanha de plataforma passa a incluir variáveis de Evento", () => {
    const names = getAllowedCampaignVariableNames(null, true);
    expect(names).toContain("nome_evento");
    expect(names).toContain("numero_inscricao");
  });

  it("campanha de evento (eventId não-nulo) já inclui variáveis de Evento, com ou sem o parâmetro novo", () => {
    expect(getAllowedCampaignVariableNames("event-1")).toContain("nome_evento");
    expect(getAllowedCampaignVariableNames("event-1", true)).toContain("nome_evento");
  });
});

describe("messageUsesEventScopedVariables", () => {
  it("detecta variável de categoria Evento", () => {
    expect(messageUsesEventScopedVariables("Vem pro {{nome_evento}}!")).toBe(true);
  });

  it("detecta variável de categoria Inscrição", () => {
    expect(messageUsesEventScopedVariables("Sua inscrição {{numero_inscricao}} está confirmada")).toBe(true);
  });

  it("não detecta quando só usa variáveis de Atleta/Plataforma", () => {
    expect(messageUsesEventScopedVariables("Olá {{nome_atleta}}, bem-vindo à {{nome_plataforma}}!")).toBe(false);
  });

  it("não detecta em texto sem nenhuma variável", () => {
    expect(messageUsesEventScopedVariables("Mensagem sem variáveis")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Rode: `npx vitest run` no arquivo criado/modificado no Step 1.

- [ ] **Step 3: Modificar `lib/campaigns/variables.ts`**

Substitua as 2 funções exportadas + adicione a nova:

```ts
export function getAllowedCampaignVariables(
  eventId: string | null,
  forceEventCategories = false,
): VariableDefinition[] {
  const categories = new Set(
    eventId !== null || forceEventCategories ? [...ALWAYS_CATEGORIES, ...EVENT_ONLY_CATEGORIES] : ALWAYS_CATEGORIES,
  );
  return ALL_VARIABLES.filter((v) => {
    if (!categories.has(v.category) || EXCLUDED_NAMES.has(v.name)) return false;
    // categoria_inscricao só é resolvida quando há uma inscrição associada (modo evento, ou
    // seleção manual de plataforma filtrada por evento — ver resolveCampaignRecipientVariables).
    if (v.name === "categoria_inscricao" && eventId === null && !forceEventCategories) return false;
    return true;
  });
}

export function getAllowedCampaignVariableNames(eventId: string | null, forceEventCategories = false): string[] {
  return getAllowedCampaignVariables(eventId, forceEventCategories).map((v) => v.name);
}

/** Detecta se um texto de mensagem usa alguma variável de categoria Evento/Organizador/Inscrição —
 * usado pela guarda de agendar/disparar: campanhas de plataforma só podem realmente enviar essas
 * variáveis se TODOS os destinatários tiverem um registrationId (ver seleção manual filtrada por
 * evento em lib/campaigns/recipients.ts). */
export function messageUsesEventScopedVariables(messageBody: string): boolean {
  const eventScopedNames = new Set(
    ALL_VARIABLES.filter((v) => EVENT_ONLY_CATEGORIES.includes(v.category)).map((v) => v.name),
  );
  const found = [...messageBody.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  return found.some((name) => eventScopedNames.has(name));
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Rode o arquivo de teste do Step 1.

- [ ] **Step 5: Permitir variáveis de evento ao criar/editar campanha de plataforma**

Em `app/api/admin/campaigns/route.ts` (rota `POST`, criação) e
`app/api/admin/campaigns/[campaignId]/route.ts` (rota `PATCH`, edição), localize a chamada
`validateTemplateVariables(..., getAllowedCampaignVariableNames(null))` (ou `getAllowedCampaignVariableNames(eventId)`
onde `eventId` já é `null` porque é a rota de plataforma) e troque o argumento pra
`getAllowedCampaignVariableNames(null, true)`.

**Não mexa** nas rotas event-scoped (`app/api/events/[id]/campaigns/...`) — elas já passam o
`eventId` real, que já libera as categorias sem precisar do parâmetro novo.

- [ ] **Step 6: Escrever o teste falhando confirmando que a validação de criar/editar aceita variável de evento numa campanha de plataforma**

No arquivo de teste da rota `POST /api/admin/campaigns` (provavelmente dentro de
`tests/admin-campaigns-route.test.ts`, no describe da criação), localize o teste que hoje afirma o
oposto (algo como "rejeita variável de categoria Evento numa campanha de plataforma" — pode estar
testando `{{nome_evento}}` sendo rejeitado). Esse teste precisa ser **invertido**: agora uma
campanha de plataforma DEVE aceitar `{{nome_evento}}` (e as demais variáveis de Evento/Inscrição)
no cadastro. Adapte o teste existente (ou substitua) por:

```ts
  it("aceita variável de categoria Evento numa campanha de plataforma (guarda fica pro envio, não pro cadastro)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.create.mockResolvedValueOnce({ ...platformDraftCampaign, messageBody: "Vem pro {{nome_evento}}!" });

    const res = await POST(makeRequest("POST", { name: "Campanha de plataforma", messageBody: "Vem pro {{nome_evento}}!" }));

    expect(res.status).toBe(201);
    expect(dbMock.campaign.create).toHaveBeenCalled();
  });
```

(Localize e ajuste com cuidado — pode haver mais de um teste que precisa desse mesmo ajuste, tanto
no describe de criação quanto no de edição/PATCH. Rode a suíte depois de cada ajuste pra confirmar
que não sobrou nenhuma asserção antiga esperando rejeição.)

- [ ] **Step 7: Rodar e confirmar que passa**

Rode: `npx vitest run tests/admin-campaigns-route.test.ts`.

- [ ] **Step 8: Escrever os testes falhando pra guarda de agendar/disparar**

Em `tests/admin-campaigns-compose-route.test.ts`, dentro do describe de
`"POST /api/admin/campaigns/[campaignId]/schedule"`, adicione:

```ts
  it("rejeita agendar/disparar quando a mensagem usa variável de evento mas há destinatário sem registrationId", async () => {
    dbMock.campaign.findFirst.mockResolvedValue({ id: "campaign-1", eventId: null, status: "DRAFT", messageBody: "Vem pro {{nome_evento}}!" });
    dbMock.campaignRecipient.count.mockResolvedValueOnce(5); // recipientCount > 0, passa a 1ª checagem
    dbMock.campaignRecipient.count.mockResolvedValueOnce(1); // 1 destinatário com registrationId: null

    const res = await SCHEDULE(new Request("http://localhost", { method: "POST" }) as any, {
      params: Promise.resolve({ campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(400);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });

  it("permite agendar/disparar quando a mensagem usa variável de evento e todos os destinatários têm registrationId", async () => {
    dbMock.campaign.findFirst.mockResolvedValue({ id: "campaign-1", eventId: null, status: "DRAFT", messageBody: "Vem pro {{nome_evento}}!" });
    dbMock.campaignRecipient.count.mockResolvedValueOnce(5);
    dbMock.campaignRecipient.count.mockResolvedValueOnce(0); // ninguém com registrationId null
    dbMock.campaign.update.mockResolvedValueOnce({ id: "campaign-1", status: "RUNNING" });

    const res = await SCHEDULE(new Request("http://localhost", { method: "POST" }) as any, {
      params: Promise.resolve({ campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(200);
  });
```

(Confira o `beforeEach` já existente nesse describe pra reaproveitar o mock de `dbMock.campaign.findFirst`
já configurado lá — pode já cobrir a campanha padrão sem `messageBody` com variável de evento;
ajuste conforme necessário, mantendo os demais testes desse describe intactos.)

- [ ] **Step 9: Rodar e confirmar que falha**

Rode: `npx vitest run tests/admin-campaigns-compose-route.test.ts`.

- [ ] **Step 10: Adicionar a guarda em `app/api/admin/campaigns/[campaignId]/schedule/route.ts`**

Adicione o import no topo:

```ts
import { messageUsesEventScopedVariables } from "@/lib/campaigns/variables";
```

Logo depois do bloco:

```ts
  const recipientCount = await db.campaignRecipient.count({ where: { campaignId } });
  if (recipientCount === 0) {
    return NextResponse.json({ error: "Prepare os destinatários antes de agendar ou disparar" }, { status: 400 });
  }
```

adicione:

```ts
  if (messageUsesEventScopedVariables(context.campaign.messageBody)) {
    const withoutRegistration = await db.campaignRecipient.count({
      where: { campaignId, registrationId: null },
    });
    if (withoutRegistration > 0) {
      return NextResponse.json(
        {
          error:
            "Esta mensagem usa variáveis de evento, mas nem todos os destinatários estão vinculados a uma inscrição de evento. Prepare os destinatários filtrando por um evento específico antes de agendar ou disparar.",
        },
        { status: 400 },
      );
    }
  }
```

- [ ] **Step 11: Rodar e confirmar que passa**

Rode: `npx vitest run tests/admin-campaigns-compose-route.test.ts`.

- [ ] **Step 12: Aplicar a mesma guarda na rota event-scoped**

Em `app/api/events/[id]/campaigns/[campaignId]/schedule/route.ts`, aplique a MESMA mudança
(import + bloco de checagem, no mesmo ponto relativo — logo depois do `recipientCount === 0`).
Como campanhas de evento sempre preenchem `registrationId` (fix da Task 2), essa checagem nunca
deveria disparar na prática ali — mas adicionar a mesma guarda mantém as 2 rotas consistentes e
protege contra qualquer caso futuro. Adicione um teste equivalente ao Step 8 no arquivo de teste
dessa rota (`tests/events-campaigns-compose-route.test.ts` ou onde quer que os testes de schedule
event-scoped estejam — localize pelo import de `SCHEDULE` desse arquivo de rota).

- [ ] **Step 13: Rodar a suíte inteira e confirmar que não há regressão**

Rode: `npx vitest run`.

- [ ] **Step 14: Commit**

```bash
git add lib/campaigns/variables.ts app/api/admin/campaigns/route.ts app/api/admin/campaigns/[campaignId]/route.ts app/api/admin/campaigns/[campaignId]/schedule/route.ts app/api/events/[id]/campaigns/[campaignId]/schedule/route.ts tests/
git commit -m "feat: libera variaveis de evento em campanha de plataforma, com guarda no agendar/disparar"
```

---

### Task 7: UI — preview ao vivo no formulário de criação

**Files:**
- Modify: `components/campaigns/CampaignsManager.tsx`

**Interfaces:**
- Consumes: `renderTemplate`/`SAMPLE_VALUES` (já importados no arquivo pela Task 7 da fase
  anterior — confirme os imports já existem antes de adicionar de novo).

Sem suíte de componente — verificado por leitura de código.

- [ ] **Step 1: Confirmar os imports já existem**

Confira se o topo do arquivo já tem:
```ts
import { renderTemplate } from "@/lib/templates/render";
import { SAMPLE_VALUES } from "@/lib/templates/variables";
```
(Devem já existir — foram adicionados numa fase anterior desta mesma sessão pro preview do modal
de edição. Se por algum motivo não existirem, adicione-os logo abaixo do import de `ErrorModal`.)

- [ ] **Step 2: Envolver o bloco "Mensagem" do formulário de criação num grid de 2 colunas**

Localize, dentro do `{showForm && (...)}`, o bloco:

```tsx
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem *</label>
            <textarea
              required
              ref={createBodyRef}
              value={form.messageBody}
              onChange={(e) => setForm({ ...form, messageBody: e.target.value })}
              className="input w-full"
              rows={4}
              placeholder="Escreva a mensagem que será enviada..."
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  insertVariable(e.target.value, createBodyRef, form.messageBody, (v) => setForm({ ...form, messageBody: v }));
                }
                e.target.value = "";
              }}
              className="input text-sm"
            >
              <option value="">+ Inserir variável...</option>
              {[...new Set(variables.map((v) => v.category))].map((cat) => (
                <optgroup key={cat} label={cat}>
                  {variables
                    .filter((v) => v.category === cat)
                    .map((v) => (
                      <option key={v.name} value={v.name}>{`{{${v.name}}} — ${v.label}`}</option>
                    ))}
                </optgroup>
              ))}
            </select>
            <span className="text-xs text-gray-400">{form.messageBody.length} caracteres</span>
          </div>
```

Substitua por:

```tsx
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem *</label>
                <textarea
                  required
                  ref={createBodyRef}
                  value={form.messageBody}
                  onChange={(e) => setForm({ ...form, messageBody: e.target.value })}
                  className="input w-full"
                  rows={6}
                  placeholder="Escreva a mensagem que será enviada..."
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      insertVariable(e.target.value, createBodyRef, form.messageBody, (v) => setForm({ ...form, messageBody: v }));
                    }
                    e.target.value = "";
                  }}
                  className="input text-sm"
                >
                  <option value="">+ Inserir variável...</option>
                  {[...new Set(variables.map((v) => v.category))].map((cat) => (
                    <optgroup key={cat} label={cat}>
                      {variables
                        .filter((v) => v.category === cat)
                        .map((v) => (
                          <option key={v.name} value={v.name}>{`{{${v.name}}} — ${v.label}`}</option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                <span className="text-xs text-gray-400">{form.messageBody.length} caracteres</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pré-visualização ao vivo</label>
              <p className="whitespace-pre-wrap text-sm bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 min-h-[9rem]">
                {renderTemplate(form.messageBody, SAMPLE_VALUES, "WHATSAPP") || "Digite a mensagem para ver a pré-visualização..."}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Usa dados de amostra — o preview aparece assim que você começar a digitar, sem precisar salvar.
              </p>
            </div>
          </div>
```

- [ ] **Step 3: Rodar `tsc --noEmit` e a suíte inteira**

Rode: `npx tsc --noEmit -p tsconfig.json` e `npx vitest run`.

- [ ] **Step 4: Commit**

```bash
git add components/campaigns/CampaignsManager.tsx
git commit -m "feat: preview ao vivo no formulario de criacao de campanha (antes do primeiro salvamento)"
```
