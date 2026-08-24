# Campanhas — Destinatários Avançados + UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seleção manual de destinatários (plataforma), envio avulso pra número específico,
exclusão de campanha sem envio real, preview ao vivo enquanto digita, e uma aba de atletas que
optaram por não receber mensagens.

**Architecture:** 8 tasks. Tasks 1-2 (seleção manual: backend depois UI), 3-4 (número específico:
backend depois UI), 5-6 (excluir: backend depois UI), 7 (preview ao vivo, só UI), 8 (aba de
opt-outs, backend+UI juntos por ser pequeno e isolado). Nenhuma mudança de schema.

**Tech Stack:** Next.js App Router + TypeScript + Prisma/Postgres + Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-campanhas-destinatarios-avancados-design.md`

## Global Constraints

- Nenhuma mudança de schema — tudo composto em cima de campos que já existem.
- Seleção manual **só pra atletas** (`role: "ATHLETE"`), **respeitando consentimento**
  (`receivePromotionalMessages: true`) e **só pra campanhas de plataforma** (`eventId` nulo,
  admin) — nunca pra campanhas de evento.
- Envio pra número específico é **imediato e direto**, nunca entra na fila/worker de campanha.
- Nunca usar `alert()`/`confirm()`/`prompt()` — sempre `ConfirmModal`/`ErrorModal`
  (`components/ui/ConfirmModal.tsx` / `components/ui/ErrorModal.tsx`).
- Permissão de todas as rotas novas de composição/exclusão: `campaigns.edit` (mesma já usada por
  `schedule`/`pause`/`resume`) via `checkAdminOnlyApiPermission`. Rotas de leitura (diretório de
  destinatários, lista de opt-outs): `campaigns.view`.

---

### Task 1: Backend — seleção manual de destinatários

**Files:**
- Modify: `tests/setup.ts` (nenhuma mudança nesta task — só confirmar que `user.findMany`/`user.count` já existem no mock, o que já é o caso)
- Modify: `lib/campaigns/recipients.ts`
- Modify: `app/api/admin/campaigns/[campaignId]/prepare-recipients/route.ts`
- Create: `app/api/admin/campaigns/recipients-directory/route.ts`
- Create: `app/api/admin/campaigns/recipients-directory/ids/route.ts`
- Test: `tests/campaigns-recipients.test.ts` (adicionar casos)
- Test: `tests/admin-campaigns-route.test.ts` (adicionar caso no describe de prepare-recipients)
- Test (nova): `tests/admin-campaigns-recipients-directory-route.test.ts`

**Interfaces:**
- Consumes: nada de outra task.
- Produces: `prepareCampaignRecipients(campaignId, eventId, athleteUserIds?: string[])` — Task 2
  (UI) chama `POST .../prepare-recipients` com `{ athleteUserIds: string[] }` no corpo.
  `GET /api/admin/campaigns/recipients-directory?q=&page=` → `{ rows: {id,name,email,phone}[],
  total, page, pageSize, totalPages }`. `GET
  /api/admin/campaigns/recipients-directory/ids?q=` → `{ ids: string[] }`. Ambos consumidos pela
  Task 2.

- [ ] **Step 1: Escrever os testes falhando pra `prepareCampaignRecipients` com `athleteUserIds`**

Adicione ao final de `tests/campaigns-recipients.test.ts`, dentro do `describe`
`"prepareCampaignRecipients"` já existente (antes do `});` final):

```ts
  it("restringe candidatos por athleteUserIds quando informado (modo plataforma)", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "athlete-1", receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } },
    ]);

    const result = await prepareCampaignRecipients("campaign-1", null, ["athlete-1", "athlete-2"]);

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: "ATHLETE", active: true, id: { in: ["athlete-1", "athlete-2"] } },
      }),
    );
    expect(result.pending).toBe(1);
  });

  it("sem athleteUserIds, comportamento idêntico ao modo automático (regressão)", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "athlete-1", receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } },
    ]);

    await prepareCampaignRecipients("campaign-1", null);

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "ATHLETE", active: true } }),
    );
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Rode: `npx vitest run tests/campaigns-recipients.test.ts`. Esperado: a 1ª falha (o `where` ainda
não inclui `id: { in: ... }`); a 2ª deve já passar (é regressão do comportamento atual).

- [ ] **Step 3: Modificar `lib/campaigns/recipients.ts`**

O arquivo hoje tem a assinatura `fetchCandidateBatch(eventId, skip)` e
`prepareCampaignRecipients(campaignId, eventId)`. Troque as duas assinaturas e o branch
`eventId === null` de `fetchCandidateBatch` por:

```ts
async function fetchCandidateBatch(
  eventId: string | null,
  skip: number,
  athleteUserIds?: string[],
): Promise<CandidateRow[]> {
  if (eventId !== null) {
    const registrations = await db.registration.findMany({
      where: { eventId },
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

  return users.map((u) => ({
    athleteUserId: u.id,
    registrationId: null,
    receivePromotionalMessages: u.receivePromotionalMessages,
    phone: u.athleteProfile?.phone ?? null,
  }));
}
```

E a assinatura de `prepareCampaignRecipients`:

```ts
export async function prepareCampaignRecipients(
  campaignId: string,
  eventId: string | null,
  athleteUserIds?: string[],
): Promise<PrepareRecipientsResult> {
```

E a única chamada a `fetchCandidateBatch` dentro do `while (true)` passa a ser
`await fetchCandidateBatch(eventId, skip, athleteUserIds);` (só acrescenta o 3º argumento — nada
mais no corpo da função muda).

Atualize também o comentário JSDoc da função (logo acima da assinatura) acrescentando: "Aceita
`athleteUserIds` opcional (só usado quando `eventId` é nulo) pra restringir os candidatos a uma
lista explícita de atletas — usado pela seleção manual de destinatários; sem esse parâmetro,
comportamento idêntico ao automático de sempre."

- [ ] **Step 4: Rodar e confirmar que os testes de `recipients.ts` passam**

Rode: `npx vitest run tests/campaigns-recipients.test.ts`.

- [ ] **Step 5: Escrever o teste falhando pra rota `prepare-recipients` aceitar `athleteUserIds`**

Em `tests/admin-campaigns-route.test.ts`, dentro do `describe`
`"POST /api/admin/campaigns/[campaignId]/prepare-recipients"` já existente, adicione (antes do
`});` final do describe):

```ts
  it("repassa athleteUserIds do corpo pra prepareCampaignRecipients (seleção manual)", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign });
    prepareMock.mockResolvedValueOnce({ total: 2, pending: 2, optedOut: 0, invalidPhone: 0, duplicate: 0 });

    const res = await PREPARE(
      makeRequest("POST", { athleteUserIds: ["athlete-1", "athlete-2"] }),
      { params: Promise.resolve({ campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(200);
    expect(prepareMock).toHaveBeenCalledWith("campaign-1", null, ["athlete-1", "athlete-2"]);
  });
```

Confira que `makeRequest` neste arquivo já aceita um segundo argumento `body` (definida no topo do
arquivo) — se aceitar, use como acima; se a assinatura for diferente, adapte a chamada mantendo o
corpo JSON `{ athleteUserIds: [...] }`.

- [ ] **Step 6: Rodar e confirmar que falha**

Rode: `npx vitest run tests/admin-campaigns-route.test.ts`. Esperado: falha (a rota ainda ignora o
corpo).

- [ ] **Step 7: Modificar `app/api/admin/campaigns/[campaignId]/prepare-recipients/route.ts`**

Substitua o conteúdo inteiro por:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { prepareCampaignRecipients } from "@/lib/campaigns/recipients";
import { db } from "@/lib/db";
import { z } from "zod";

const bodySchema = z.object({ athleteUserIds: z.array(z.string()).optional() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkAdminOnlyApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  if (context.campaign.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Só é possível preparar destinatários de campanhas em rascunho" },
      { status: 400 },
    );
  }

  const rawBody = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(rawBody);
  const athleteUserIds = parsed.success ? parsed.data.athleteUserIds : undefined;

  const summary = await prepareCampaignRecipients(campaignId, null, athleteUserIds);

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_RECIPIENTS_PREPARED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: summary,
    },
  });

  return NextResponse.json({ summary });
}
```

- [ ] **Step 8: Rodar e confirmar que passa**

Rode: `npx vitest run tests/admin-campaigns-route.test.ts`.

- [ ] **Step 9: Escrever os testes falhando pro diretório de destinatários (novo arquivo)**

Crie `tests/admin-campaigns-recipients-directory-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET as DIRECTORY } from "@/app/api/admin/campaigns/recipients-directory/route";
import { GET as DIRECTORY_IDS } from "@/app/api/admin/campaigns/recipients-directory/ids/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(url: string) {
  return new Request(url) as any;
}

describe("GET /api/admin/campaigns/recipients-directory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.user.count.mockResolvedValue(0);
  });

  it("lista atletas elegíveis (role ATHLETE, ativo, com consentimento), paginado", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "athlete-1", name: "Maria", email: "maria@example.com", athleteProfile: { phone: "5511999999999" } },
    ]);
    dbMock.user.count.mockResolvedValueOnce(1);

    const res = await DIRECTORY(makeRequest("http://localhost/api/admin/campaigns/recipients-directory"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: "ATHLETE", active: true, receivePromotionalMessages: true },
      }),
    );
    expect(data.rows).toEqual([{ id: "athlete-1", name: "Maria", email: "maria@example.com", phone: "5511999999999" }]);
    expect(data.total).toBe(1);
  });

  it("filtra por busca (nome/e-mail/telefone) quando q é informado", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([]);

    await DIRECTORY(makeRequest("http://localhost/api/admin/campaigns/recipients-directory?q=maria"));

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { name: { contains: "maria", mode: "insensitive" } },
            { email: { contains: "maria", mode: "insensitive" } },
            { athleteProfile: { phone: { contains: "maria", mode: "insensitive" } } },
          ],
        }),
      }),
    );
  });

  it("rejeita ORGANIZER", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await DIRECTORY(makeRequest("http://localhost/api/admin/campaigns/recipients-directory"));

    expect(res.status).toBe(403);
    expect(dbMock.user.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/campaigns/recipients-directory/ids", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("devolve só os ids que batem com o filtro, sem paginação", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([{ id: "athlete-1" }, { id: "athlete-2" }]);

    const res = await DIRECTORY_IDS(makeRequest("http://localhost/api/admin/campaigns/recipients-directory/ids"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ids).toEqual(["athlete-1", "athlete-2"]);
    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: "ATHLETE", active: true, receivePromotionalMessages: true },
        select: { id: true },
      }),
    );
  });
});
```

- [ ] **Step 10: Rodar e confirmar que falha**

Rode: `npx vitest run tests/admin-campaigns-recipients-directory-route.test.ts`. Esperado: falha
(módulos não existem ainda).

- [ ] **Step 11: Criar `app/api/admin/campaigns/recipients-directory/route.ts`**

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

  const searchClause = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { athleteProfile: { phone: { contains: q, mode: "insensitive" as const } } },
        ],
      }
    : {};

  const where = {
    role: "ATHLETE" as const,
    active: true,
    receivePromotionalMessages: true,
    ...searchClause,
  };

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      select: { id: true, name: true, email: true, athleteProfile: { select: { phone: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.user.count({ where }),
  ]);

  return NextResponse.json({
    rows: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.athleteProfile?.phone ?? null })),
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
```

- [ ] **Step 12: Criar `app/api/admin/campaigns/recipients-directory/ids/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("campaigns.view");
  if (!check.allowed) return check.response;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || undefined;

  const searchClause = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { athleteProfile: { phone: { contains: q, mode: "insensitive" as const } } },
        ],
      }
    : {};

  const rows = await db.user.findMany({
    where: { role: "ATHLETE", active: true, receivePromotionalMessages: true, ...searchClause },
    select: { id: true },
  });

  return NextResponse.json({ ids: rows.map((r) => r.id) });
}
```

- [ ] **Step 13: Rodar os testes novos e confirmar que passam**

Rode: `npx vitest run tests/admin-campaigns-recipients-directory-route.test.ts`.

- [ ] **Step 14: Rodar a suíte inteira e confirmar que não há regressão**

Rode: `npx vitest run`.

- [ ] **Step 15: Commit**

```bash
git add lib/campaigns/recipients.ts app/api/admin/campaigns/[campaignId]/prepare-recipients/route.ts app/api/admin/campaigns/recipients-directory tests/campaigns-recipients.test.ts tests/admin-campaigns-route.test.ts tests/admin-campaigns-recipients-directory-route.test.ts
git commit -m "feat: backend de selecao manual de destinatarios (diretorio paginado + athleteUserIds)"
```

---

### Task 2: UI — modal de seleção manual de destinatários

**Files:**
- Modify: `components/campaigns/CampaignsManager.tsx`
- Modify: `app/admin/campanhas/page.tsx` (passa `allowManualRecipients`)

**Interfaces:**
- Consumes: `GET /api/admin/campaigns/recipients-directory` e `.../ids` (Task 1);
  `POST {apiBase}/{campaignId}/prepare-recipients` agora aceita `{ athleteUserIds }` (Task 1).

Não existe suíte de componente pra este arquivo (mesma situação já registrada nas Fases D/E/F) —
verificado por leitura direta do código.

- [ ] **Step 1: Adicionar o prop novo `allowManualRecipients`**

Localize a assinatura da função (linhas ~63-71):

```tsx
export default function CampaignsManager({
  apiBase,
  backHref,
  scopeLabel,
}: {
  apiBase: string;
  backHref: string;
  scopeLabel: string;
}) {
```

Troque por:

```tsx
export default function CampaignsManager({
  apiBase,
  backHref,
  scopeLabel,
  allowManualRecipients = false,
}: {
  apiBase: string;
  backHref: string;
  scopeLabel: string;
  allowManualRecipients?: boolean;
}) {
```

- [ ] **Step 2: Adicionar os states novos**

Logo depois de `const [preparingConfirmId, setPreparingConfirmId] = useState<string | null>(null);`
(linha ~90), adicione:

```tsx
  const [manualSelectId, setManualSelectId] = useState<string | null>(null);
  const [manualSearch, setManualSearch] = useState("");
  const [manualRows, setManualRows] = useState<{ id: string; name: string; email: string; phone: string | null }[]>([]);
  const [manualPage, setManualPage] = useState(1);
  const [manualTotalPages, setManualTotalPages] = useState(1);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualSelectedIds, setManualSelectedIds] = useState<Set<string>>(new Set());
  const [manualPreparing, setManualPreparing] = useState(false);
```

- [ ] **Step 3: Adicionar as funções de manuseio, logo depois de `doPrepareRecipients` (linha ~334)**

```tsx
  async function loadManualDirectory(page: number, q: string) {
    setManualLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set("q", q);
    const res = await fetch(`/api/admin/campaigns/recipients-directory?${params}`);
    setManualLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    setManualRows(data.rows);
    setManualPage(data.page);
    setManualTotalPages(data.totalPages);
  }

  function openManualSelect(campaignId: string) {
    setManualSelectId(campaignId);
    setManualSearch("");
    setManualSelectedIds(new Set());
    void loadManualDirectory(1, "");
  }

  async function selectAllManual() {
    const params = new URLSearchParams();
    if (manualSearch) params.set("q", manualSearch);
    const res = await fetch(`/api/admin/campaigns/recipients-directory/ids?${params}`);
    if (!res.ok) return;
    const data = await res.json();
    setManualSelectedIds(new Set<string>(data.ids));
  }

  function deselectAllManual() {
    setManualSelectedIds(new Set());
  }

  function toggleManualId(id: string) {
    setManualSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmManualPrepare() {
    if (!manualSelectId) return;
    setManualPreparing(true);
    const res = await fetch(`${apiBase}/${manualSelectId}/prepare-recipients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ athleteUserIds: Array.from(manualSelectedIds) }),
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

- [ ] **Step 4: Adicionar o botão "Selecionar destinatários" no card da campanha DRAFT**

Localize o bloco `{campaign.status === "DRAFT" && (...)}` — dentro dele, logo depois do botão
"Preparar destinatários" (que termina em `</button>` antes do `</>`), adicione:

```tsx
                      {allowManualRecipients && (
                        <button
                          onClick={() => openManualSelect(campaign.id)}
                          className="text-green-700 hover:text-green-900 text-sm"
                        >
                          Selecionar destinatários
                        </button>
                      )}
```

- [ ] **Step 5: Adicionar o modal de seleção manual**

Logo antes do `{editId && (` (o modal de edição, linha ~481), adicione:

```tsx
      {manualSelectId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setManualSelectId(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-lg mx-4 space-y-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Selecionar destinatários</h2>
            <div className="flex gap-2">
              <input
                value={manualSearch}
                onChange={(e) => setManualSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadManualDirectory(1, manualSearch);
                }}
                placeholder="Buscar por nome, e-mail ou telefone"
                className="input flex-1 text-sm"
              />
              <button
                type="button"
                onClick={() => void loadManualDirectory(1, manualSearch)}
                className="btn-secondary text-sm px-3"
              >
                Buscar
              </button>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">{manualSelectedIds.size} selecionado(s)</span>
              <div className="flex gap-3">
                <button type="button" onClick={() => void selectAllManual()} className="text-blue-600 hover:text-blue-800">
                  Marcar todos
                </button>
                <button type="button" onClick={deselectAllManual} className="text-gray-600 hover:text-gray-800">
                  Desmarcar todos
                </button>
              </div>
            </div>
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
              {manualLoading ? (
                <p className="p-3 text-sm text-gray-500">Carregando...</p>
              ) : manualRows.length === 0 ? (
                <p className="p-3 text-sm text-gray-500">Nenhum atleta encontrado.</p>
              ) : (
                manualRows.map((row) => (
                  <label key={row.id} className="flex items-center gap-2 p-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={manualSelectedIds.has(row.id)} onChange={() => toggleManualId(row.id)} />
                    <span className="flex-1">
                      {row.name} <span className="text-gray-400">— {row.phone ?? "sem telefone"}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
            {manualTotalPages > 1 && (
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  disabled={manualPage <= 1}
                  onClick={() => void loadManualDirectory(manualPage - 1, manualSearch)}
                  className="btn-secondary text-sm px-3 disabled:opacity-50"
                >
                  ‹ Anterior
                </button>
                <span className="text-gray-500">
                  Página {manualPage} de {manualTotalPages}
                </span>
                <button
                  type="button"
                  disabled={manualPage >= manualTotalPages}
                  onClick={() => void loadManualDirectory(manualPage + 1, manualSearch)}
                  className="btn-secondary text-sm px-3 disabled:opacity-50"
                >
                  Próxima ›
                </button>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setManualSelectId(null)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmManualPrepare()}
                disabled={manualPreparing || manualSelectedIds.size === 0}
                className="btn-primary text-sm px-4 disabled:opacity-50"
              >
                {manualPreparing ? "Preparando..." : `Preparar com ${manualSelectedIds.size} destinatário(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

```

Este modal é aberto a partir da LISTA de campanhas (não de dentro do modal de edição) — mesmo
padrão seguro já usado por `cancelingId`/`preparingConfirmId` (sem risco de colisão de z-index com
o modal de edição, que só abre a partir de "Editar").

- [ ] **Step 6: Atualizar `app/admin/campanhas/page.tsx`**

Troque a chamada de `<CampaignsManager .../>` por:

```tsx
    <CampaignsManager
      apiBase="/api/admin/campaigns"
      backHref="/admin"
      scopeLabel="pra toda a base de atletas da plataforma"
      allowManualRecipients
    />
```

(A Task 8 vai reestruturar este arquivo pra ter abas — se essa task já tiver rodado antes desta,
adicione `allowManualRecipients` na chamada de `CampaignsManager` onde quer que ela esteja, sem
duplicar a prop.)

- [ ] **Step 7: Rodar `tsc --noEmit` e a suíte inteira**

Rode: `npx tsc --noEmit -p tsconfig.json` (esperado: limpo) e `npx vitest run` (esperado: nenhuma
regressão).

- [ ] **Step 8: Commit**

```bash
git add components/campaigns/CampaignsManager.tsx app/admin/campanhas/page.tsx
git commit -m "feat: UI de selecao manual de destinatarios (busca, paginacao, marcar/desmarcar todos)"
```

---

### Task 3: Backend — envio avulso pra número específico

**Files:**
- Create: `app/api/admin/campaigns/[campaignId]/send-to-number/route.ts`
- Test: `tests/admin-campaigns-compose-route.test.ts` (adicionar describe)

**Interfaces:**
- Consumes: `normalizePhoneForWhatsApp`/`isValidWhatsAppPhone` de `@/lib/whatsapp` (já existem, sem
  mudança de assinatura).
- Produces: `POST /api/admin/campaigns/[campaignId]/send-to-number` com corpo `{ phone: string }`
  → `{ ok: true }` ou `{ error }` — usado pela Task 4 (UI).

- [ ] **Step 1: Escrever os testes falhando**

Em `tests/admin-campaigns-compose-route.test.ts`, adicione o import no topo (junto dos já
existentes):

```ts
import { POST as SEND_TO_NUMBER } from "@/app/api/admin/campaigns/[campaignId]/send-to-number/route";
```

E adicione este `describe` ao final do arquivo:

```ts
describe("POST /api/admin/campaigns/[campaignId]/send-to-number", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.findFirst.mockResolvedValue({ ...platformDraftCampaign });
  });

  function makeRequest(body: unknown) {
    return new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as any;
  }

  it("normaliza e envia pro número informado (sem +55, assume Brasil)", async () => {
    const res = await SEND_TO_NUMBER(makeRequest({ phone: "11988888888" }), {
      params: Promise.resolve({ campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledWith("5511988888888", expect.stringContaining("RODAPE_TESTE"), "CAMPAIGN_MESSAGE");
  });

  it("aceita o número já com +55", async () => {
    const res = await SEND_TO_NUMBER(makeRequest({ phone: "+5511988888888" }), {
      params: Promise.resolve({ campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledWith("5511988888888", expect.any(String), "CAMPAIGN_MESSAGE");
  });

  it("rejeita telefone inválido", async () => {
    const res = await SEND_TO_NUMBER(makeRequest({ phone: "123" }), {
      params: Promise.resolve({ campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejeita corpo sem telefone", async () => {
    const res = await SEND_TO_NUMBER(makeRequest({}), {
      params: Promise.resolve({ campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Rode: `npx vitest run tests/admin-campaigns-compose-route.test.ts`.

- [ ] **Step 3: Criar `app/api/admin/campaigns/[campaignId]/send-to-number/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { renderTemplate } from "@/lib/templates/render";
import { SAMPLE_VALUES } from "@/lib/templates/variables";
import {
  sendWhatsAppMessage,
  buildPreferencesFooterText,
  normalizePhoneForWhatsApp,
  isValidWhatsAppPhone,
} from "@/lib/whatsapp";
import { z } from "zod";

const bodySchema = z.object({ phone: z.string().trim().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkAdminOnlyApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  const rawBody = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Telefone é obrigatório" }, { status: 400 });
  }

  const normalized = normalizePhoneForWhatsApp(parsed.data.phone);
  if (!isValidWhatsAppPhone(normalized)) {
    return NextResponse.json({ error: "Telefone inválido" }, { status: 400 });
  }

  const body = renderTemplate(context.campaign.messageBody, SAMPLE_VALUES, "WHATSAPP") + buildPreferencesFooterText();
  await sendWhatsAppMessage(normalized, body, "CAMPAIGN_MESSAGE");

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Rode: `npx vitest run tests/admin-campaigns-compose-route.test.ts`.

- [ ] **Step 5: Rodar a suíte inteira**

Rode: `npx vitest run`.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/campaigns/[campaignId]/send-to-number tests/admin-campaigns-compose-route.test.ts
git commit -m "feat: envio avulso de campanha pra numero especifico digitado"
```

---

### Task 4: UI — enviar para número específico

**Files:**
- Modify: `components/campaigns/CampaignsManager.tsx`

**Interfaces:**
- Consumes: `POST {apiBase}/{campaignId}/send-to-number` (Task 3).

Sem suíte de componente pra este arquivo — verificado por leitura direta do código.

- [ ] **Step 1: Adicionar os states novos**

Logo depois de `const [testSendMessage, setTestSendMessage] = useState<string | null>(null);`
(perto da linha ~98), adicione:

```tsx
  const [sendToNumberInput, setSendToNumberInput] = useState("");
  const [sendingToNumber, setSendingToNumber] = useState(false);
  const [sendToNumberMessage, setSendToNumberMessage] = useState<string | null>(null);
  const [confirmingSendToNumber, setConfirmingSendToNumber] = useState(false);
```

- [ ] **Step 2: Resetar esses states em `openEdit`**

Localize a função `openEdit` (procura por `function openEdit(campaign: Campaign) {`). Ela já reseta
`setPreviewResult(null)`, `setTestSendMessage(null)`, etc. Adicione, no mesmo bloco:

```tsx
    setSendToNumberInput("");
    setSendToNumberMessage(null);
    setConfirmingSendToNumber(false);
```

- [ ] **Step 3: Adicionar a função `doSendToNumber`, logo depois de `doTestSend`**

```tsx
  async function doSendToNumber() {
    if (!editId) return;
    setSendingToNumber(true);
    setActionError(null);
    setSendToNumberMessage(null);
    const res = await fetch(`${apiBase}/${editId}/send-to-number`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: sendToNumberInput }),
    });
    setSendingToNumber(false);
    setConfirmingSendToNumber(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setActionError(typeof data.error === "string" ? data.error : "Erro ao enviar pro número informado");
      return;
    }
    setSendToNumberMessage(`Mensagem enviada para ${sendToNumberInput}.`);
  }
```

- [ ] **Step 4: Adicionar o `ConfirmModal` de confirmação**

Logo depois do `ConfirmModal` de `resumingConfirmId` (procure por `title="Retomar campanha"` e
localize o fechamento `/>` desse bloco), adicione:

```tsx
      <ConfirmModal
        open={confirmingSendToNumber}
        title="Enviar para número específico"
        message={`Isso vai enviar uma mensagem de WhatsApp real e imediata para ${sendToNumberInput}, sem passar pela fila de campanha. Essa ação não pode ser desfeita. Deseja continuar?`}
        confirmLabel="Enviar"
        tone="danger"
        loading={sendingToNumber}
        onConfirm={doSendToNumber}
        onCancel={() => setConfirmingSendToNumber(false)}
      />
```

- [ ] **Step 5: Adicionar o campo + botão no modal de edição**

Localize o bloco de botões "Visualizar"/"Enviar teste" (procure por
`{testSendLoading ? "Enviando..." : "Enviar teste"}` e o `</button>` + `</div>` que fecham esse
`<div className="flex gap-2">`). Logo depois desse `</div>`, adicione:

```tsx
            <div className="flex gap-2 items-center">
              <input
                value={sendToNumberInput}
                onChange={(e) => setSendToNumberInput(e.target.value)}
                placeholder="Telefone (ex: 11988888888)"
                className="input text-sm flex-1"
              />
              <button
                type="button"
                onClick={() => setConfirmingSendToNumber(true)}
                disabled={sendingToNumber || !sendToNumberInput.trim()}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                {sendingToNumber ? "Enviando..." : "Enviar para este número"}
              </button>
            </div>
            {sendToNumberMessage && <p className="text-sm text-green-700 dark:text-green-400">{sendToNumberMessage}</p>}
```

- [ ] **Step 6: Rodar `tsc --noEmit` e a suíte inteira**

Rode: `npx tsc --noEmit -p tsconfig.json` e `npx vitest run`.

- [ ] **Step 7: Commit**

```bash
git add components/campaigns/CampaignsManager.tsx
git commit -m "feat: UI de envio avulso para numero especifico"
```

---

### Task 5: Backend — excluir campanha sem envio

**Files:**
- Modify: `tests/setup.ts` (adicionar `campaignRecipient`/`campaign` ao mock de `$transaction`)
- Modify: `app/api/admin/campaigns/[campaignId]/route.ts`
- Modify: `app/api/events/[id]/campaigns/[campaignId]/route.ts`
- Test: `tests/admin-campaigns-route.test.ts` (adicionar describe)
- Test: `tests/events-campaigns-route.test.ts` (adicionar describe)

**Interfaces:**
- Produces: `DELETE {apiBase}/{campaignId}` → `{ ok: true }` (200) ou `{ error }` (400) — usado
  pela Task 6 (UI).

**Passo prévio — confirme que o mock de `$transaction` em `tests/setup.ts` já expõe
`campaignRecipient`/`campaign`.** Hoje o objeto `tx` passado pra função de `$transaction` (dentro
de `db: { ..., $transaction: vi.fn(async (fn) => fn({ ... })) }`) **não tem** `campaignRecipient`
nem `campaign` — sem isso, `tx.campaignRecipient.deleteMany`/`tx.campaign.delete` quebrariam com
"Cannot read properties of undefined" em qualquer teste que exercite a rota de excluir.

- [ ] **Step 1: Adicionar `campaignRecipient`/`campaign` ao objeto `tx` do mock de `$transaction`**

Localize, em `tests/setup.ts`, o bloco:

```ts
    $transaction: vi.fn(async (fn: any) => fn({
      user: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      ticketBatch: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      order: { count: vi.fn() },
      registration: { count: vi.fn() },
      coupon: { findFirst: vi.fn(), update: vi.fn() },
      fileAsset: { deleteMany: vi.fn(), findMany: vi.fn() },
      platformSetting: { findUnique: vi.fn(), upsert: vi.fn() },
      auditLog: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
      event: { delete: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      athleteProfile: { upsert: vi.fn() },
    })),
```

Adicione duas linhas dentro do objeto passado pra `fn(...)`, antes do `athleteProfile`:

```ts
      campaignRecipient: { deleteMany: vi.fn() },
      campaign: { delete: vi.fn() },
```

- [ ] **Step 2: Escrever os testes falhando pra rota admin**

Em `tests/admin-campaigns-route.test.ts`, adicione o import no topo (junto dos já existentes):

```ts
import { DELETE as DELETE_CAMPAIGN } from "@/app/api/admin/campaigns/[campaignId]/route";
```

E adicione este `describe` ao final do arquivo:

```ts
describe("DELETE /api/admin/campaigns/[campaignId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("exclui uma campanha sem nenhum envio real", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign });
    dbMock.campaignRecipient.count.mockResolvedValueOnce(0);

    const res = await DELETE_CAMPAIGN(makeRequest("DELETE"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CAMPAIGN_DELETED" }) }),
    );
  });

  it("rejeita excluir uma campanha que já teve envios reais", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign, status: "RUNNING" });
    dbMock.campaignRecipient.count.mockResolvedValueOnce(3);

    const res = await DELETE_CAMPAIGN(makeRequest("DELETE"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(400);
  });

  it("rejeita ORGANIZER", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await DELETE_CAMPAIGN(makeRequest("DELETE"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Rode: `npx vitest run tests/admin-campaigns-route.test.ts`.

- [ ] **Step 4: Adicionar `DELETE` a `app/api/admin/campaigns/[campaignId]/route.ts`**

Ao final do arquivo (depois do `export async function PATCH(...) { ... }` já existente),
adicione:

```ts

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkAdminOnlyApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  const sentCount = await db.campaignRecipient.count({
    where: { campaignId, status: { in: ["SENT", "DELIVERED", "READ", "FAILED"] } },
  });
  if (sentCount > 0) {
    return NextResponse.json(
      { error: "Não é possível excluir uma campanha que já teve envios reais" },
      { status: 400 },
    );
  }

  await db.$transaction(async (tx) => {
    await tx.campaignRecipient.deleteMany({ where: { campaignId } });
    await tx.campaign.delete({ where: { id: campaignId } });
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_DELETED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: {},
    },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Rode: `npx vitest run tests/admin-campaigns-route.test.ts`.

- [ ] **Step 6: Escrever os testes falhando pra rota event-scoped**

Em `tests/events-campaigns-route.test.ts`, adicione o import no topo (junto dos já existentes):

```ts
import { DELETE as DELETE_CAMPAIGN } from "@/app/api/events/[id]/campaigns/[campaignId]/route";
```

E adicione este `describe` ao final do arquivo:

```ts
describe("DELETE /api/events/[id]/campaigns/[campaignId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
  });

  it("exclui uma campanha sem nenhum envio real", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign });
    dbMock.campaignRecipient.count.mockResolvedValueOnce(0);

    const res = await DELETE_CAMPAIGN(makeRequest("DELETE"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) });

    expect(res.status).toBe(200);
  });

  it("rejeita excluir uma campanha que já teve envios reais", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign, status: "COMPLETED" });
    dbMock.campaignRecipient.count.mockResolvedValueOnce(5);

    const res = await DELETE_CAMPAIGN(makeRequest("DELETE"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 7: Rodar e confirmar que falha**

Rode: `npx vitest run tests/events-campaigns-route.test.ts`.

- [ ] **Step 8: Adicionar `DELETE` a `app/api/events/[id]/campaigns/[campaignId]/route.ts`**

Ao final do arquivo, adicione:

```ts

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  const sentCount = await db.campaignRecipient.count({
    where: { campaignId, status: { in: ["SENT", "DELIVERED", "READ", "FAILED"] } },
  });
  if (sentCount > 0) {
    return NextResponse.json(
      { error: "Não é possível excluir uma campanha que já teve envios reais" },
      { status: 400 },
    );
  }

  await db.$transaction(async (tx) => {
    await tx.campaignRecipient.deleteMany({ where: { campaignId } });
    await tx.campaign.delete({ where: { id: campaignId } });
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_DELETED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: {},
    },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 9: Rodar e confirmar que passa**

Rode: `npx vitest run tests/events-campaigns-route.test.ts`.

- [ ] **Step 10: Rodar a suíte inteira**

Rode: `npx vitest run`.

- [ ] **Step 11: Commit**

```bash
git add tests/setup.ts app/api/admin/campaigns/[campaignId]/route.ts app/api/events/[id]/campaigns/[campaignId]/route.ts tests/admin-campaigns-route.test.ts tests/events-campaigns-route.test.ts
git commit -m "feat: rotas DELETE para excluir campanha sem envio real (evento + admin)"
```

---

### Task 6: UI — botão Excluir

**Files:**
- Modify: `components/campaigns/CampaignsManager.tsx`

**Interfaces:**
- Consumes: `DELETE {apiBase}/{campaignId}` (Task 5).

Sem suíte de componente pra este arquivo — verificado por leitura direta do código.

- [ ] **Step 1: Adicionar os states novos**

Logo depois de `const [resuming, setResuming] = useState(false);` (perto da linha ~87), adicione:

```tsx
  const [deletingConfirmId, setDeletingConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
```

- [ ] **Step 2: Adicionar a função `canDeleteCampaign` e `doDelete`**

Logo depois da função `summaryFromGrouped` (que já existe no topo do arquivo, fora do componente),
NÃO mova nada — em vez disso, adicione estas duas funções DENTRO do componente, logo depois de
`doCancel` (procure por `async function doCancel() {` e o `}` que a fecha):

```tsx
  function canDeleteCampaign(campaignId: string): boolean {
    const summary = recipientSummaries[campaignId];
    if (!summary) return true;
    return (summary.sent ?? 0) + (summary.delivered ?? 0) + (summary.read ?? 0) + (summary.failed ?? 0) === 0;
  }

  async function doDelete() {
    if (!deletingConfirmId) return;
    setDeleting(true);
    const res = await fetch(`${apiBase}/${deletingConfirmId}`, { method: "DELETE" });
    setDeleting(false);
    setDeletingConfirmId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Erro ao excluir campanha");
      return;
    }
    await reload();
  }
```

- [ ] **Step 3: Adicionar o `ConfirmModal` de exclusão**

Logo depois do `ConfirmModal` de `cancelingId` (o primeiro do arquivo, título "Cancelar
campanha"), adicione:

```tsx
      <ConfirmModal
        open={!!deletingConfirmId}
        title="Excluir campanha"
        message="Isso vai apagar esta campanha permanentemente — diferente de cancelar, que só muda o status. Essa ação não pode ser desfeita. Deseja continuar?"
        confirmLabel="Excluir"
        tone="danger"
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setDeletingConfirmId(null)}
      />
```

- [ ] **Step 4: Adicionar o botão "Excluir" no card da campanha**

Localize o botão "Duplicar" no card da campanha (`onClick={() => void doDuplicate(campaign.id)}`).
Logo depois do `</button>` que fecha "Duplicar", adicione:

```tsx
                  {canDeleteCampaign(campaign.id) && (
                    <button onClick={() => setDeletingConfirmId(campaign.id)} className="text-red-700 hover:text-red-900 text-sm">
                      Excluir
                    </button>
                  )}
```

- [ ] **Step 5: Rodar `tsc --noEmit` e a suíte inteira**

Rode: `npx tsc --noEmit -p tsconfig.json` e `npx vitest run`.

- [ ] **Step 6: Commit**

```bash
git add components/campaigns/CampaignsManager.tsx
git commit -m "feat: botao Excluir para campanha sem envio real"
```

---

### Task 7: Preview ao vivo enquanto digita

**Files:**
- Modify: `components/campaigns/CampaignsManager.tsx`

**Interfaces:**
- Consumes: `renderTemplate` (`@/lib/templates/render`) e `SAMPLE_VALUES`
  (`@/lib/templates/variables`) — ambos puros, sem import de servidor (confirmado lendo os dois
  arquivos), seguros num componente `"use client"`.

Sem suíte de componente pra este arquivo — verificado por leitura direta do código.

- [ ] **Step 1: Adicionar os imports novos no topo do arquivo**

Logo abaixo de `import ErrorModal from "@/components/ui/ErrorModal";`, adicione:

```tsx
import { renderTemplate } from "@/lib/templates/render";
import { SAMPLE_VALUES } from "@/lib/templates/variables";
```

- [ ] **Step 2: Alargar o modal de edição**

Localize a `<form onSubmit={saveEdit} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl
border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4 space-y-4" ...>`. Troque
`max-w-sm` por `max-w-2xl` (só essa classe muda, o resto da string continua igual).

- [ ] **Step 3: Envolver o bloco "Mensagem" num grid de 2 colunas com o preview ao lado**

Localize o bloco (dentro do form de edição):

```tsx
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem</label>
              <textarea
                required
                ref={editBodyRef}
                value={editForm.messageBody}
                onChange={(e) => setEditForm({ ...editForm, messageBody: e.target.value })}
                className="input w-full"
                rows={4}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    insertVariable(e.target.value, editBodyRef, editForm.messageBody, (v) => setEditForm({ ...editForm, messageBody: v }));
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
              <span className="text-xs text-gray-400">{editForm.messageBody.length} caracteres</span>
            </div>
```

Substitua pelos dois blocos abaixo, um grid de 2 colunas (coluna 1 = tudo que já existia, coluna 2
= o preview novo):

```tsx
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem</label>
                  <textarea
                    required
                    ref={editBodyRef}
                    value={editForm.messageBody}
                    onChange={(e) => setEditForm({ ...editForm, messageBody: e.target.value })}
                    className="input w-full"
                    rows={6}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        insertVariable(e.target.value, editBodyRef, editForm.messageBody, (v) => setEditForm({ ...editForm, messageBody: v }));
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
                  <span className="text-xs text-gray-400">{editForm.messageBody.length} caracteres</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pré-visualização ao vivo</label>
                <p className="whitespace-pre-wrap text-sm bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 min-h-[9rem]">
                  {renderTemplate(editForm.messageBody, SAMPLE_VALUES, "WHATSAPP") || "Digite a mensagem para ver a pré-visualização..."}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Usa dados de amostra — o botão "Visualizar" abaixo mostra o texto exato com o rodapé de preferências.
                </p>
              </div>
            </div>
```

- [ ] **Step 4: Rodar `tsc --noEmit` e a suíte inteira**

Rode: `npx tsc --noEmit -p tsconfig.json` e `npx vitest run`.

- [ ] **Step 5: Commit**

```bash
git add components/campaigns/CampaignsManager.tsx
git commit -m "feat: preview ao vivo da mensagem de campanha ao lado do textarea"
```

---

### Task 8: Aba de atletas que optaram por não receber

**Files:**
- Create: `lib/campaigns/opted-out.ts`
- Modify: `app/admin/campanhas/page.tsx` (reestrutura pra ter abas — server component)
- Test (nova): `tests/lib-campaigns-opted-out.test.ts`

**Interfaces:**
- Produces: `listOptedOutAthletes({ q?, page?, pageSize? })` — consumida só pela própria página
  desta task, nenhuma outra task depende disso.

Este arquivo (`app/admin/campanhas/page.tsx`) hoje é um componente cliente simples. Esta task
reescreve ele inteiro como um componente de servidor com abas — se a Task 2 já rodou antes e já
adicionou `allowManualRecipients` na chamada de `CampaignsManager`, preserve essa prop na
reescrita abaixo (ela já está incluída no código given).

- [ ] **Step 1: Escrever os testes falhando pra `listOptedOutAthletes`**

Crie `tests/lib-campaigns-opted-out.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listOptedOutAthletes } from "@/lib/campaigns/opted-out";

const dbMock = db as any;

describe("listOptedOutAthletes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.user.count.mockResolvedValue(0);
    dbMock.user.findMany.mockResolvedValue([]);
  });

  it("filtra por role ATHLETE e receivePromotionalMessages false", async () => {
    await listOptedOutAthletes({});

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: "ATHLETE", receivePromotionalMessages: false },
      }),
    );
  });

  it("aplica busca por nome/e-mail/telefone quando q é informado", async () => {
    await listOptedOutAthletes({ q: "joão" });

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { name: { contains: "joão", mode: "insensitive" } },
            { email: { contains: "joão", mode: "insensitive" } },
            { athleteProfile: { phone: { contains: "joão", mode: "insensitive" } } },
          ],
        }),
      }),
    );
  });

  it("pagina corretamente (page 2, pageSize 20)", async () => {
    dbMock.user.count.mockResolvedValueOnce(45);
    dbMock.user.findMany.mockResolvedValueOnce([]);

    const result = await listOptedOutAthletes({ page: 2 });

    expect(dbMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(2);
  });

  it("mapeia phone a partir de athleteProfile", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "u1", name: "João", email: "joao@example.com", athleteProfile: { phone: "5511999999999" } },
    ]);

    const result = await listOptedOutAthletes({});

    expect(result.rows).toEqual([{ id: "u1", name: "João", email: "joao@example.com", phone: "5511999999999" }]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Rode: `npx vitest run tests/lib-campaigns-opted-out.test.ts`. Esperado: falha (módulo não existe).

- [ ] **Step 3: Criar `lib/campaigns/opted-out.ts`**

```ts
import { db } from "@/lib/db";

export interface OptedOutAthleteRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

export interface OptedOutAthletesResult {
  rows: OptedOutAthleteRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Lista, paginada e pesquisável, dos atletas que optaram por NÃO receber mensagens promocionais
 * (`receivePromotionalMessages: false`) — usada pela aba de opt-outs em /admin/campanhas, pra o
 * operador ver quem está fora do alcance de campanhas automáticas/manuais sem precisar consultar
 * o banco diretamente. */
export async function listOptedOutAthletes(params: {
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<OptedOutAthletesResult> {
  const { q, page = 1, pageSize = 20 } = params;

  const searchClause = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { athleteProfile: { phone: { contains: q, mode: "insensitive" as const } } },
        ],
      }
    : {};

  const where = { role: "ATHLETE" as const, receivePromotionalMessages: false, ...searchClause };

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      select: { id: true, name: true, email: true, athleteProfile: { select: { phone: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.user.count({ where }),
  ]);

  return {
    rows: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.athleteProfile?.phone ?? null })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Rode: `npx vitest run tests/lib-campaigns-opted-out.test.ts`.

- [ ] **Step 5: Reescrever `app/admin/campanhas/page.tsx` com abas**

Substitua o conteúdo inteiro do arquivo por:

```tsx
import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { listOptedOutAthletes } from "@/lib/campaigns/opted-out";
import CampaignsManager from "@/components/campaigns/CampaignsManager";

export const metadata: Metadata = { title: "Campanhas — Admin" };
export const dynamic = "force-dynamic";

/** Janela de páginas ao redor da atual (+ primeira/última), com "..." nos vãos — mesmo helper de
 * app/admin/mensagens/page.tsx, duplicado aqui (arquivos de página server-side deste projeto não
 * compartilham esse utilitário hoje). */
function getPaginationRange(current: number, total: number): (number | "...")[] {
  const siblingCount = 1;
  const totalVisible = siblingCount * 2 + 5;
  if (total <= totalVisible) return Array.from({ length: total }, (_, i) => i + 1);

  const leftSibling = Math.max(current - siblingCount, 1);
  const rightSibling = Math.min(current + siblingCount, total);
  const showLeftDots = leftSibling > 2;
  const showRightDots = rightSibling < total - 1;

  if (!showLeftDots && showRightDots) {
    const leftRange = Array.from({ length: 3 + siblingCount * 2 }, (_, i) => i + 1);
    return [...leftRange, "...", total];
  }
  if (showLeftDots && !showRightDots) {
    const rightCount = 3 + siblingCount * 2;
    const rightRange = Array.from({ length: rightCount }, (_, i) => total - rightCount + i + 1);
    return [1, "...", ...rightRange];
  }
  const middleRange = Array.from({ length: rightSibling - leftSibling + 1 }, (_, i) => leftSibling + i);
  return [1, "...", ...middleRange, "...", total];
}

interface SearchParams {
  tab?: string;
  q?: string;
  page?: string;
}

function CampaignTabs({ active }: { active: "campanhas" | "optouts" }) {
  const tabClass = (isActive: boolean) =>
    `px-4 py-2 text-sm ${
      isActive
        ? "border-b-2 border-primary-600 text-primary-600 font-medium"
        : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
    }`;
  return (
    <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
      <Link href="/admin/campanhas" className={tabClass(active === "campanhas")}>
        Campanhas
      </Link>
      <Link href="/admin/campanhas?tab=optouts" className={tabClass(active === "optouts")}>
        Opt-outs
      </Link>
    </div>
  );
}

export default async function AdminPlatformCampaignsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("campaigns.view");
  const params = await searchParams;
  const tab = params.tab === "optouts" ? "optouts" : "campanhas";

  if (tab === "campanhas") {
    return (
      <div className="space-y-4">
        <CampaignTabs active="campanhas" />
        <CampaignsManager
          apiBase="/api/admin/campaigns"
          backHref="/admin"
          scopeLabel="pra toda a base de atletas da plataforma"
          allowManualRecipients
        />
      </div>
    );
  }

  const q = params.q?.trim() || undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const { rows, total, totalPages } = await listOptedOutAthletes({ q, page });

  const pageHref = (p: number) => {
    const query = new URLSearchParams({ tab: "optouts" });
    if (q) query.set("q", q);
    query.set("page", String(p));
    return `/admin/campanhas?${query.toString()}`;
  };
  const pagerButtonClass = (disabledOrInactive: boolean, active = false) =>
    `text-sm px-3 py-1.5 rounded-lg border transition-colors ${
      active
        ? "bg-primary-600 text-white border-primary-600"
        : disabledOrInactive
          ? "pointer-events-none border-gray-200 text-gray-300 dark:border-gray-700 dark:text-gray-600"
          : "border-gray-300 hover:border-primary-400 hover:text-primary-600 dark:border-gray-600 dark:text-gray-200 dark:hover:border-primary-500"
    }`;

  return (
    <div className="space-y-4">
      <CampaignTabs active="optouts" />
      <div>
        <h1 className="text-xl font-bold">Atletas que optaram por não receber mensagens</h1>
        <p className="text-sm text-gray-500">{total} atleta(s) encontrado(s)</p>
      </div>

      <form method="GET" className="card flex gap-2">
        <input type="hidden" name="tab" value="optouts" />
        <input name="q" defaultValue={q ?? ""} placeholder="Nome, e-mail ou telefone" className="input-field text-sm py-1.5 flex-1" />
        <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
        <Link href="/admin/campanhas?tab=optouts" className="btn-secondary py-1.5 px-4 text-sm">Limpar</Link>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100 dark:border-gray-800">
              <th className="py-2 pr-4">Nome</th>
              <th className="py-2 pr-4">E-mail</th>
              <th className="py-2 pr-4">Telefone</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-6 text-center text-gray-400">Nenhum atleta encontrado.</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 dark:border-gray-900">
                  <td className="py-2 pr-4">{r.name}</td>
                  <td className="py-2 pr-4">{r.email}</td>
                  <td className="py-2 pr-4">{r.phone ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-end">
          <nav className="flex items-center justify-end gap-1.5 flex-wrap" aria-label="Paginação">
            <Link href={pageHref(Math.max(1, page - 1))} aria-disabled={page === 1} className={pagerButtonClass(page === 1)}>
              ‹ Anterior
            </Link>
            {getPaginationRange(page, totalPages).map((p, i) =>
              p === "..." ? (
                <span key={`ellipsis-${i}`} className="px-1 text-sm text-gray-400 select-none">…</span>
              ) : (
                <Link key={p} href={pageHref(p)} className={pagerButtonClass(false, p === page)}>{p}</Link>
              ),
            )}
            <Link
              href={pageHref(Math.min(totalPages, page + 1))}
              aria-disabled={page === totalPages}
              className={pagerButtonClass(page === totalPages)}
            >
              Próxima ›
            </Link>
          </nav>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Rodar `tsc --noEmit` e a suíte inteira**

Rode: `npx tsc --noEmit -p tsconfig.json` e `npx vitest run`.

- [ ] **Step 7: Commit**

```bash
git add lib/campaigns/opted-out.ts app/admin/campanhas/page.tsx tests/lib-campaigns-opted-out.test.ts
git commit -m "feat: aba de atletas que optaram por nao receber mensagens em /admin/campanhas"
```
