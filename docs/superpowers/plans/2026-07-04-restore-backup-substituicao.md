# Restore de Backup por Substituição Total — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o import de backup de "merge/upsert linha a linha" para "substituição total transacional", ampliando o backup para cobrir todas as tabelas de negócio e adicionando uma rede de segurança (download automático do estado atual antes de apagar) e confirmação explícita na UI.

**Architecture:** O export (`GET /api/admin/backup`) passa a incluir 8 tabelas que faltavam. O import (`POST /api/admin/backup/import`) passa a rodar dentro de uma única transação Prisma que apaga todas as 19 tabelas do escopo (filhos → pais) e insere o conteúdo do arquivo com `createMany` (pais → filhos); qualquer erro faz rollback de tudo. O client (`BackupImportButton.tsx`) baixa automaticamente um snapshot de segurança antes de enviar o arquivo, e exige digitar "CONFIRMAR" antes de prosseguir.

**Tech Stack:** Next.js App Router (route handlers), Prisma (Postgres), Vitest.

## Global Constraints

- `Session`, `Account`, `VerificationToken` ficam fora do escopo (autenticação é JWT + credentials, sem OAuth) — não entram no export nem no wipe/restore.
- Todo o wipe+restore roda dentro de uma única `db.$transaction`; qualquer falha faz rollback completo (nenhuma escrita parcial).
- Ordem de exclusão (filhos → pais): `raceResult` → `resultImport` → `refund` → `payment` → `registration` → `order` → `fileAsset` → `auditLog` → `transferPayout` → `coupon` → `ticketBatch`/`eventCategory`/`eventRoute` → `event` → `athleteProfile`/`organizerProfile` → `user` → `platformSetting`/`alertLog`. Ordem de inserção é exatamente o inverso.
- Nenhum armazenamento novo no servidor para o snapshot de segurança — o download acontece no navegador do admin, reaproveitando `GET /api/admin/backup`.
- Spec completa em `docs/superpowers/specs/2026-07-04-restore-backup-substituicao-design.md`.

---

### Task 1: Export cobre todas as tabelas de negócio

**Files:**
- Modify: `app/api/admin/backup/route.ts`
- Modify: `tests/setup.ts:1-33` (adicionar mocks que faltam)
- Create: `tests/backup-export-route.test.ts`

**Interfaces:**
- Produces: `GET` (route handler) continua exportando um JSON com streaming; agora com as chaves `users, athleteProfiles, organizerProfiles, events, eventRoutes, eventCategories, ticketBatches, transferPayouts, coupons, orders, registrations, payments, refunds, resultImports, raceResults, fileAssets, auditLogs, platformSettings, alertLogs`.
- Consumes: nenhuma dependência de outras tasks.

- [ ] **Step 1: Estender os mocks de `db` usados pelos testes**

Abra `tests/setup.ts` e adicione `findMany` aos modelos que ainda não têm (necessário para o export) e crie os 3 modelos que ainda não existem no mock (`eventRoute`, `eventCategory`, `raceResult`). Substitua o conteúdo do arquivo por:

```ts
import { vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    event: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    eventRoute: { findMany: vi.fn() },
    eventCategory: { findMany: vi.fn() },
    ticketBatch: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    registration: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    order: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
    payment: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    coupon: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    transferPayout: { findMany: vi.fn(), count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    resultImport: { count: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    raceResult: { findMany: vi.fn() },
    refund: { aggregate: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    fileAsset: { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    platformSetting: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    athleteProfile: { upsert: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    organizerProfile: { upsert: vi.fn(), findUnique: vi.fn() },
    alertLog: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
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
    })),
  },
}));
```

Isso só adiciona `findMany` onde faltava e os 3 modelos novos — nenhum mock existente foi removido, então os testes que já passam continuam passando. O import (Task 2) vai sobrescrever `dbMock.$transaction` localmente no próprio arquivo de teste, então o fixture de `$transaction` acima não precisa cobrir os 19 modelos.

- [ ] **Step 2: Escrever o teste do export (falhando)**

Crie `tests/backup-export-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/backup/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("admin backup export api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    dbMock.user.findMany.mockResolvedValue([{ id: "u1", email: "a@a.com" }]);
    dbMock.athleteProfile.findMany.mockResolvedValue([{ id: "ap1", userId: "u1" }]);
    dbMock.event.findMany.mockResolvedValue([]);
    dbMock.registration.findMany.mockResolvedValue([]);
    dbMock.order.findMany.mockResolvedValue([]);
    dbMock.payment.findMany.mockResolvedValue([]);
    dbMock.coupon.findMany.mockResolvedValue([]);
    dbMock.organizerProfile.findMany.mockResolvedValue([]);
    dbMock.ticketBatch.findMany.mockResolvedValue([]);
    dbMock.eventCategory.findMany.mockResolvedValue([]);
    dbMock.eventRoute.findMany.mockResolvedValue([]);
    dbMock.refund.findMany.mockResolvedValue([]);
    dbMock.transferPayout.findMany.mockResolvedValue([]);
    dbMock.resultImport.findMany.mockResolvedValue([]);
    dbMock.raceResult.findMany.mockResolvedValue([]);
    dbMock.fileAsset.findMany.mockResolvedValue([]);
    dbMock.auditLog.findMany.mockResolvedValue([]);
    dbMock.platformSetting.findMany.mockResolvedValue([{ key: "app_name", value: "Corridas" }]);
    dbMock.alertLog.findMany.mockResolvedValue([]);
  });

  it("streams a JSON object with every table, including the newly added ones", async () => {
    const res = await GET(new Request("http://localhost/api/admin/backup") as any);

    expect(res.status).toBe(200);
    const text = await res.text();
    const data = JSON.parse(text);

    expect(Object.keys(data).sort()).toEqual(
      [
        "users", "athleteProfiles", "events", "registrations", "orders", "payments", "coupons",
        "organizerProfiles", "ticketBatches", "eventCategories", "eventRoutes", "transferPayouts",
        "resultImports", "raceResults", "fileAssets", "auditLogs", "platformSettings", "refunds",
        "alertLogs",
      ].sort(),
    );
    expect(data.users).toEqual([{ id: "u1", email: "a@a.com" }]);
    expect(data.platformSettings).toEqual([{ key: "app_name", value: "Corridas" }]);
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/backup-export-route.test.ts`
Expected: FAIL — faltam as chaves novas no JSON retornado (o handler ainda não as gera).

- [ ] **Step 4: Generalizar `paginateTable` para aceitar um campo de cursor diferente de `id`**

Em `app/api/admin/backup/route.ts`, troque o tipo `Fetcher` e a função `paginateTable` (linhas 7-23) por:

```ts
type Fetcher = (cursor: string | undefined) => Promise<Record<string, unknown>[]>;

async function* paginateTable(name: string, fetcher: Fetcher, last: boolean, idField: string = "id") {
  yield `"${name}": [\n`;
  let cursor: string | undefined;
  let firstRow = true;
  while (true) {
    const rows = await fetcher(cursor);
    for (const row of rows) {
      yield (firstRow ? "" : ",\n") + JSON.stringify(row);
      firstRow = false;
    }
    if (rows.length < BATCH) break;
    cursor = String(rows[rows.length - 1][idField]);
  }
  yield `\n]${last ? "" : ","}\n`;
}
```

- [ ] **Step 5: Adicionar as 8 tabelas novas em `streamTables()`**

No mesmo arquivo, troque a declaração de `tables` (dentro de `streamTables`) para incluir `idField?: string` e adicionar as 8 entradas novas ao final do array existente (depois de `refunds`):

```ts
async function* streamTables() {
  yield "{\n";

  const tables: Array<{ name: string; fetcher: Fetcher; idField?: string }> = [
    {
      name: "users",
      fetcher: (cursor) =>
        db.user.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "events",
      fetcher: (cursor) =>
        db.event.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "registrations",
      fetcher: (cursor) =>
        db.registration.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "orders",
      fetcher: (cursor) =>
        db.order.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "payments",
      fetcher: (cursor) =>
        db.payment.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "coupons",
      fetcher: (cursor) =>
        db.coupon.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "organizerProfiles",
      fetcher: (cursor) =>
        db.organizerProfile.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "ticketBatches",
      fetcher: (cursor) =>
        db.ticketBatch.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "eventCategories",
      fetcher: (cursor) =>
        db.eventCategory.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "eventRoutes",
      fetcher: (cursor) =>
        db.eventRoute.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "refunds",
      fetcher: (cursor) =>
        db.refund.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "athleteProfiles",
      fetcher: (cursor) =>
        db.athleteProfile.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "transferPayouts",
      fetcher: (cursor) =>
        db.transferPayout.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "resultImports",
      fetcher: (cursor) =>
        db.resultImport.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "raceResults",
      fetcher: (cursor) =>
        db.raceResult.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "fileAssets",
      fetcher: (cursor) =>
        db.fileAsset.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "auditLogs",
      fetcher: (cursor) =>
        db.auditLog.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "platformSettings",
      fetcher: (cursor) =>
        db.platformSetting.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { key: cursor } } : {}), orderBy: { key: "asc" } }),
      idField: "key",
    },
    {
      name: "alertLogs",
      fetcher: (cursor) =>
        db.alertLog.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
  ];

  for (let i = 0; i < tables.length; i++) {
    const { name, fetcher, idField } = tables[i];
    const isLast = i === tables.length - 1;
    for await (const chunk of paginateTable(name, fetcher, isLast, idField)) {
      yield chunk;
    }
  }

  yield "}";
}
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/backup-export-route.test.ts`
Expected: PASS

- [ ] **Step 7: Rodar a suíte inteira para garantir que nada quebrou**

Run: `npx vitest run`
Expected: todos os testes passam (a extensão do `tests/setup.ts` no Step 1 só adicionou métodos, não removeu nenhum usado por outros testes).

- [ ] **Step 8: Commit**

```bash
git add app/api/admin/backup/route.ts tests/setup.ts tests/backup-export-route.test.ts
git commit -m "feat: export de backup cobre todas as tabelas de negocio"
```

---

### Task 2: Import por substituição total e transacional

**Files:**
- Modify: `app/api/admin/backup/import/route.ts` (reescrita completa)
- Create: `tests/backup-import-route.test.ts`

**Interfaces:**
- Consumes: nenhuma dependência direta da Task 1 (o import não chama o export), mas compartilha o conjunto de 19 chaves de tabela.
- Produces: `POST` retorna `{ tables: Array<{ table: string; restored: number }>, totalRestored: number }` em caso de sucesso (200), ou `{ error: string }` em caso de falha (400 para arquivo inválido/não reconhecido, 403 para não-admin, 500 para falha durante a transação). O componente da Task 3 consome exatamente esse formato.

- [ ] **Step 1: Escrever os testes do import (falhando)**

Crie `tests/backup-import-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/backup/import/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const authMock = vi.mocked(auth);
const dbMock = db as any;

const MODELS = [
  "raceResult", "resultImport", "refund", "payment", "registration", "order",
  "fileAsset", "auditLog", "transferPayout", "coupon", "ticketBatch",
  "eventCategory", "eventRoute", "event", "athleteProfile", "organizerProfile",
  "user", "platformSetting", "alertLog",
];

function makeRequest(body: Record<string, unknown[]>) {
  const file = new File([JSON.stringify(body)], "backup.json", { type: "application/json" });
  const formData = new FormData();
  formData.append("file", file);
  return new Request("http://localhost/api/admin/backup/import", {
    method: "POST",
    body: formData,
  }) as any;
}

describe("admin backup import api", () => {
  let callOrder: string[];
  let tx: Record<string, { deleteMany: ReturnType<typeof vi.fn>; createMany: ReturnType<typeof vi.fn> }>;

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    callOrder = [];
    tx = {};
    for (const model of MODELS) {
      tx[model] = {
        deleteMany: vi.fn(async () => {
          callOrder.push(`delete:${model}`);
          return { count: 0 };
        }),
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
          callOrder.push(`create:${model}`);
          return { count: data.length };
        }),
      };
    }
    dbMock.$transaction = vi.fn(async (fn: any) => fn(tx));
  });

  it("rejects when the caller is not an admin", async () => {
    authMock.mockResolvedValueOnce(null as any);
    const res = await POST(makeRequest({ users: [] }));
    expect(res.status).toBe(403);
  });

  it("rejects when no file is sent", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/backup/import", { method: "POST", body: new FormData() }) as any,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/não enviado/i);
  });

  it("rejects invalid JSON", async () => {
    const formData = new FormData();
    formData.append("file", new File(["not json"], "backup.json", { type: "application/json" }));
    const res = await POST(
      new Request("http://localhost/api/admin/backup/import", { method: "POST", body: formData }) as any,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/inválido ou corrompido/i);
  });

  it("rejects a file with none of the expected table keys", async () => {
    const res = await POST(makeRequest({ somethingElse: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/não parece ser um backup válido/i);
  });

  it("wipes every table before inserting, in FK-safe order, and reports counts", async () => {
    const res = await POST(
      makeRequest({
        users: [
          { id: "u1", email: "a@a.com", name: "A", role: "ADMIN", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
        ],
        events: [],
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tables.find((t: any) => t.table === "users").restored).toBe(1);
    expect(data.tables.find((t: any) => t.table === "events").restored).toBe(0);
    expect(data.totalRestored).toBe(1);

    expect(callOrder.indexOf("delete:registration")).toBeLessThan(callOrder.indexOf("delete:event"));
    expect(callOrder.indexOf("delete:payment")).toBeLessThan(callOrder.indexOf("delete:order"));
    expect(callOrder.indexOf("delete:raceResult")).toBeLessThan(callOrder.indexOf("delete:resultImport"));
    expect(callOrder.indexOf("delete:organizerProfile")).toBeLessThan(callOrder.indexOf("delete:user"));
    expect(callOrder.indexOf("delete:user")).toBeLessThan(callOrder.indexOf("create:user"));
    expect(callOrder.indexOf("create:user")).toBeLessThan(callOrder.indexOf("create:event"));
    expect(callOrder.indexOf("create:event")).toBeLessThan(callOrder.indexOf("create:registration"));
    expect(callOrder.indexOf("create:order")).toBeLessThan(callOrder.indexOf("create:payment"));
  });

  it("rolls back and reports a single error when a table insert fails", async () => {
    tx.event.createMany.mockRejectedValueOnce(new Error("dado malformado"));

    const res = await POST(
      makeRequest({
        users: [
          { id: "u1", email: "a@a.com", name: "A", role: "ADMIN", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
        ],
        events: [
          {
            id: "e1", organizerId: "org-1", title: "T", slug: "t", modality: "RUNNING", status: "DRAFT",
            startAt: "2026-01-01T00:00:00.000Z", city: "X", state: "SP", createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toMatch(/nenhum dado foi alterado/i);
    expect(data.error).toMatch(/dado malformado/);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/backup-import-route.test.ts`
Expected: FAIL (o handler atual ainda faz upsert linha a linha, não wipe+createMany, e retorna `{ upserted, errors }`, não `{ restored }`).

- [ ] **Step 3: Reescrever `app/api/admin/backup/import/route.ts`**

Substitua o arquivo inteiro por:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const maxDuration = 120;

type Row = Record<string, unknown>;
type TableResult = { table: string; restored: number };

// ── helpers ──────────────────────────────────────────────────────────────────

const s = (v: unknown): string => String(v ?? "");
const sn = (v: unknown): string | null => (v != null ? String(v) : null);
const n = (v: unknown): number => Number(v ?? 0);
const ni = (v: unknown): number | null => (v != null ? Number(v) : null);
const b = (v: unknown): boolean => Boolean(v);
const d = (v: unknown): Date => new Date(s(v));
const dn = (v: unknown): Date | null => (v ? new Date(s(v)) : null);

// ── row shape builders (tabelas são apagadas antes do insert, então só "create") ──

function toUserRow(row: Row): Prisma.UserCreateManyInput {
  return {
    id: s(row.id),
    email: s(row.email),
    name: s(row.name),
    role: s(row.role) as Prisma.UserCreateManyInput["role"],
    active: b(row.active),
    uiDensity: s(row.uiDensity) || "comfortable",
    emailVerified: dn(row.emailVerified),
    passwordHash: sn(row.passwordHash),
    createdAt: d(row.createdAt),
  };
}

function toAthleteProfileRow(row: Row): Prisma.AthleteProfileCreateManyInput {
  return {
    id: s(row.id),
    userId: s(row.userId),
    cpf: sn(row.cpf),
    birthDate: dn(row.birthDate),
    phone: sn(row.phone),
    gender: sn(row.gender),
    city: sn(row.city),
    state: sn(row.state),
    emergencyName: sn(row.emergencyName),
    emergencyPhone: sn(row.emergencyPhone),
    medicalNotes: sn(row.medicalNotes),
    preferredShirtSize: sn(row.preferredShirtSize) as Prisma.AthleteProfileCreateManyInput["preferredShirtSize"],
    teamName: sn(row.teamName),
    createdAt: d(row.createdAt),
  };
}

function toOrganizerProfileRow(row: Row): Prisma.OrganizerProfileCreateManyInput {
  return {
    id: s(row.id),
    userId: s(row.userId),
    companyName: sn(row.companyName),
    cnpj: sn(row.cnpj),
    phone: sn(row.phone),
    website: sn(row.website),
    bio: sn(row.bio),
    verified: b(row.verified),
    createdAt: d(row.createdAt),
  };
}

function toEventRow(row: Row): Prisma.EventCreateManyInput {
  return {
    id: s(row.id),
    organizerId: s(row.organizerId),
    title: s(row.title),
    slug: s(row.slug),
    description: sn(row.description),
    modality: s(row.modality) as Prisma.EventCreateManyInput["modality"],
    status: s(row.status) as Prisma.EventCreateManyInput["status"],
    startAt: d(row.startAt),
    kitPickupAt: dn(row.kitPickupAt),
    venueName: sn(row.venueName),
    addressLine: sn(row.addressLine),
    city: s(row.city),
    state: s(row.state),
    country: s(row.country) || "BR",
    latitude: ni(row.latitude),
    longitude: ni(row.longitude),
    bannerUrl: sn(row.bannerUrl),
    listBannerUrl: sn(row.listBannerUrl),
    regulationUrl: sn(row.regulationUrl),
    regulationText: sn(row.regulationText),
    organizerContact: sn(row.organizerContact),
    maxParticipants: ni(row.maxParticipants),
    platformFeePercent: n(row.platformFeePercent) || 1100,
    publishedAt: dn(row.publishedAt),
    cancellationDeadline: dn(row.cancellationDeadline),
    cancellationRequiresApproval: b(row.cancellationRequiresApproval),
    cancellationContactPhone: sn(row.cancellationContactPhone),
    cancellationContactEmail: sn(row.cancellationContactEmail),
    createdAt: d(row.createdAt),
  };
}

function toEventRouteRow(row: Row): Prisma.EventRouteCreateManyInput {
  return {
    id: s(row.id),
    eventId: s(row.eventId),
    name: s(row.name),
    distanceKm: Number(row.distanceKm ?? 0),
    description: sn(row.description),
  };
}

function toEventCategoryRow(row: Row): Prisma.EventCategoryCreateManyInput {
  return {
    id: s(row.id),
    eventId: s(row.eventId),
    name: s(row.name),
    description: sn(row.description),
    minAge: ni(row.minAge),
    maxAge: ni(row.maxAge),
    gender: sn(row.gender),
  };
}

function toTicketBatchRow(row: Row): Prisma.TicketBatchCreateManyInput {
  return {
    id: s(row.id),
    eventId: s(row.eventId),
    name: s(row.name),
    description: sn(row.description),
    priceAmount: n(row.priceAmount),
    capacity: n(row.capacity),
    soldCount: n(row.soldCount),
    startAt: d(row.startAt),
    endAt: d(row.endAt),
    active: b(row.active),
    activationMode: s(row.activationMode) || "MANUAL",
    createdAt: d(row.createdAt),
  };
}

function toTransferPayoutRow(row: Row): Prisma.TransferPayoutCreateManyInput {
  return {
    id: s(row.id),
    eventId: s(row.eventId),
    organizerId: s(row.organizerId),
    grossAmount: n(row.grossAmount),
    platformFee: n(row.platformFee),
    netAmount: n(row.netAmount),
    status: s(row.status) as Prisma.TransferPayoutCreateManyInput["status"],
    processedAt: dn(row.processedAt),
    notes: sn(row.notes),
    createdAt: d(row.createdAt),
  };
}

function toCouponRow(row: Row): Prisma.CouponCreateManyInput {
  return {
    id: s(row.id),
    eventId: sn(row.eventId),
    code: s(row.code),
    discountType: s(row.discountType) || "PERCENT",
    discountValue: n(row.discountValue),
    maxUses: ni(row.maxUses),
    usedCount: n(row.usedCount),
    expiresAt: dn(row.expiresAt),
    active: b(row.active),
    createdById: sn(row.createdById),
    createdAt: d(row.createdAt),
  };
}

function toOrderRow(row: Row): Prisma.OrderCreateManyInput {
  return {
    id: s(row.id),
    buyerUserId: s(row.buyerUserId),
    eventId: s(row.eventId),
    subtotalAmount: n(row.subtotalAmount),
    platformFeeAmount: n(row.platformFeeAmount),
    paymentFeeAmount: n(row.paymentFeeAmount),
    totalAmount: n(row.totalAmount),
    currency: s(row.currency) || "BRL",
    couponId: sn(row.couponId),
    discountAmount: n(row.discountAmount),
    status: s(row.status) as Prisma.OrderCreateManyInput["status"],
    expiresAt: dn(row.expiresAt),
    createdAt: d(row.createdAt),
  };
}

function toRegistrationRow(row: Row): Prisma.RegistrationCreateManyInput {
  return {
    id: s(row.id),
    eventId: s(row.eventId),
    athleteUserId: s(row.athleteUserId),
    routeId: sn(row.routeId),
    categoryId: sn(row.categoryId),
    ticketBatchId: s(row.ticketBatchId),
    orderId: s(row.orderId),
    bibNumber: sn(row.bibNumber),
    shirtSize: sn(row.shirtSize) as Prisma.RegistrationCreateManyInput["shirtSize"],
    teamName: sn(row.teamName),
    emergencyContactName: sn(row.emergencyContactName),
    emergencyContactPhone: sn(row.emergencyContactPhone),
    medicalNotes: sn(row.medicalNotes),
    status: s(row.status) as Prisma.RegistrationCreateManyInput["status"],
    acceptedTermsAt: dn(row.acceptedTermsAt),
    cancellationReason: sn(row.cancellationReason),
    cancellationRequestedAt: dn(row.cancellationRequestedAt),
    createdAt: d(row.createdAt),
  };
}

function toPaymentRow(row: Row): Prisma.PaymentCreateManyInput {
  return {
    id: s(row.id),
    orderId: s(row.orderId),
    provider: s(row.provider),
    providerPaymentId: sn(row.providerPaymentId),
    method: s(row.method) as Prisma.PaymentCreateManyInput["method"],
    status: s(row.status) as Prisma.PaymentCreateManyInput["status"],
    amount: n(row.amount),
    pixQrCodeText: sn(row.pixQrCodeText),
    boletoUrl: sn(row.boletoUrl),
    expiresAt: dn(row.expiresAt),
    paidAt: dn(row.paidAt),
    refundedAt: dn(row.refundedAt),
    rawPayload: row.rawPayload != null ? (row.rawPayload as Prisma.InputJsonValue) : Prisma.DbNull,
    idempotencyKey: s(row.idempotencyKey),
    createdAt: d(row.createdAt),
  };
}

function toRefundRow(row: Row): Prisma.RefundCreateManyInput {
  return {
    id: s(row.id),
    paymentId: s(row.paymentId),
    amount: n(row.amount),
    reason: sn(row.reason),
    providerRefundId: sn(row.providerRefundId),
    initiatedByUserId: s(row.initiatedByUserId),
    processedAt: dn(row.processedAt),
    createdAt: d(row.createdAt),
  };
}

function toResultImportRow(row: Row): Prisma.ResultImportCreateManyInput {
  return {
    id: s(row.id),
    eventId: s(row.eventId),
    importedBy: s(row.importedBy),
    fileName: s(row.fileName),
    rowCount: n(row.rowCount),
    errorCount: n(row.errorCount),
    published: b(row.published),
    publishedAt: dn(row.publishedAt),
    createdAt: d(row.createdAt),
  };
}

function toRaceResultRow(row: Row): Prisma.RaceResultCreateManyInput {
  return {
    id: s(row.id),
    importId: s(row.importId),
    eventId: s(row.eventId),
    bibNumber: s(row.bibNumber),
    athleteName: s(row.athleteName),
    route: sn(row.route),
    category: sn(row.category),
    gender: sn(row.gender),
    grossTime: sn(row.grossTime),
    netTime: sn(row.netTime),
    placementGeneral: ni(row.placementGeneral),
    placementCategory: ni(row.placementCategory),
    placementGender: ni(row.placementGender),
  };
}

function toFileAssetRow(row: Row): Prisma.FileAssetCreateManyInput {
  return {
    id: s(row.id),
    eventId: sn(row.eventId),
    uploadedBy: s(row.uploadedBy),
    fileName: s(row.fileName),
    fileKey: s(row.fileKey),
    fileUrl: s(row.fileUrl),
    mimeType: s(row.mimeType),
    sizeBytes: n(row.sizeBytes),
    purpose: s(row.purpose),
    createdAt: d(row.createdAt),
  };
}

function toAuditLogRow(row: Row): Prisma.AuditLogCreateManyInput {
  return {
    id: s(row.id),
    userId: sn(row.userId),
    action: s(row.action),
    entityType: s(row.entityType),
    entityId: sn(row.entityId),
    metadata: row.metadata != null ? (row.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
    ipAddress: sn(row.ipAddress),
    createdAt: d(row.createdAt),
  };
}

function toPlatformSettingRow(row: Row): Prisma.PlatformSettingCreateManyInput {
  return {
    key: s(row.key),
    value: s(row.value),
  };
}

function toAlertLogRow(row: Row): Prisma.AlertLogCreateManyInput {
  return {
    id: s(row.id),
    alertType: s(row.alertType),
    entityType: s(row.entityType),
    entityId: s(row.entityId),
    channel: s(row.channel),
    sentAt: d(row.sentAt),
  };
}

// ── handler ───────────────────────────────────────────────────────────────────

const TABLE_KEYS = [
  "users", "athleteProfiles", "organizerProfiles", "events", "eventRoutes", "eventCategories",
  "ticketBatches", "transferPayouts", "coupons", "orders", "registrations", "payments", "refunds",
  "resultImports", "raceResults", "fileAssets", "auditLogs", "platformSettings", "alertLogs",
] as const;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  let backup: Record<string, Row[]>;
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });
    const text = await file.text();
    backup = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Arquivo inválido ou corrompido" }, { status: 400 });
  }

  const fileKeys = Object.keys(backup);
  const hasAnyKnownKey = TABLE_KEYS.some((k) => fileKeys.includes(k));
  if (!hasAnyKnownKey) {
    return NextResponse.json({ error: "Arquivo não parece ser um backup válido deste sistema" }, { status: 400 });
  }

  const users = (backup.users ?? []).map(toUserRow);
  const athleteProfiles = (backup.athleteProfiles ?? []).map(toAthleteProfileRow);
  const organizerProfiles = (backup.organizerProfiles ?? []).map(toOrganizerProfileRow);
  const events = (backup.events ?? []).map(toEventRow);
  const eventRoutes = (backup.eventRoutes ?? []).map(toEventRouteRow);
  const eventCategories = (backup.eventCategories ?? []).map(toEventCategoryRow);
  const ticketBatches = (backup.ticketBatches ?? []).map(toTicketBatchRow);
  const transferPayouts = (backup.transferPayouts ?? []).map(toTransferPayoutRow);
  const coupons = (backup.coupons ?? []).map(toCouponRow);
  const orders = (backup.orders ?? []).map(toOrderRow);
  const registrations = (backup.registrations ?? []).map(toRegistrationRow);
  const payments = (backup.payments ?? []).map(toPaymentRow);
  const refunds = (backup.refunds ?? []).map(toRefundRow);
  const resultImports = (backup.resultImports ?? []).map(toResultImportRow);
  const raceResults = (backup.raceResults ?? []).map(toRaceResultRow);
  const fileAssets = (backup.fileAssets ?? []).map(toFileAssetRow);
  const auditLogs = (backup.auditLogs ?? []).map(toAuditLogRow);
  const platformSettings = (backup.platformSettings ?? []).map(toPlatformSettingRow);
  const alertLogs = (backup.alertLogs ?? []).map(toAlertLogRow);

  try {
    const tables: TableResult[] = await db.$transaction(
      async (tx) => {
        // Apaga filhos antes de pais, respeitando foreign keys.
        await tx.raceResult.deleteMany({});
        await tx.resultImport.deleteMany({});
        await tx.refund.deleteMany({});
        await tx.payment.deleteMany({});
        await tx.registration.deleteMany({});
        await tx.order.deleteMany({});
        await tx.fileAsset.deleteMany({});
        await tx.auditLog.deleteMany({});
        await tx.transferPayout.deleteMany({});
        await tx.coupon.deleteMany({});
        await tx.ticketBatch.deleteMany({});
        await tx.eventCategory.deleteMany({});
        await tx.eventRoute.deleteMany({});
        await tx.event.deleteMany({});
        await tx.athleteProfile.deleteMany({});
        await tx.organizerProfile.deleteMany({});
        await tx.user.deleteMany({});
        await tx.platformSetting.deleteMany({});
        await tx.alertLog.deleteMany({});

        // Insere pais antes de filhos — ordem inversa da exclusão.
        if (users.length) await tx.user.createMany({ data: users });
        if (athleteProfiles.length) await tx.athleteProfile.createMany({ data: athleteProfiles });
        if (organizerProfiles.length) await tx.organizerProfile.createMany({ data: organizerProfiles });
        if (events.length) await tx.event.createMany({ data: events });
        if (eventRoutes.length) await tx.eventRoute.createMany({ data: eventRoutes });
        if (eventCategories.length) await tx.eventCategory.createMany({ data: eventCategories });
        if (ticketBatches.length) await tx.ticketBatch.createMany({ data: ticketBatches });
        if (transferPayouts.length) await tx.transferPayout.createMany({ data: transferPayouts });
        if (coupons.length) await tx.coupon.createMany({ data: coupons });
        if (orders.length) await tx.order.createMany({ data: orders });
        if (registrations.length) await tx.registration.createMany({ data: registrations });
        if (payments.length) await tx.payment.createMany({ data: payments });
        if (refunds.length) await tx.refund.createMany({ data: refunds });
        if (resultImports.length) await tx.resultImport.createMany({ data: resultImports });
        if (raceResults.length) await tx.raceResult.createMany({ data: raceResults });
        if (fileAssets.length) await tx.fileAsset.createMany({ data: fileAssets });
        if (auditLogs.length) await tx.auditLog.createMany({ data: auditLogs });
        if (platformSettings.length) await tx.platformSetting.createMany({ data: platformSettings });
        if (alertLogs.length) await tx.alertLog.createMany({ data: alertLogs });

        return [
          { table: "users", restored: users.length },
          { table: "athleteProfiles", restored: athleteProfiles.length },
          { table: "organizerProfiles", restored: organizerProfiles.length },
          { table: "events", restored: events.length },
          { table: "eventRoutes", restored: eventRoutes.length },
          { table: "eventCategories", restored: eventCategories.length },
          { table: "ticketBatches", restored: ticketBatches.length },
          { table: "transferPayouts", restored: transferPayouts.length },
          { table: "coupons", restored: coupons.length },
          { table: "orders", restored: orders.length },
          { table: "registrations", restored: registrations.length },
          { table: "payments", restored: payments.length },
          { table: "refunds", restored: refunds.length },
          { table: "resultImports", restored: resultImports.length },
          { table: "raceResults", restored: raceResults.length },
          { table: "fileAssets", restored: fileAssets.length },
          { table: "auditLogs", restored: auditLogs.length },
          { table: "platformSettings", restored: platformSettings.length },
          { table: "alertLogs", restored: alertLogs.length },
        ];
      },
      { maxWait: 10_000, timeout: 100_000 },
    );

    const totalRestored = tables.reduce((sum, t) => sum + t.restored, 0);
    return NextResponse.json({ tables, totalRestored });
  } catch (err) {
    return NextResponse.json(
      { error: `Restauração cancelada, nenhum dado foi alterado: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
```

Nota: `cancellationDeadline`, `cancellationRequiresApproval`, `cancellationContactPhone`, `cancellationContactEmail` (Event) e `cancellationReason`, `cancellationRequestedAt` (Registration) não eram restaurados pelo código antigo — ficavam sempre em branco depois de um restore. Esta reescrita já corrige isso, porque esses campos fazem parte da mesma linha que precisava ser mapeada de qualquer forma.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/backup-import-route.test.ts`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: todos os testes passam.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/backup/import/route.ts tests/backup-import-route.test.ts
git commit -m "feat: import de backup passa a ser substituicao total transacional"
```

---

### Task 3: UI com rede de segurança e confirmação explícita

**Files:**
- Modify: `components/admin/BackupImportButton.tsx` (reescrita completa)
- Modify: `app/admin/backup/page.tsx:53-81` (textos)

**Interfaces:**
- Consumes: resposta da Task 2 — `{ tables: Array<{ table: string; restored: number }>, totalRestored: number }` em sucesso, `{ error: string }` em falha; e `GET /api/admin/backup` (endpoint já existente, agora ampliado pela Task 1) para o snapshot de segurança.

- [ ] **Step 1: Reescrever `components/admin/BackupImportButton.tsx`**

Substitua o arquivo inteiro por:

```tsx
"use client";

import { useRef, useState } from "react";

type TableResult = { table: string; restored: number };
type ImportResult = { tables: TableResult[]; totalRestored: number };

type Phase = "idle" | "confirming" | "snapshotting" | "uploading" | "done" | "error";

const TABLE_LABELS: Record<string, string> = {
  users: "Usuários",
  athleteProfiles: "Perfis de atleta",
  organizerProfiles: "Perfis de organizador",
  events: "Eventos",
  eventRoutes: "Percursos",
  eventCategories: "Categorias",
  ticketBatches: "Lotes",
  transferPayouts: "Repasses",
  coupons: "Cupons",
  orders: "Pedidos",
  registrations: "Inscrições",
  payments: "Pagamentos",
  refunds: "Estornos",
  resultImports: "Importações de resultado",
  raceResults: "Resultados",
  fileAssets: "Arquivos",
  auditLogs: "Logs de auditoria",
  platformSettings: "Configurações da plataforma",
  alertLogs: "Logs de alerta",
};

const TABLE_KEYS = Object.keys(TABLE_LABELS);
const CONFIRM_WORD = "CONFIRMAR";

function countsFromBackup(backup: Record<string, unknown>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of TABLE_KEYS) {
    const value = backup[key];
    counts[key] = Array.isArray(value) ? value.length : 0;
  }
  return counts;
}

async function downloadCurrentSnapshot() {
  const res = await fetch("/api/admin/backup");
  if (!res.ok) throw new Error("Falha ao gerar backup de segurança do estado atual");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const now = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const a = document.createElement("a");
  a.href = url;
  a.download = `pre-restore-backup-${now}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function BackupImportButton() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function resetToIdle() {
    setPhase("idle");
    setPendingFile(null);
    setCounts(null);
    setConfirmText("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    setResult(null);

    if (!file.name.endsWith(".json") && file.type !== "application/json") {
      setErrorMsg("Selecione um arquivo .json gerado pelo backup deste sistema.");
      setPhase("error");
      return;
    }

    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      if (!TABLE_KEYS.some((k) => Object.prototype.hasOwnProperty.call(obj, k))) {
        throw new Error("Arquivo não parece ser um backup válido deste sistema.");
      }
      setCounts(countsFromBackup(obj));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Arquivo JSON inválido.");
      setPhase("error");
      return;
    }

    setPendingFile(file);
    setConfirmText("");
    setPhase("confirming");
  }

  async function handleConfirm() {
    if (!pendingFile || confirmText !== CONFIRM_WORD) return;

    setPhase("snapshotting");
    setErrorMsg(null);

    try {
      await downloadCurrentSnapshot();
    } catch (err) {
      setErrorMsg(
        (err instanceof Error ? err.message : "Falha ao gerar backup de segurança") +
          " — importação cancelada, nada foi apagado.",
      );
      setPhase("error");
      return;
    }

    setPhase("uploading");

    try {
      const formData = new FormData();
      formData.append("file", pendingFile);

      const res = await fetch("/api/admin/backup/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(typeof data.error === "string" ? data.error : `Erro HTTP ${res.status}`);
        setPhase("error");
        return;
      }

      setResult(data as ImportResult);
      setPhase("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro de conexão.");
      setPhase("error");
    } finally {
      setPendingFile(null);
      setCounts(null);
      setConfirmText("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const isWorking = phase === "snapshotting" || phase === "uploading";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label
          className={`btn-secondary cursor-pointer ${isWorking || phase === "confirming" ? "opacity-60 pointer-events-none" : ""}`}
        >
          Selecionar arquivo .json
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            disabled={isWorking || phase === "confirming"}
            onChange={handleFile}
          />
        </label>
        {phase === "done" && (
          <span className="text-sm text-green-600 dark:text-green-400 font-medium">
            ✓ Restauração concluída
          </span>
        )}
      </div>

      {phase === "confirming" && counts && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 space-y-3">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">
            Isso vai apagar todos os dados atuais e substituir pelo conteúdo deste arquivo. Um
            backup do estado atual será baixado automaticamente antes de apagar.
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-red-800 dark:text-red-300">
            {TABLE_KEYS.filter((k) => counts[k] > 0).map((k) => (
              <div key={k} className="flex justify-between">
                <span>{TABLE_LABELS[k]}</span>
                <span className="font-medium">{counts[k].toLocaleString("pt-BR")}</span>
              </div>
            ))}
          </div>
          <label className="block text-xs font-medium text-red-800 dark:text-red-300">
            Digite {CONFIRM_WORD} para confirmar
            <input
              type="text"
              className="input mt-1"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={resetToIdle}>
              Cancelar
            </button>
            <button
              type="button"
              className="text-sm px-4 py-2 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              disabled={confirmText !== CONFIRM_WORD}
              onClick={handleConfirm}
            >
              Prosseguir e apagar
            </button>
          </div>
        </div>
      )}

      {phase === "snapshotting" && (
        <p className="text-sm text-gray-500">Baixando backup de segurança do estado atual…</p>
      )}
      {phase === "uploading" && (
        <p className="text-sm text-gray-500">Restaurando dados do backup…</p>
      )}

      {phase === "error" && errorMsg && (
        <div className="text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
          <strong>Erro:</strong> {errorMsg}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            {result.totalRestored.toLocaleString("pt-BR")} registros restaurados
          </p>

          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase text-gray-500">
                  <th className="px-4 py-2">Tabela</th>
                  <th className="px-4 py-2 text-right">Restaurados</th>
                </tr>
              </thead>
              <tbody>
                {result.tables
                  .filter((t) => t.restored > 0)
                  .map((t) => (
                    <tr key={t.table} className="border-t dark:border-gray-700">
                      <td className="px-4 py-2 font-medium">{TABLE_LABELS[t.table] ?? t.table}</td>
                      <td className="px-4 py-2 text-right text-green-700 dark:text-green-400">
                        {t.restored.toLocaleString("pt-BR")}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Atualizar os textos de `app/admin/backup/page.tsx`**

No mesmo arquivo, troque o bloco "Exportar" (linhas 54-66) por:

```tsx
      {/* Exportar */}
      <div className="card space-y-4">
        <h2 className="font-semibold">Exportar backup</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          O backup inclui todas as tabelas do sistema: usuários, perfis, eventos, inscrições,
          pedidos, pagamentos, cupons, lotes, categorias, percursos, repasses, resultados,
          arquivos, logs de auditoria e configurações da plataforma. Os dados são exportados em
          JSON com streaming — funciona mesmo com grandes volumes sem timeout.
        </p>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
          <strong>Atenção:</strong> o arquivo de backup contém dados sensíveis (e-mails, informações pessoais,
          dados financeiros). Armazene-o em local seguro e com acesso restrito.
        </div>
        <BackupDownloadButton />
      </div>
```

E troque o bloco "Importar" (linhas 68-81) por:

```tsx
      {/* Restaurar */}
      <div className="card space-y-4">
        <h2 className="font-semibold">Restaurar backup</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Selecione um arquivo <code className="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">.json</code> gerado
          pelo exportador acima. A restauração <strong>apaga todos os dados atuais</strong> das tabelas cobertas pelo backup
          e insere exatamente o conteúdo do arquivo — não é uma mesclagem, e IDs ou e-mails antigos não são preservados.
        </p>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-sm text-red-800 dark:text-red-300">
          <strong>Atenção:</strong> essa ação é destrutiva e não pode ser desfeita pelo sistema. Antes de apagar, um
          backup do estado atual é baixado automaticamente no seu navegador. Use somente em ambiente controlado e com
          certeza do que está restaurando.
        </div>
        <BackupImportButton />
      </div>
```

- [ ] **Step 3: Rodar a suíte de testes para garantir que nada quebrou**

Run: `npx vitest run`
Expected: todos os testes passam (este componente não tem harness de teste de UI no repositório — a verificação é manual, no próximo passo).

- [ ] **Step 4: Verificação manual no navegador**

Suba o servidor de dev e teste o fluxo completo:

Run: `npm run dev`

No navegador, acesse `/admin/backup` logado como admin e confirme:
1. Selecionar um `.json` de backup mostra o card vermelho de confirmação com a contagem por tabela.
2. O botão "Prosseguir e apagar" fica desabilitado até digitar exatamente `CONFIRMAR`.
3. Ao confirmar, o navegador baixa um arquivo `pre-restore-backup-<timestamp>.json` antes de a tela mudar para "Restaurando dados do backup…".
4. Ao final, a tabela de resultado mostra "registros restaurados" por tabela (sem coluna de erros).
5. Em modo escuro, o card de confirmação e o resultado permanecem legíveis (mesmo padrão de cores do restante do admin).

Pare o servidor depois de verificar.

- [ ] **Step 5: Commit**

```bash
git add components/admin/BackupImportButton.tsx app/admin/backup/page.tsx
git commit -m "feat: confirmacao explicita e snapshot de seguranca no restore de backup"
```
