# Página pública de resultados (PDFs) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao organizador um caminho por PDFs para publicar resultados de corrida (nome de exibição + upload), renderizados como botões numa página pública com o banner do evento, sem remover o import de CSV atual; e um botão "Resultado" na página pública do evento.

**Architecture:** Novo model `EventResultFile` (1‑N com `Event`) + campo `Event.resultsSubtitle`. Upload reaproveita `POST /api/upload` (novo purpose `result_pdf`, PDF já suportado) e o componente `FileUploadInput`. CRUD via `POST/PATCH /api/events/[id]/result-files` e `DELETE /api/events/[id]/result-files/[fileId]`, todos sob a permissão `results.import` com checagem anti‑IDOR por `organizerId`. A página pública de resultados passa a renderizar `RESULTADOS` + banner + subtítulo + grid de botões (um por PDF) e mantém a tabela do CSV abaixo quando há import publicado. A página pública do evento ganha o botão "Resultado" quando `eventHasResults` (≥1 PDF ou ≥1 `ResultImport` publicado).

**Tech Stack:** Next.js 16 (App Router, Server Components), Prisma 5 + PostgreSQL, NextAuth v5, Vitest, Tailwind, zod, Supabase Storage (bucket público via `/api/upload`).

**Spec:** `docs/superpowers/specs/2026-08-31-pagina-resultados-pdf-design.md`

## Global Constraints

- Nunca usar `alert()`/`confirm()`/`window.prompt()` — usar `components/ui/ConfirmModal.tsx` / `components/ui/ErrorModal.tsx` (`CLAUDE.md`).
- Migração de schema **aditiva**; aplicada no deploy com `prisma db push` (NUNCA `prisma migrate deploy` — `_prisma_migrations` de produção está congelada). O arquivo em `prisma/migrations/` é gitignored → `git add -f`.
- Permissão de toda a gestão de resultados (PDFs + subtítulo): `results.import`.
- RBAC anti‑IDOR: organizador só mexe em resultado de evento do próprio `organizerId` — `resolveActingScope(session).organizerId` + `event.organizerId`; admin titular via `resolveActingScope(...).actingAsAdmin` (usa `db.event.findUnique`).
- Sem teste de UI (convenção do projeto). Gate por task quando indicado; gate final: `npx vitest run` + `npx tsc --noEmit` + `npm run build`.
- `label` de um resultado: 1–80 chars. `resultsSubtitle`: até 120 chars, string vazia → `null`.
- Ordenação dos botões: `createdAt` ascendente (ordem de cadastro).
- Ao excluir um `EventResultFile`, **não** apagar o arquivo do bucket (mesma convenção de banner/regulamento — documentado como aceitável).

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `prisma/schema.prisma` | model `EventResultFile`; `Event.resultsSubtitle`; relações inversas em `Event` e `User` |
| `prisma/migrations/20260831010000_event_result_files/migration.sql` | SQL aditivo (tabela + coluna) |
| `app/api/upload/route.ts` | adiciona `"result_pdf"` a `ALLOWED_PURPOSES` |
| `components/organizer/FileUploadInput.tsx` | adiciona `"result_pdf"` ao tipo da prop `purpose` |
| `lib/events/has-results.ts` (novo) | helper puro `eventHasResults` |
| `app/api/events/[id]/result-files/route.ts` (novo) | `POST` cria `EventResultFile`; `PATCH` grava `resultsSubtitle` |
| `app/api/events/[id]/result-files/[fileId]/route.ts` (novo) | `DELETE` remove um `EventResultFile` |
| `components/organizer/EventResultFilesManager.tsx` (novo) | UI client: subtítulo + lista/adicionar/excluir PDFs |
| `app/organizador/eventos/[id]/resultados/page.tsx` | carrega dados do evento, renderiza o manager + a seção de CSV |
| `app/organizador/eventos/[id]/resultados/ResultadosClient.tsx` | perde o "chrome" externo (back-link/título) — vira só a seção de import de CSV |
| `app/(public)/eventos/[slug]/resultados/page.tsx` | RESULTADOS + banner + subtítulo + grid de botões + tabela do CSV |
| `lib/events.ts` | `getEventBySlug` passa a incluir `resultFiles`/`resultImports` (para o botão) |
| `app/(public)/eventos/[slug]/page.tsx` | botão "🏆 Resultado" no card "Inscrições" |
| `components/organizer/EventResultFilesManager.tsx` | (ver acima) |
| Testes | `tests/lib-event-has-results.test.ts`, `tests/event-result-files-route.test.ts`, `tests/upload-route.test.ts` (existente, +1 caso) |

---

## Task 1: Schema — `EventResultFile` + `Event.resultsSubtitle`

**Files:**
- Modify: `prisma/schema.prisma` (model `Event`, model `User`, novo model `EventResultFile`)
- Create: `prisma/migrations/20260831010000_event_result_files/migration.sql`
- Test: `tests/schema-event-result-files.test.ts`

**Interfaces:**
- Produces: model Prisma `EventResultFile { id, eventId, label, fileUrl, fileName, createdById?, createdAt, event, createdBy? }`; `Event.resultsSubtitle: String?`; `Event.resultFiles: EventResultFile[]`; `User.createdResultFiles: EventResultFile[]`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/schema-event-result-files.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

describe("schema EventResultFile", () => {
  const models = Prisma.dmmf.datamodel.models;

  it("EventResultFile existe com os campos certos", () => {
    const m = models.find((x) => x.name === "EventResultFile");
    expect(m).toBeDefined();
    const f = Object.fromEntries(m!.fields.map((x) => [x.name, x]));
    expect(f.label.isRequired).toBe(true);
    expect(f.fileUrl.isRequired).toBe(true);
    expect(f.fileName.isRequired).toBe(true);
    expect(f.eventId.isRequired).toBe(true);
    expect(f.createdById.isRequired).toBe(false);
  });

  it("Event.resultsSubtitle é opcional e Event tem a relação resultFiles", () => {
    const e = models.find((x) => x.name === "Event")!;
    expect(e.fields.find((x) => x.name === "resultsSubtitle")!.isRequired).toBe(false);
    expect(e.fields.find((x) => x.name === "resultFiles")).toBeDefined();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/schema-event-result-files.test.ts`
Expected: FAIL — `m` é `undefined` (model não existe ainda).

- [ ] **Step 3: Editar `prisma/schema.prisma`**

No model `Event`, junto das outras colunas de arte (perto de `regulationUrl`/`regulationText`), adicionar:

```prisma
  resultsSubtitle              String?       @db.VarChar(120)
```

No mesmo model `Event`, junto de `resultImports          ResultImport[]`, adicionar:

```prisma
  resultFiles            EventResultFile[]
```

No model `User`, junto das outras relações inversas do usuário, adicionar:

```prisma
  createdResultFiles EventResultFile[]
```

Adicionar o model novo (perto de `ResultImport`/`RaceResult`):

```prisma
model EventResultFile {
  id          String   @id @default(cuid())
  eventId     String
  label       String
  fileUrl     String   @db.Text
  fileName    String
  createdById String?
  createdAt   DateTime @default(now())

  event     Event @relation(fields: [eventId], references: [id], onDelete: Cascade)
  createdBy User? @relation(fields: [createdById], references: [id])

  @@index([eventId])
  @@map("event_result_files")
}
```

- [ ] **Step 4: Gerar o client + criar a migração manual**

Run: `npx prisma generate`

Criar `prisma/migrations/20260831010000_event_result_files/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "event_result_files" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_result_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_result_files_eventId_idx" ON "event_result_files"("eventId");

-- AddForeignKey
ALTER TABLE "event_result_files" ADD CONSTRAINT "event_result_files_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_result_files" ADD CONSTRAINT "event_result_files_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "events" ADD COLUMN "resultsSubtitle" VARCHAR(120);
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/schema-event-result-files.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (o client regenerado tem os tipos novos).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma tests/schema-event-result-files.test.ts
git add -f prisma/migrations/20260831010000_event_result_files/migration.sql
git commit -m "feat(schema): EventResultFile + Event.resultsSubtitle"
```

---

## Task 2: Upload — purpose `result_pdf`

**Files:**
- Modify: `app/api/upload/route.ts` (`ALLOWED_PURPOSES`)
- Modify: `components/organizer/FileUploadInput.tsx` (tipo da prop `purpose`)
- Test: `tests/upload-route.test.ts` (arquivo existente — adicionar casos)

**Interfaces:**
- Consumes: nada.
- Produces: `POST /api/upload` aceita `purpose=result_pdf` para `application/pdf`; retorna `{ url }`. `FileUploadInput` aceita `purpose="result_pdf"`.

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/upload-route.test.ts`, dentro do `describe` principal, adicionar:

```ts
it("aceita purpose=result_pdf para um PDF válido", async () => {
  authMock.mockResolvedValueOnce({ user: { id: "org-1", role: "ORGANIZER" } } as any);
  const pdfBytes = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(20)]);
  const fd = new FormData();
  fd.append("file", new File([pdfBytes], "classificacao.pdf", { type: "application/pdf" }));
  fd.append("purpose", "result_pdf");

  const res = await POST(new Request("http://localhost/api/upload", { method: "POST", body: fd }) as any);

  // 200 quando o storage está mockado como pronto; 503 se o teste não mocka storage.
  // O importante: NÃO é 400 "Purpose inválido".
  expect(res.status).not.toBe(400);
});

it("rejeita result_pdf quando os bytes não são de PDF (magic bytes)", async () => {
  authMock.mockResolvedValueOnce({ user: { id: "org-1", role: "ORGANIZER" } } as any);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from([0x89, 0x50, 0x4e, 0x47])], "fake.pdf", { type: "application/pdf" }));
  fd.append("purpose", "result_pdf");

  const res = await POST(new Request("http://localhost/api/upload", { method: "POST", body: fd }) as any);
  const data = await res.json();
  expect(res.status).toBe(400);
  expect(data.error).toMatch(/não corresponde ao tipo/i);
});
```

> Nota: consultar o topo de `tests/upload-route.test.ts` para os nomes reais dos mocks (`authMock`, mock de storage/`getSupabaseConfig`, `POST` importado). Reusar exatamente o que já está lá; se o arquivo já mocka `getSupabaseConfig` como pronto, o primeiro teste vira `expect(res.status).toBe(200)`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/upload-route.test.ts`
Expected: FAIL no primeiro caso — hoje `result_pdf` cai em `400 "Purpose inválido"`.

- [ ] **Step 3: Adicionar o purpose**

Em `app/api/upload/route.ts`:

```ts
const ALLOWED_PURPOSES = new Set(["banner", "list_banner", "regulation", "kit_info", "result_pdf"]);
```

- [ ] **Step 4: Ampliar o tipo do `FileUploadInput`**

Em `components/organizer/FileUploadInput.tsx`, na interface `Props`:

```ts
  purpose: "banner" | "list_banner" | "regulation" | "kit_info" | "result_pdf";
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/upload-route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/upload/route.ts components/organizer/FileUploadInput.tsx tests/upload-route.test.ts
git commit -m "feat(upload): purpose result_pdf (PDF)"
```

---

## Task 3: Helper `eventHasResults`

**Files:**
- Create: `lib/events/has-results.ts`
- Test: `tests/lib-event-has-results.test.ts`

**Interfaces:**
- Produces: `eventHasResults(input: { resultFilesCount: number; publishedImportCount: number }): boolean`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/lib-event-has-results.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eventHasResults } from "@/lib/events/has-results";

describe("eventHasResults", () => {
  it("false quando não há PDF nem import publicado", () => {
    expect(eventHasResults({ resultFilesCount: 0, publishedImportCount: 0 })).toBe(false);
  });
  it("true com ao menos um PDF", () => {
    expect(eventHasResults({ resultFilesCount: 1, publishedImportCount: 0 })).toBe(true);
  });
  it("true com ao menos um import publicado", () => {
    expect(eventHasResults({ resultFilesCount: 0, publishedImportCount: 1 })).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/lib-event-has-results.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `lib/events/has-results.ts`:

```ts
/** Um evento "tem resultados" (mostra o botão / a página pública tem conteúdo) quando há
 * pelo menos um PDF de resultado cadastrado OU um import de CSV publicado. */
export function eventHasResults(input: {
  resultFilesCount: number;
  publishedImportCount: number;
}): boolean {
  return input.resultFilesCount > 0 || input.publishedImportCount > 0;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/lib-event-has-results.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/events/has-results.ts tests/lib-event-has-results.test.ts
git commit -m "feat(events): helper eventHasResults"
```

---

## Task 4: Rota `POST` + `PATCH /api/events/[id]/result-files`

**Files:**
- Create: `app/api/events/[id]/result-files/route.ts`
- Test: `tests/event-result-files-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission` (`@/lib/auth/rbac`), `resolveActingScope`, `db`.
- Produces:
  - `POST` body `{ label: string, fileUrl: string, fileName: string }` → 201 `{ id, label, fileUrl, fileName, createdAt }`.
  - `PATCH` body `{ resultsSubtitle: string | null }` → 200 `{ ok: true }`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/event-result-files-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";

vi.mock("@/lib/auth/rbac", () => ({
  checkApiPermission: vi.fn(),
  resolveActingScope: vi.fn(),
}));

import { POST, PATCH } from "@/app/api/events/[id]/result-files/route";

const checkPermMock = vi.mocked(checkApiPermission);
const resolveScopeMock = vi.mocked(resolveActingScope);
const dbMock = db as any;
const ctx = { params: Promise.resolve({ id: "event-1" }) };

function makeReq(body: unknown, method = "POST") {
  return new Request("http://localhost/api/events/event-1/result-files", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/events/[id]/result-files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkPermMock.mockResolvedValue({ allowed: true, session: { user: { id: "u-1", role: "ORGANIZER" } } } as any);
    resolveScopeMock.mockResolvedValue({ actingAsAdmin: false, organizerId: "org-1" } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1", organizerId: "org-1" });
  });

  it("bloqueia sem permissão", async () => {
    checkPermMock.mockResolvedValueOnce({ allowed: false, response: new Response("no", { status: 403 }) } as any);
    const res = await POST(makeReq({ label: "Geral", fileUrl: "https://x/a.pdf", fileName: "a.pdf" }), ctx);
    expect(res.status).toBe(403);
    expect(dbMock.eventResultFile?.create).not.toHaveBeenCalled();
  });

  it("404 quando o evento é de outro organizador", async () => {
    dbMock.event.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ label: "Geral", fileUrl: "https://x/a.pdf", fileName: "a.pdf" }), ctx);
    expect(res.status).toBe(404);
  });

  it("400 com label vazio", async () => {
    const res = await POST(makeReq({ label: "  ", fileUrl: "https://x/a.pdf", fileName: "a.pdf" }), ctx);
    expect(res.status).toBe(400);
  });

  it("400 com fileUrl que não é URL", async () => {
    const res = await POST(makeReq({ label: "Geral", fileUrl: "não-url", fileName: "a.pdf" }), ctx);
    expect(res.status).toBe(400);
  });

  it("cria o registro com createdById da sessão → 201", async () => {
    dbMock.eventResultFile = { create: vi.fn().mockResolvedValue({ id: "rf-1", label: "Geral Masculino", fileUrl: "https://x/a.pdf", fileName: "a.pdf", createdAt: new Date("2026-08-31T12:00:00Z") }) };
    const res = await POST(makeReq({ label: "Geral Masculino", fileUrl: "https://x/a.pdf", fileName: "a.pdf" }), ctx);
    expect(res.status).toBe(201);
    expect(dbMock.eventResultFile.create).toHaveBeenCalledWith({
      data: { eventId: "event-1", label: "Geral Masculino", fileUrl: "https://x/a.pdf", fileName: "a.pdf", createdById: "u-1" },
    });
  });

  it("admin titular usa event.findUnique", async () => {
    resolveScopeMock.mockResolvedValueOnce({ actingAsAdmin: true, organizerId: null } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });
    dbMock.eventResultFile = { create: vi.fn().mockResolvedValue({ id: "rf-1", label: "x", fileUrl: "https://x/a.pdf", fileName: "a.pdf", createdAt: new Date() }) };
    const res = await POST(makeReq({ label: "x", fileUrl: "https://x/a.pdf", fileName: "a.pdf" }), ctx);
    expect(res.status).toBe(201);
    expect(dbMock.event.findUnique).toHaveBeenCalled();
  });
});

describe("PATCH /api/events/[id]/result-files (resultsSubtitle)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkPermMock.mockResolvedValue({ allowed: true, session: { user: { id: "u-1", role: "ORGANIZER" } } } as any);
    resolveScopeMock.mockResolvedValue({ actingAsAdmin: false, organizerId: "org-1" } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1", organizerId: "org-1" });
    dbMock.event.update = vi.fn().mockResolvedValue({});
  });

  it("grava o subtítulo trimado", async () => {
    const res = await PATCH(makeReq({ resultsSubtitle: "  5KM  " }, "PATCH"), ctx);
    expect(res.status).toBe(200);
    expect(dbMock.event.update).toHaveBeenCalledWith({ where: { id: "event-1" }, data: { resultsSubtitle: "5KM" } });
  });

  it("string vazia vira null", async () => {
    const res = await PATCH(makeReq({ resultsSubtitle: "   " }, "PATCH"), ctx);
    expect(res.status).toBe(200);
    expect(dbMock.event.update).toHaveBeenCalledWith({ where: { id: "event-1" }, data: { resultsSubtitle: null } });
  });

  it("bloqueia sem permissão", async () => {
    checkPermMock.mockResolvedValueOnce({ allowed: false, response: new Response("no", { status: 403 }) } as any);
    const res = await PATCH(makeReq({ resultsSubtitle: "5KM" }, "PATCH"), ctx);
    expect(res.status).toBe(403);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/event-result-files-route.test.ts`
Expected: FAIL — módulo da rota não existe.

- [ ] **Step 3: Implementar a rota**

Criar `app/api/events/[id]/result-files/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

/**
 * Gestão dos PDFs de resultado da página pública (`/eventos/[slug]/resultados`).
 * `POST`  — cadastra um PDF (nome de exibição + URL já enviada pelo `/api/upload`).
 * `PATCH` — grava o texto de destaque (`Event.resultsSubtitle`).
 * Ambas sob a permissão `results.import` + checagem anti‑IDOR por `organizerId`.
 */

const createSchema = z.object({
  label: z.string().trim().min(1).max(80),
  fileUrl: z.string().url().max(500),
  fileName: z.string().trim().min(1).max(200),
});

const subtitleSchema = z.object({
  resultsSubtitle: z.string().max(120).nullable(),
});

async function resolveEvent(eventId: string, session: { user: { id: string } }) {
  const scope = await resolveActingScope(session);
  return scope.actingAsAdmin
    ? db.event.findUnique({ where: { id: eventId } })
    : db.event.findFirst({ where: { id: eventId, organizerId: scope.organizerId ?? "__none__" } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkApiPermission("results.import", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const event = await resolveEvent(id, session);
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const created = await db.eventResultFile.create({
    data: {
      eventId: id,
      label: parsed.data.label,
      fileUrl: parsed.data.fileUrl,
      fileName: parsed.data.fileName,
      createdById: session.user.id,
    },
  });
  return NextResponse.json(
    { id: created.id, label: created.label, fileUrl: created.fileUrl, fileName: created.fileName, createdAt: created.createdAt },
    { status: 201 },
  );
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkApiPermission("results.import", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const event = await resolveEvent(id, session);
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const parsed = subtitleSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  await db.event.update({
    where: { id },
    data: { resultsSubtitle: parsed.data.resultsSubtitle?.trim() || null },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/event-result-files-route.test.ts`
Expected: PASS (os testes de `PATCH` também passam mesmo antes da Task 5).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add "app/api/events/[id]/result-files/route.ts" tests/event-result-files-route.test.ts
git commit -m "feat(api): POST/PATCH /api/events/[id]/result-files"
```

---

## Task 5: Rota `DELETE /api/events/[id]/result-files/[fileId]`

**Files:**
- Create: `app/api/events/[id]/result-files/[fileId]/route.ts`
- Test: `tests/event-result-files-route.test.ts` (adicionar `describe` do DELETE)

**Interfaces:**
- Consumes: `checkApiPermission`, `resolveActingScope`, `db`.
- Produces: `DELETE` → 200 `{ ok: true }` / 404.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `tests/event-result-files-route.test.ts`:

```ts
import { DELETE } from "@/app/api/events/[id]/result-files/[fileId]/route";

describe("DELETE /api/events/[id]/result-files/[fileId]", () => {
  const delCtx = { params: Promise.resolve({ id: "event-1", fileId: "rf-1" }) };
  beforeEach(() => {
    vi.clearAllMocks();
    checkPermMock.mockResolvedValue({ allowed: true, session: { user: { id: "u-1", role: "ORGANIZER" } } } as any);
    resolveScopeMock.mockResolvedValue({ actingAsAdmin: false, organizerId: "org-1" } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1", organizerId: "org-1" });
  });

  function delReq() {
    return new Request("http://localhost/api/events/event-1/result-files/rf-1", { method: "DELETE" }) as any;
  }

  it("404 quando o fileId não é do evento", async () => {
    dbMock.eventResultFile = { findFirst: vi.fn().mockResolvedValue(null), delete: vi.fn() };
    const res = await DELETE(delReq(), delCtx);
    expect(res.status).toBe(404);
    expect(dbMock.eventResultFile.delete).not.toHaveBeenCalled();
  });

  it("exclui e responde { ok: true }", async () => {
    dbMock.eventResultFile = {
      findFirst: vi.fn().mockResolvedValue({ id: "rf-1", eventId: "event-1" }),
      delete: vi.fn().mockResolvedValue({}),
    };
    const res = await DELETE(delReq(), delCtx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(dbMock.eventResultFile.delete).toHaveBeenCalledWith({ where: { id: "rf-1" } });
  });

  it("bloqueia sem permissão", async () => {
    checkPermMock.mockResolvedValueOnce({ allowed: false, response: new Response("no", { status: 403 }) } as any);
    dbMock.eventResultFile = { findFirst: vi.fn(), delete: vi.fn() };
    const res = await DELETE(delReq(), delCtx);
    expect(res.status).toBe(403);
    expect(dbMock.eventResultFile.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/event-result-files-route.test.ts`
Expected: FAIL — módulo do DELETE não existe.

- [ ] **Step 3: Implementar**

Criar `app/api/events/[id]/result-files/[fileId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

/** Remove um PDF de resultado. Não apaga o arquivo do bucket (mesma convenção de
 * banner/regulamento — o storage não é limpo hoje). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const check = await checkApiPermission("results.import", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const file = await db.eventResultFile.findFirst({ where: { id: fileId, eventId: id } });
  if (!file) return NextResponse.json({ error: "Resultado não encontrado" }, { status: 404 });

  await db.eventResultFile.delete({ where: { id: fileId } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/event-result-files-route.test.ts`
Expected: PASS (todos os `describe` — POST, PATCH, DELETE).

- [ ] **Step 5: Commit**

```bash
git add "app/api/events/[id]/result-files/[fileId]/route.ts" tests/event-result-files-route.test.ts
git commit -m "feat(api): DELETE /api/events/[id]/result-files/[fileId]"
```

---

## Task 6: UI organizador — `EventResultFilesManager` + integração na página

**Files:**
- Create: `components/organizer/EventResultFilesManager.tsx`
- Modify: `app/organizador/eventos/[id]/resultados/page.tsx` (carregar dados + compor)
- Modify: `app/organizador/eventos/[id]/resultados/ResultadosClient.tsx` (remover o "chrome" externo)
- Test: sem teste de UI — `npm run build` + `npx tsc --noEmit`

**Interfaces:**
- Consumes: `POST/PATCH /api/events/[id]/result-files`, `DELETE /api/events/[id]/result-files/[fileId]`, `FileUploadInput` (`purpose="result_pdf"`), `ConfirmModal`, `ErrorModal`.
- Produces: `<EventResultFilesManager eventId slug initialSubtitle initialFiles />`.

- [ ] **Step 1: Criar `components/organizer/EventResultFilesManager.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import FileUploadInput from "@/components/organizer/FileUploadInput";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

interface ResultFile {
  id: string;
  label: string;
  fileUrl: string;
}

interface Props {
  eventId: string;
  slug: string;
  initialSubtitle: string | null;
  initialFiles: ResultFile[];
}

export default function EventResultFilesManager({ eventId, slug, initialSubtitle, initialFiles }: Props) {
  const router = useRouter();
  const [subtitle, setSubtitle] = useState(initialSubtitle ?? "");
  const [savingSubtitle, setSavingSubtitle] = useState(false);
  const [subtitleSaved, setSubtitleSaved] = useState(false);

  const [newLabel, setNewLabel] = useState("");
  const [newFileUrl, setNewFileUrl] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState<string>("");
  const [adding, setAdding] = useState(false);

  const [deleting, setDeleting] = useState<ResultFile | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);

  async function saveSubtitle() {
    setSavingSubtitle(true);
    setSubtitleSaved(false);
    const res = await fetch(`/api/events/${eventId}/result-files`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultsSubtitle: subtitle }),
    });
    setSavingSubtitle(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao salvar o texto.");
      return;
    }
    setSubtitleSaved(true);
    router.refresh();
  }

  async function addFile(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim() || !newFileUrl) return;
    setAdding(true);
    const res = await fetch(`/api/events/${eventId}/result-files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel.trim(), fileUrl: newFileUrl, fileName: newFileName || "resultado.pdf" }),
    });
    setAdding(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao adicionar o resultado.");
      return;
    }
    setNewLabel("");
    setNewFileUrl(null);
    setNewFileName("");
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeletingBusy(true);
    const res = await fetch(`/api/events/${eventId}/result-files/${deleting.id}`, { method: "DELETE" });
    setDeletingBusy(false);
    setDeleting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao excluir.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="card space-y-5">
      <div>
        <h2 className="font-semibold">Página pública de resultados</h2>
        <a
          href={`/eventos/${slug}/resultados`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary-600 hover:underline"
        >
          Ver página pública de resultados ↗
        </a>
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Texto de destaque (opcional)
        </label>
        <p className="text-xs text-gray-500">Aparece grande abaixo do banner. Ex.: 5KM. Deixe em branco para não mostrar.</p>
        <div className="flex gap-2">
          <input
            value={subtitle}
            onChange={(e) => { setSubtitle(e.target.value); setSubtitleSaved(false); }}
            maxLength={120}
            className="input flex-1"
            placeholder="5KM"
          />
          <button type="button" onClick={saveSubtitle} disabled={savingSubtitle} className="btn-secondary text-sm">
            {savingSubtitle ? "Salvando..." : "Salvar"}
          </button>
        </div>
        {subtitleSaved && <p className="text-xs text-green-600">Salvo.</p>}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">PDFs cadastrados</h3>
        {initialFiles.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum PDF cadastrado ainda.</p>
        ) : (
          <ul className="divide-y dark:divide-gray-700 border dark:border-gray-700 rounded-lg">
            {initialFiles.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <a href={f.fileUrl} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline truncate">
                  {f.label}
                </a>
                <button
                  type="button"
                  onClick={() => setDeleting(f)}
                  className="text-xs text-red-600 hover:underline flex-shrink-0"
                >
                  Excluir
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={addFile} className="space-y-3 border-t dark:border-gray-700 pt-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Adicionar resultado</h3>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Nome de exibição</label>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            maxLength={80}
            className="input w-full"
            placeholder="Categoria Geral Masculina"
          />
        </div>
        <FileUploadInput
          purpose="result_pdf"
          accept="application/pdf"
          label="PDF do resultado"
          currentUrl={newFileUrl}
          onUploaded={(url) => { setNewFileUrl(url); setNewFileName(url.split("/").pop() ?? "resultado.pdf"); }}
          onRemoved={() => { setNewFileUrl(null); setNewFileName(""); }}
        />
        <button
          type="submit"
          disabled={adding || !newLabel.trim() || !newFileUrl}
          className="btn-primary text-sm"
        >
          {adding ? "Adicionando..." : "Adicionar"}
        </button>
      </form>

      <ConfirmModal
        open={deleting !== null}
        title="Excluir resultado"
        message={`Excluir "${deleting?.label ?? ""}" da página pública?`}
        confirmLabel="Excluir"
        tone="danger"
        loading={deletingBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
```

> Conferir a assinatura real de `components/ui/ConfirmModal.tsx` (props `open`, `title`, `message`, `confirmLabel`, `cancelLabel`, `tone`, `loading`, `onConfirm`, `onCancel` — do `CLAUDE.md`) e de `FileUploadInput` (`currentUrl` aceita `null`; `onUploaded(url: string)`; `onRemoved?()`). Ajustar nomes se divergir.

- [ ] **Step 2: Refatorar `ResultadosClient.tsx` — tirar o chrome externo**

Hoje o componente abre com:

```tsx
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">← Voltar</Link>
        <h1 className="text-xl font-bold mt-1">Importar resultados</h1>
      </div>
      {/* ...cards... */}
    </div>
  );
```

Trocar por (remove o `<div className="max-w-lg...">` externo e o back-link/h1; mantém os cards; a raiz vira um fragmento `<>`):

```tsx
  return (
    <div className="space-y-4">
      <h2 className="font-semibold">Importar via planilha (CSV)</h2>
      {/* ...os mesmos cards do formato do CSV / form / bloco de sucesso, sem alterações... */}
    </div>
  );
```

O import de `Link` fica se ainda for usado no `handlePublish` (`router.push`), senão remover para não sobrar import não usado — checar com `tsc`.

- [ ] **Step 3: Reescrever `app/organizador/eventos/[id]/resultados/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAnyPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import ResultadosClient from "./ResultadosClient";
import EventResultFilesManager from "@/components/organizer/EventResultFilesManager";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAnyPermission(["results.import", "results.publish"], { eventId: id });

  const scope = await resolveActingScope(session);
  const select = {
    id: true,
    slug: true,
    resultsSubtitle: true,
    resultFiles: {
      orderBy: { createdAt: "asc" as const },
      select: { id: true, label: true, fileUrl: true },
    },
  };
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id }, select })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" }, select });
  if (!event) notFound();

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">← Voltar</Link>
        <h1 className="text-xl font-bold mt-1">Resultados</h1>
      </div>

      <EventResultFilesManager
        eventId={id}
        slug={event.slug}
        initialSubtitle={event.resultsSubtitle}
        initialFiles={event.resultFiles}
      />

      <ResultadosClient />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: exit 0. Corrigir imports não usados / nomes de props que divergirem.

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 5: Rodar os testes que tocam esses arquivos indiretamente**

Run: `npx vitest run tests/event-result-files-route.test.ts tests/upload-route.test.ts`
Expected: PASS (sem regressão).

- [ ] **Step 6: Commit**

```bash
git add components/organizer/EventResultFilesManager.tsx "app/organizador/eventos/[id]/resultados/page.tsx" "app/organizador/eventos/[id]/resultados/ResultadosClient.tsx"
git commit -m "feat(organizador): cadastro de PDFs de resultado na tela de resultados"
```

---

## Task 7: Página pública `/eventos/[slug]/resultados`

**Files:**
- Modify: `app/(public)/eventos/[slug]/resultados/page.tsx`
- Test: sem teste de UI — `npm run build` + `npx tsc --noEmit`

**Interfaces:**
- Consumes: `db.event` com `bannerUrl`, `listBannerUrl`, `resultsSubtitle`, `resultFiles`; `db.resultImport` (query atual mantida).
- Produces: página com RESULTADOS + banner + subtítulo + grid de botões + tabela do CSV (quando publicada).

- [ ] **Step 1: Ampliar o `select` do evento**

No `ResultadosPage`, a query hoje é:

```ts
  const event = await db.event.findUnique({
    where: { slug },
    select: { id: true, title: true },
  });
```

Trocar por:

```ts
  const event = await db.event.findUnique({
    where: { slug },
    select: {
      id: true,
      title: true,
      bannerUrl: true,
      listBannerUrl: true,
      resultsSubtitle: true,
      resultFiles: {
        orderBy: { createdAt: "asc" },
        select: { id: true, label: true, fileUrl: true },
      },
    },
  });
```

- [ ] **Step 2: Renderizar o cabeçalho novo (banner + subtítulo + botões)**

O `return (` hoje começa com:

```tsx
  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">{event.title}</h1>
      <h2 className="text-lg text-gray-600 mb-6">Resultados</h2>
      {!latestImport ? (
        <p className="text-gray-500 text-center py-12">Resultados ainda não publicados.</p>
      ) : (
```

Trocar o bloco do topo (do `<main>` até logo antes do `{!latestImport ? (` ) por:

```tsx
  const bannerUrl = event.bannerUrl ?? event.listBannerUrl;
  const hasPdfs = event.resultFiles.length > 0;
  const hasAnything = hasPdfs || Boolean(latestImport);

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-center text-2xl font-extrabold tracking-widest text-green-700 dark:text-green-500 uppercase mb-6">
        Resultados
      </h1>

      {bannerUrl ? (
        <div className="relative w-full max-w-md mx-auto aspect-[3/1] mb-6">
          <img src={bannerUrl} alt={event.title} className="w-full h-full object-contain" />
        </div>
      ) : (
        <h2 className="text-center text-xl font-semibold mb-6">{event.title}</h2>
      )}

      {event.resultsSubtitle && (
        <p className="text-center text-3xl font-extrabold text-primary-700 dark:text-primary-400 mb-8">
          {event.resultsSubtitle}
        </p>
      )}

      {hasPdfs && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto mb-10">
          {event.resultFiles.map((f) => (
            <a
              key={f.id}
              href={f.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl bg-slate-800 text-white shadow-lg px-4 py-6 text-center font-bold uppercase underline hover:bg-slate-700 transition-colors"
            >
              {f.label}
            </a>
          ))}
        </div>
      )}

      {!hasAnything && (
        <p className="text-gray-500 text-center py-12">Resultados ainda não publicados.</p>
      )}

      {latestImport && (
        <>
          <h2 className="text-lg font-semibold mb-4">Classificação detalhada</h2>
```

E logo depois de renderizar a tabela / o "nenhum resultado encontrado" (o `</>` que fecha o `{latestImport && (`), fechar o fragmento. **Concretamente:** a estrutura antiga `{!latestImport ? (<p>...</p>) : (<> ...form + tabela... </>)}` vira apenas `{latestImport && (<> <h2>Classificação detalhada</h2> ...form + tabela... </>)}` — o caso "sem import" agora é coberto por `{!hasAnything && ...}` acima. Manter o form de busca e a `<table>` exatamente como estão hoje dentro desse `<>`.

- [ ] **Step 3: `generateMetadata`**

Sem alteração — o `select` do `generateMetadata` já é `{ title: true }` e continua válido.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add "app/(public)/eventos/[slug]/resultados/page.tsx"
git commit -m "feat(público): página de resultados com banner + botões de PDF"
```

---

## Task 8: Botão "Resultado" na página pública do evento

**Files:**
- Modify: `lib/events.ts` (`getEventBySlug` — incluir `resultFiles`/`resultImports`)
- Modify: `app/(public)/eventos/[slug]/page.tsx` (botão no card "Inscrições")
- Test: sem teste de UI — `npm run build` + `npx tsc --noEmit`

**Interfaces:**
- Consumes: `eventHasResults` (`@/lib/events/has-results`).
- Produces: nada.

- [ ] **Step 1: Ampliar `getEventBySlug`**

Em `lib/events.ts`, no `include` de `getEventBySlug`, adicionar:

```ts
      resultFiles: { take: 1, select: { id: true } },
      resultImports: { where: { published: true }, take: 1, select: { id: true } },
```

- [ ] **Step 2: Renderizar o botão**

Em `app/(public)/eventos/[slug]/page.tsx`:

Import no topo:

```ts
import { eventHasResults } from "@/lib/events/has-results";
```

Perto dos outros derivados (ex.: depois de `const heroBannerUrl = ...`):

```ts
  const hasResults = eventHasResults({
    resultFilesCount: event.resultFiles.length,
    publishedImportCount: event.resultImports.length,
  });
```

Dentro do `<aside>` → `<div className="card sticky top-4">`, **logo após** o bloco `{canRegister && availableBatches.length > 0 ? (...) : ... }` que renderiza o botão "Inscrever-se"/estados, e **antes** do fechamento desse `<div className="card ...">`:

```tsx
              {hasResults && (
                <Link
                  href={`/eventos/${event.slug}/resultados`}
                  className="btn-secondary w-full text-center block mt-3"
                >
                  🏆 Resultado
                </Link>
              )}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: exit 0. (`getEventBySlug` agora retorna `resultFiles`/`resultImports` — o `generateMetadata` que também chama `getEventBySlug` ignora esses campos, sem problema.)

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add lib/events.ts "app/(public)/eventos/[slug]/page.tsx"
git commit -m "feat(público): botão Resultado na página do evento quando há resultados"
```

---

## Task 9: Verificação final + PROGRESSO

**Files:**
- Modify: `PROGRESSO.md`
- Test: suíte completa

- [ ] **Step 1: Suíte completa**

Run: `npx vitest run`
Expected: tudo verde. Corrigir qualquer mock de teste não tocado que passe a receber os campos novos no `select` de `event` (ex.: um default de `db.event.findUnique` em `tests/setup.ts` que precise de `resultFiles: []`).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: limpo / `✓ Compiled successfully`.

- [ ] **Step 3: Revisão adversarial (grep) — registrar cada check**

- `grep -rn "result-files" app/ components/` — só as 2 rotas + o manager + a page do organizador.
- `grep -rn "eventResultFile\." app/ lib/` — só nas 2 rotas (`create`, `findFirst`, `delete`). Nenhuma escrita fora do escopo `results.import`.
- `grep -rn "ALLOWED_PURPOSES" app/api/upload/route.ts` — inclui `result_pdf`.
- Confirmar: as 2 rotas de `result-files` fazem `checkApiPermission("results.import", { eventId })` **e** a checagem `event` por `organizerId`/`actingAsAdmin` antes de qualquer escrita.
- Confirmar: `EventResultFilesManager` não usa `alert`/`confirm`/`prompt` (usa `ConfirmModal`/`ErrorModal`).
- Confirmar: página pública `/eventos/[slug]/resultados` renderiza `f.label` como texto (sem `dangerouslySetInnerHTML`); `f.fileUrl` só em `href` com `rel="noopener noreferrer"`.

- [ ] **Step 4: `PROGRESSO.md`** — nova entrada no topo: sub‑projeto "página de resultados (PDFs)" concluído, arquivos principais, resultado de `vitest`/`tsc`/`build`. **PRÓXIMA TAREFA:** deploy — `git pull` no VPS → `docker build` → `prisma db push` (aditivo: `event_result_files` + `events.resultsSubtitle`) → restart. **Sem backfill.** Depois: conferir na produção que a página do evento mostra o botão "Resultado" só quando há PDF/CSV, e que a página pública renderiza banner + botões.

- [ ] **Step 5: Commit**

```bash
git add PROGRESSO.md
git commit -m "docs: conclui página de resultados (PDFs) — verificação + PROGRESSO"
```

---

## Self-Review

**1. Spec coverage:**

| Spec (seção) | Task |
|---|---|
| §1.1 model `EventResultFile` | Task 1 |
| §1.2 `Event.resultsSubtitle` | Task 1 |
| §1.3 migração aditiva | Task 1 (SQL manual) |
| §2 upload purpose `result_pdf` + `FileUploadInput` | Task 2 |
| §3.1 `POST /result-files` (zod, IDOR, `createdById`) | Task 4 |
| §3.2 `DELETE /result-files/[fileId]` (IDOR, 404) | Task 5 |
| §3.3 `PATCH /result-files` (`resultsSubtitle`, `results.import`) | Task 4 |
| §4 UI organizador — `EventResultFilesManager` acima do CSV; CSV intacto | Task 6 |
| §5 página pública — RESULTADOS + banner + subtítulo + botões + tabela CSV | Task 7 |
| §6 botão "Resultado" no card "Inscrições", só com resultados | Task 8 (+ helper Task 3) |
| §7 helper `eventHasResults` + testes de rota | Task 3, 4, 5 |
| §8 rollout (`db push`, sem backfill) | Task 9 (PROGRESSO) |
| §9 fora de escopo | não implementado |

**2. Placeholder scan:** As Tasks 6–8 são UI/composição — trazem o código concreto dos componentes/trechos e apontam os arquivos exatos; as notas "conferir a assinatura real de X" são checagens defensivas contra divergência de props, não TODOs. Migração SQL é literal. Testes têm shape de asserção concreto.

**3. Type consistency:**
- `EventResultFile` campos (`label`, `fileUrl`, `fileName`, `createdById`, `createdAt`) — Task 1, consumidos idênticos nas Tasks 4/5/6/7.
- `eventHasResults({ resultFilesCount, publishedImportCount })` — Task 3, chamado idêntico na Task 8.
- `<EventResultFilesManager eventId slug initialSubtitle initialFiles />` — Task 6 (definição = uso na page).
- Rota `PATCH /api/events/[id]/result-files` body `{ resultsSubtitle }` — Task 4 (definição) = Task 6 (chamada).
- `select` de `event` com `resultFiles: { select: { id, label, fileUrl } }` — Tasks 6 e 7 usam o mesmo shape; Task 8 usa `{ select: { id: true } }` + `resultImports` (só contagem via `.length`).

Sem inconsistências.
