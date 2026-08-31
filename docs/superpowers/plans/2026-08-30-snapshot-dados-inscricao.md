# Snapshot de dados da inscrição — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada inscrição passa a ter um snapshot congelado dos 6 dados de identidade do participante (nome, e-mail, telefone, nascimento, gênero, CPF), preenchido no checkout, editável só por rotas auditadas, e lido por todos os consumidores — a conta do atleta deixa de ser a fonte desses dados numa inscrição.

**Architecture:** 6 colunas `participant*` em `registrations` + `Event.registrationEditDeadline`. O checkout preenche o snapshot (`resolveParticipantIdentity` em `lib/checkout.ts`). Um script de backfill preenche as inscrições existentes. 3 rotas `PATCH` (organizador / admin / atleta) editam só os `participant*`, nunca `User`/`AthleteProfile`, com auditoria before/after; a do atleta é liberada por `registrationEditDeadline`. Os ~30 consumidores passam a ler `participant*`.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Prisma 5 + PostgreSQL, Vitest, Tailwind, zod.

**Spec:** `docs/superpowers/specs/2026-08-30-snapshot-dados-inscricao-design.md`

## Global Constraints

- **`participant*` são a ÚNICA fonte** de nome/e-mail/CPF/telefone/nascimento/gênero de uma inscrição depois deste sub-projeto. Nenhum consumidor de inscrição lê `registration.athlete.name` (ou via `include`) para exibir/exportar dados da inscrição. Sobrou algum → bug (grep adversarial confirma).
- **`participantName` e `participantEmail` são NOT NULL** com `@default("")`. `participantPhone/BirthDate/Gender/Cpf` nullable.
- **As rotas de edição NUNCA escrevem em `User` nem `AthleteProfile`.**
- **RBAC anti-IDOR:** organizador só toca inscrição de evento do próprio `organizerId` (`resolveActingScope(session).organizerId` + `event.organizerId`); assistente idem com `checkApiPermission("registrations.edit-athlete", { eventId })`; admin qualquer uma; atleta só a própria (`athleteUserId === session.user.id`).
- **Auditoria:** toda edição grava `AuditLog` `action: "REGISTRATION_PARTICIPANT_UPDATED"`, `entityType: "Registration"`, `entityId: <id>`, `metadata: { before, after }` (só campos que mudaram; a do atleta adiciona `by: "athlete"`).
- **CPF:** `isValidCpf` + `normalizeCpf` (`lib/cpf.ts`) antes de gravar; inválido → 400. Sem checagem de duplicidade. `participantCpf` sem `@unique`, guardado só-dígitos.
- **Auto-edição do atleta:** só se `event.registrationEditDeadline != null` E `> new Date()`. Campos permitidos ao atleta: `name, phone, birthDate, gender, shirtSize, teamName, emergencyContactName, emergencyContactPhone`. **`email` e `cpf` não são declarados no zod dessa rota nem lidos.**
- **Migração de schema:** migração Prisma nova, em prod via **`prisma db push`** (nunca `prisma migrate deploy` — `_prisma_migrations` congelado desde 2026-07-08). Backfill de dados = script TS rodado no container **antes do restart**.
- `prisma/migrations/` é gitignored → `git add -f`.
- **Centavos em `Int`** (convenção do projeto; não se aplica aqui).

---

## File Structure

**Novos:**
- `prisma/backfill-registration-participants.ts` — backfill das inscrições existentes.
- `lib/registrations/participant-identity.ts` — `resolveParticipantIdentity()` (usado pelo checkout) + `ParticipantIdentity` type + `pickParticipantChanges()` (diff before/after pra auditoria).
- `app/api/organizer/registrations/[id]/route.ts` — `PATCH` (organizador edita o snapshot).
- `app/api/admin/registrations/[id]/route.ts` — `PATCH` (admin edita o snapshot).
- `app/api/athlete/registrations/[id]/route.ts` — `PATCH` (atleta edita a própria inscrição, gated).

**Modificados:**
- `prisma/schema.prisma` — 6 campos em `Registration`, 1 em `Event`.
- `lib/checkout.ts` — preenche `participant*` no `tx.registration.create`.
- `app/api/events/[id]/route.ts` + a rota admin equivalente de edição de evento — `registrationEditDeadline`.
- `components/organizer/EventForm`/`EditEventForm` + a admin — campo "Prazo para o atleta editar a inscrição".
- `components/registrations/AthleteDetailsModal.tsx` + `RegistrationsTable.tsx` — alimentar/editar `participant*`; endpoint novo; 2º botão "editar cadastro do atleta".
- `app/organizador/eventos/[id]/inscritos/page.tsx` + `app/admin/eventos/[id]/inscritos/page.tsx` — `editEndpoint` novo + select `participant*`.
- `lib/organizer/registrations.ts`, `lib/registrations/pending-queue.ts`, `app/api/events/[id]/registrations/route.ts` — select + leitura `participant*`.
- `app/organizador/eventos/[id]/relatorio-geral/page.tsx` + admin, `components/registrations/GeneralReportTable.tsx`, `lib/reports/general-report.ts` — `participant*`.
- `lib/registrations/export.ts`, `app/api/events/[id]/kit-deliveries/report-export/route.ts` — colunas `participant*`.
- `lib/kit-delivery.ts`, `app/api/registrations/[id]/qrcode/route.ts`, `app/organizador/eventos/[id]/entrega-kits/EntregaKitsClient.tsx` — `participantName` / busca por `participantCpf`.
- `app/dashboard/inscricoes/page.tsx` + `[id]/page.tsx` — `participant*`.
- `app/(public)/eventos/[slug]/resultados/page.tsx` — `participantName`.
- `lib/notifications.ts`, `lib/alerts/{payment-error,abandoned-cart,cancellation-requested,registration-cancelled-by-staff}.ts`, `lib/templates/variables.ts` — `participant*`.
- `lib/campaigns/recipients.ts`, `lib/campaigns/resolve-recipient-variables.ts`, `app/api/cron/send-campaign-messages/route.ts` — `participantName`/`participantPhone` (null → pula).
- `app/api/admin/backup/import/route.ts` — `toRegistrationRow` + `toEventRow`.
- `components/registrations/PendingCancellationsTable.tsx`, `components/payment/PendingRefundsTable.tsx` — `participant*`.
- `tests/setup.ts` — se algum mock de `registration` precisar dos campos novos por default.

---

## Task 1: Schema + migração

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_registration_participant_snapshot/migration.sql`
- Test: `tests/registration-participant-schema.test.ts`

**Interfaces:**
- Produces: `Registration.participantName/Email` (String NOT NULL `@default("")`), `participantPhone/BirthDate/Gender/Cpf` (nullable); `Event.registrationEditDeadline DateTime?`.

- [ ] **Step 1: Editar o schema**

Em `model Registration`, adicionar (perto de `medicalNotes` / `proxyAthleteDisplayName`):

```prisma
  participantName      String    @default("")
  participantEmail     String    @default("")
  participantPhone     String?
  participantBirthDate DateTime?
  participantGender    String?
  participantCpf       String?
```

Em `model Event`, adicionar (perto de `shirtSizeRestrictionDate`):

```prisma
  registrationEditDeadline DateTime?
```

- [ ] **Step 2: Gerar a migração (sem aplicar em prod)**

```bash
npx prisma migrate dev --name registration_participant_snapshot --create-only
```

Conferir o SQL: `ALTER TABLE "registrations" ADD COLUMN "participantName" TEXT NOT NULL DEFAULT ''` (idem `participantEmail`), 4 `ADD COLUMN` nullable, e `ALTER TABLE "events" ADD COLUMN "registrationEditDeadline" TIMESTAMP(3)`. Nenhum `DROP`, nenhum índice.

- [ ] **Step 3: Aplicar local + regenerar**

```bash
npx prisma migrate dev --name registration_participant_snapshot
npx prisma generate
```

- [ ] **Step 4: Teste — o client conhece os campos**

```ts
// tests/registration-participant-schema.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

describe("schema snapshot de inscrição", () => {
  it("Registration tem os 6 participant*", () => {
    const m = Prisma.dmmf.datamodel.models.find((x) => x.name === "Registration")!;
    const f = Object.fromEntries(m.fields.map((x) => [x.name, x]));
    expect(f.participantName.isRequired).toBe(true);
    expect(f.participantEmail.isRequired).toBe(true);
    for (const n of ["participantPhone", "participantBirthDate", "participantGender", "participantCpf"]) {
      expect(f[n].isRequired).toBe(false);
    }
  });
  it("Event tem registrationEditDeadline opcional", () => {
    const m = Prisma.dmmf.datamodel.models.find((x) => x.name === "Event")!;
    expect(m.fields.find((x) => x.name === "registrationEditDeadline")!.isRequired).toBe(false);
  });
});
```

- [ ] **Step 5: Rodar**

Run: `npx vitest run tests/registration-participant-schema.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma tests/registration-participant-schema.test.ts
git add -f prisma/migrations/
git commit -m "feat(schema): snapshot participant* na Registration + Event.registrationEditDeadline"
```

---

## Task 2: Backfill das inscrições existentes

**Files:**
- Create: `prisma/backfill-registration-participants.ts`
- Test: `tests/backfill-registration-participants.test.ts`

**Interfaces:**
- Consumes: schema do Task 1.
- Produces: `export async function backfillRegistrationParticipants(prisma: Pick<PrismaClient, "registration">): Promise<{ updated: number }>`.

- [ ] **Step 1: Teste**

```ts
// tests/backfill-registration-participants.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { backfillRegistrationParticipants } from "@/prisma/backfill-registration-participants";

function makePrisma(pages: any[][]) {
  let call = 0;
  return {
    registration: {
      findMany: vi.fn().mockImplementation(() => Promise.resolve(pages[call++] ?? [])),
      update: vi.fn().mockResolvedValue({}),
    },
  } as any;
}

beforeEach(() => vi.clearAllMocks());

it("preenche participant* das linhas com participantName vazio, do athlete", async () => {
  const prisma = makePrisma([[
    { id: "r1", participantName: "", participantEmail: "",
      athlete: { name: "Maria", email: "m@x.com", athleteProfile: { phone: "11", birthDate: new Date("1990-01-01"), gender: "F", cpf: "12345678901" } } },
  ], []]);
  const res = await backfillRegistrationParticipants(prisma);
  expect(prisma.registration.update).toHaveBeenCalledWith({
    where: { id: "r1" },
    data: { participantName: "Maria", participantEmail: "m@x.com", participantPhone: "11",
      participantBirthDate: new Date("1990-01-01"), participantGender: "F", participantCpf: "12345678901" },
  });
  expect(res).toEqual({ updated: 1 });
});

it("atleta sem AthleteProfile → só nome e email, resto null", async () => {
  const prisma = makePrisma([[
    { id: "r2", participantName: "", participantEmail: "",
      athlete: { name: "João", email: "j@x.com", athleteProfile: null } },
  ], []]);
  await backfillRegistrationParticipants(prisma);
  expect(prisma.registration.update).toHaveBeenCalledWith({
    where: { id: "r2" },
    data: { participantName: "João", participantEmail: "j@x.com", participantPhone: null,
      participantBirthDate: null, participantGender: null, participantCpf: null },
  });
});

it("idempotente: linha já preenchida (participantName != '') não é buscada de novo", async () => {
  const prisma = makePrisma([[]]);  // findMany já filtra por participantName === ""
  const res = await backfillRegistrationParticipants(prisma);
  expect(prisma.registration.update).not.toHaveBeenCalled();
  expect(res).toEqual({ updated: 0 });
});
```

- [ ] **Step 2: Rodar — falha**

Run: `npx vitest run tests/backfill-registration-participants.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

```ts
// prisma/backfill-registration-participants.ts
import { PrismaClient } from "@prisma/client";

const PAGE = 500;

export async function backfillRegistrationParticipants(
  prisma: Pick<PrismaClient, "registration">,
): Promise<{ updated: number }> {
  let cursor: string | undefined;
  let updated = 0;
  for (;;) {
    const rows = await prisma.registration.findMany({
      where: { participantName: "" },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        athlete: {
          select: {
            name: true, email: true,
            athleteProfile: { select: { phone: true, birthDate: true, gender: true, cpf: true } },
          },
        },
      },
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      await prisma.registration.update({
        where: { id: r.id },
        data: {
          participantName: r.athlete.name,
          participantEmail: r.athlete.email,
          participantPhone: r.athlete.athleteProfile?.phone ?? null,
          participantBirthDate: r.athlete.athleteProfile?.birthDate ?? null,
          participantGender: r.athlete.athleteProfile?.gender ?? null,
          participantCpf: r.athlete.athleteProfile?.cpf ?? null,
        },
      });
      updated++;
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < PAGE) break;
  }
  return { updated };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  backfillRegistrationParticipants(prisma)
    .then((r) => { console.log("[backfill-registration-participants]", r); return prisma.$disconnect(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Rodar — passa** (`npx vitest run tests/backfill-registration-participants.test.ts`)

- [ ] **Step 5: Rodar no banco local**

```bash
npx tsx prisma/backfill-registration-participants.ts
```

- [ ] **Step 6: Commit**

```bash
git add prisma/backfill-registration-participants.ts tests/backfill-registration-participants.test.ts
git commit -m "feat(registrations): backfill dos participant* das inscrições existentes"
```

---

## Task 3: Snapshot no checkout + helpers

**Files:**
- Create: `lib/registrations/participant-identity.ts`
- Modify: `lib/checkout.ts` (região do `tx.registration.create`, ~linha 209)
- Test: `tests/checkout-participant-snapshot.test.ts` (novo); `tests/checkout-route.test.ts` verde

**Interfaces:**
- Consumes: schema Task 1.
- Produces:
  - `interface ParticipantIdentity { name: string; email: string; phone: string | null; birthDate: Date | null; gender: string | null; cpf: string | null }`
  - `async function resolveParticipantIdentity(tx: Prisma.TransactionClient, input: { proxyAthlete?: { name: string; email?: string; phone: string; birthDate: string; cpf: string } }, athleteUserId: string): Promise<ParticipantIdentity>`
  - `function participantSnapshotData(id: ParticipantIdentity): { participantName; participantEmail; participantPhone; participantBirthDate; participantGender; participantCpf }` (pronto pra espalhar no `create`)
  - `function pickParticipantChanges(before, after): { before: Record<string,unknown>; after: Record<string,unknown> }` (só os campos que diferem — usado pela auditoria nas Tasks 4/5/6)

- [ ] **Step 1: Teste**

```ts
// tests/checkout-participant-snapshot.test.ts
import { describe, it, expect, vi } from "vitest";
import { resolveParticipantIdentity, participantSnapshotData, pickParticipantChanges } from "@/lib/registrations/participant-identity";

it("inscrição normal: identity vem do User + AthleteProfile", async () => {
  const tx = { user: { findUnique: vi.fn().mockResolvedValue({
    name: "Ana", email: "ana@x.com",
    athleteProfile: { phone: "11", birthDate: new Date("1990-01-01"), gender: "F", cpf: "12345678901" },
  }) } } as any;
  const id = await resolveParticipantIdentity(tx, {}, "u1");
  expect(id).toEqual({ name: "Ana", email: "ana@x.com", phone: "11", birthDate: new Date("1990-01-01"), gender: "F", cpf: "12345678901" });
});

it("proxy: identity vem do payload; email cai no email do user quando o proxy não informou", async () => {
  const tx = { user: { findUnique: vi.fn().mockResolvedValue({ name: "X", email: "placeholder@local", athleteProfile: null }) } } as any;
  const id = await resolveParticipantIdentity(tx, {
    proxyAthlete: { name: "Bruno", phone: "22", birthDate: "1985-05-05", cpf: "98765432100" },
  }, "u2");
  expect(id.name).toBe("Bruno");
  expect(id.email).toBe("placeholder@local");
  expect(id.gender).toBeNull();
  expect(id.cpf).toBe("98765432100");
});

it("participantSnapshotData normaliza o CPF e mapeia os nomes de coluna", () => {
  const d = participantSnapshotData({ name: "A", email: "a@x", phone: null, birthDate: null, gender: null, cpf: "123.456.789-01" });
  expect(d).toEqual({ participantName: "A", participantEmail: "a@x", participantPhone: null, participantBirthDate: null, participantGender: null, participantCpf: "12345678901" });
});

it("pickParticipantChanges retorna só o que mudou", () => {
  const r = pickParticipantChanges(
    { participantName: "A", participantCpf: "1" },
    { participantName: "B", participantCpf: "1" },
  );
  expect(r).toEqual({ before: { participantName: "A" }, after: { participantName: "B" } });
});
```

- [ ] **Step 2: Rodar — falha**

Run: `npx vitest run tests/checkout-participant-snapshot.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `participant-identity.ts`**

```ts
import type { Prisma } from "@prisma/client";
import { normalizeCpf } from "@/lib/cpf";

export interface ParticipantIdentity {
  name: string; email: string; phone: string | null;
  birthDate: Date | null; gender: string | null; cpf: string | null;
}

export async function resolveParticipantIdentity(
  tx: Prisma.TransactionClient,
  input: { proxyAthlete?: { name: string; email?: string; phone: string; birthDate: string; cpf: string } },
  athleteUserId: string,
): Promise<ParticipantIdentity> {
  const user = await tx.user.findUnique({
    where: { id: athleteUserId },
    select: { name: true, email: true, athleteProfile: { select: { phone: true, birthDate: true, gender: true, cpf: true } } },
  });
  if (input.proxyAthlete) {
    const p = input.proxyAthlete;
    return {
      name: p.name,
      email: p.email?.trim() || user?.email || "",
      phone: p.phone ?? null,
      birthDate: p.birthDate ? new Date(p.birthDate) : null,
      gender: null,
      cpf: p.cpf ? normalizeCpf(p.cpf) : null,
    };
  }
  return {
    name: user?.name ?? "",
    email: user?.email ?? "",
    phone: user?.athleteProfile?.phone ?? null,
    birthDate: user?.athleteProfile?.birthDate ?? null,
    gender: user?.athleteProfile?.gender ?? null,
    cpf: user?.athleteProfile?.cpf ?? null,
  };
}

export function participantSnapshotData(id: ParticipantIdentity) {
  return {
    participantName: id.name,
    participantEmail: id.email,
    participantPhone: id.phone,
    participantBirthDate: id.birthDate,
    participantGender: id.gender,
    participantCpf: id.cpf ? normalizeCpf(id.cpf) : null,
  };
}

const FIELDS = ["participantName", "participantEmail", "participantPhone", "participantBirthDate", "participantGender", "participantCpf"] as const;

export function pickParticipantChanges(
  before: Record<string, unknown>, after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {}, a: Record<string, unknown> = {};
  for (const f of FIELDS) {
    if (f in after && String(after[f] ?? "") !== String(before[f] ?? "")) { b[f] = before[f] ?? null; a[f] = after[f] ?? null; }
  }
  return { before: b, after: a };
}
```

- [ ] **Step 4: Ligar no `lib/checkout.ts`**

Antes do `const registration = await tx.registration.create({`:

```ts
const participantIdentity = await resolveParticipantIdentity(tx, input, athleteUserId);
```

No `data:` do `create`, adicionar: `...participantSnapshotData(participantIdentity),`

- [ ] **Step 5: Rodar testes**

Run: `npx vitest run tests/checkout-participant-snapshot.test.ts tests/checkout-route.test.ts tests/checkout-payment-account.test.ts`
Expected: PASS (ajustar `tests/checkout-route.test.ts` se ele faz `toHaveBeenCalledWith` estrito no `registration.create` — adicionar os `participant*` na expectativa)

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/registrations/participant-identity.ts lib/checkout.ts tests/checkout-participant-snapshot.test.ts tests/checkout-route.test.ts
git commit -m "feat(checkout): preenche o snapshot participant* na inscrição"
```

---

## Task 4: `PATCH /api/organizer/registrations/[id]`

**Files:**
- Create: `app/api/organizer/registrations/[id]/route.ts`
- Test: `tests/organizer-registration-participant-route.test.ts`

**Interfaces:**
- Consumes: `pickParticipantChanges` (Task 3); `checkApiPermission`, `resolveActingScope` (`lib/auth/rbac`); `isValidCpf`, `normalizeCpf` (`lib/cpf`).

- [ ] **Step 1: Teste**

```ts
// tests/organizer-registration-participant-route.test.ts
// Mocka @/lib/auth, @/lib/db, @/lib/auth/rbac.
// Casos:
//  - organizador de outro evento (event.organizerId != scope.organizerId, não admin) → 404
//  - CPF inválido no corpo → 400, nada gravado
//  - email inválido → 400
//  - corpo vazio → 400 "informe ao menos um campo"
//  - sucesso: db.registration.update com só os participant* enviados; NENHUM db.user.update / db.athleteProfile.update;
//    db.auditLog.create action "REGISTRATION_PARTICIPANT_UPDATED" com metadata.before/after só do que mudou
//  - assistente com registrations.edit-athlete no evento → passa (checkApiPermission chamado com { eventId })
```

- [ ] **Step 2: Rodar — falha**

Run: `npx vitest run tests/organizer-registration-participant-route.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";
import { pickParticipantChanges } from "@/lib/registrations/participant-identity";
import { Prisma } from "@prisma/client";

const schema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).nullable().optional(),
  birthDate: z.string().optional(),
  gender: z.string().max(20).nullable().optional(),
  cpf: z.string().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: "Informe ao menos um campo" });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reg = await db.registration.findUnique({
    where: { id },
    select: {
      eventId: true,
      participantName: true, participantEmail: true, participantPhone: true,
      participantBirthDate: true, participantGender: true, participantCpf: true,
      event: { select: { organizerId: true } },
    },
  });
  if (!reg) return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });

  const check = await checkApiPermission("registrations.edit-athlete", { eventId: reg.eventId });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  if (!scope.actingAsAdmin && reg.event.organizerId !== scope.organizerId) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  const data: Record<string, unknown> = {};
  if (b.name !== undefined) data.participantName = b.name.trim();
  if (b.email !== undefined) data.participantEmail = b.email.trim().toLowerCase();
  if (b.phone !== undefined) data.participantPhone = b.phone;
  if (b.gender !== undefined) data.participantGender = b.gender;
  if (b.birthDate !== undefined) {
    const d = new Date(b.birthDate);
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "Data de nascimento inválida" }, { status: 400 });
    data.participantBirthDate = d;
  }
  if (b.cpf !== undefined) {
    const c = normalizeCpf(b.cpf);
    if (!isValidCpf(c)) return NextResponse.json({ error: "CPF inválido" }, { status: 400 });
    data.participantCpf = c;
  }

  const changes = pickParticipantChanges(reg as Record<string, unknown>, { ...reg, ...data });

  await db.$transaction([
    db.registration.update({ where: { id }, data: data as Prisma.RegistrationUpdateInput }),
    db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "REGISTRATION_PARTICIPANT_UPDATED",
        entityType: "Registration",
        entityId: id,
        metadata: changes as Prisma.InputJsonValue,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Rodar — passa** (`npx vitest run tests/organizer-registration-participant-route.test.ts`)

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add app/api/organizer/registrations/[id]/route.ts tests/organizer-registration-participant-route.test.ts
git commit -m "feat(api): PATCH organizer/registrations/[id] — edita o snapshot da inscrição"
```

---

## Task 5: `PATCH /api/admin/registrations/[id]` + actionKey admin

**Files:**
- Create: `app/api/admin/registrations/[id]/route.ts`
- Modify: `app/admin/assistentes/page.tsx` (`ADMIN_EVENT_ACTIONS` — actionKey nova)
- Test: `tests/admin-registration-participant-route.test.ts`

**Interfaces:**
- Consumes: `checkAdminOnlyApiPermission` (`lib/auth/rbac`); `pickParticipantChanges` (Task 3).
- Produces: actionKey `"registrations.edit-athlete-any"`.

- [ ] **Step 1: Teste**

```ts
// tests/admin-registration-participant-route.test.ts
//  - não-admin → 403
//  - admin: edita qualquer inscrição (sem checagem de organizerId); mesma validação de CPF/email;
//    db.registration.update só com participant*; NENHUM user.update; auditLog REGISTRATION_PARTICIPANT_UPDATED
//  - assistente-de-admin com registrations.edit-athlete-any global → passa
```

- [ ] **Step 2: Rodar — falha**

Run: `npx vitest run tests/admin-registration-participant-route.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar** — copia a estrutura do Task 4, trocando:
- guard: `const check = await checkAdminOnlyApiPermission("registrations.edit-athlete-any");`
- remover o bloco `resolveActingScope` / checagem de `organizerId` (admin edita qualquer uma).
- o `findUnique` não precisa de `event: { select: { organizerId } }`.

- [ ] **Step 4: actionKey** — em `app/admin/assistentes/page.tsx`, no `ADMIN_EVENT_ACTIONS`:

```ts
  { key: "registrations.edit-athlete-any", label: "Corrigir dados de uma inscrição (qualquer evento)" },
```

- [ ] **Step 5: Rodar — passa** (`npx vitest run tests/admin-registration-participant-route.test.ts`)

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add app/api/admin/registrations/[id]/route.ts app/admin/assistentes/page.tsx tests/admin-registration-participant-route.test.ts
git commit -m "feat(api): PATCH admin/registrations/[id] + actionKey registrations.edit-athlete-any"
```

---

## Task 6: `PATCH /api/athlete/registrations/[id]` (gated por deadline)

**Files:**
- Create: `app/api/athlete/registrations/[id]/route.ts`
- Test: `tests/athlete-registration-participant-route.test.ts`

**Interfaces:**
- Consumes: `pickParticipantChanges` (Task 3); `auth` (`@/lib/auth`).

- [ ] **Step 1: Teste**

```ts
// tests/athlete-registration-participant-route.test.ts
//  - inscrição de outro atleta (athleteUserId != session.user.id) → 404
//  - event.registrationEditDeadline null → 403
//  - deadline no passado → 403
//  - deadline no futuro → OK: registration.update com os campos permitidos; auditLog metadata.by === "athlete"
//  - corpo com email/cpf → ignorados (não aparecem no data do update)
//  - shirtSize/teamName/emergencyContact* também editáveis
```

- [ ] **Step 2: Rodar — falha**

Run: `npx vitest run tests/athlete-registration-participant-route.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { pickParticipantChanges } from "@/lib/registrations/participant-identity";
import { Prisma } from "@prisma/client";

const schema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(30).nullable().optional(),
  birthDate: z.string().optional(),
  gender: z.string().max(20).nullable().optional(),
  shirtSize: z.enum(["PP", "P", "M", "G", "GG", "XGG"]).nullable().optional(),
  teamName: z.string().max(100).nullable().optional(),
  emergencyContactName: z.string().max(100).nullable().optional(),
  emergencyContactPhone: z.string().max(30).nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: "Informe ao menos um campo" });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;

  const reg = await db.registration.findUnique({
    where: { id },
    select: {
      athleteUserId: true,
      participantName: true, participantEmail: true, participantPhone: true,
      participantBirthDate: true, participantGender: true, participantCpf: true,
      event: { select: { registrationEditDeadline: true } },
    },
  });
  if (!reg || reg.athleteUserId !== session.user.id) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }
  const deadline = reg.event.registrationEditDeadline;
  if (!deadline || deadline.getTime() <= Date.now()) {
    return NextResponse.json({ error: "A edição desta inscrição não está disponível." }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  const data: Record<string, unknown> = {};
  if (b.name !== undefined) data.participantName = b.name.trim();
  if (b.phone !== undefined) data.participantPhone = b.phone;
  if (b.gender !== undefined) data.participantGender = b.gender;
  if (b.birthDate !== undefined) {
    const d = new Date(b.birthDate);
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "Data de nascimento inválida" }, { status: 400 });
    data.participantBirthDate = d;
  }
  if (b.shirtSize !== undefined) data.shirtSize = b.shirtSize;
  if (b.teamName !== undefined) data.teamName = b.teamName;
  if (b.emergencyContactName !== undefined) data.emergencyContactName = b.emergencyContactName;
  if (b.emergencyContactPhone !== undefined) data.emergencyContactPhone = b.emergencyContactPhone;

  const changes = pickParticipantChanges(reg as Record<string, unknown>, { ...reg, ...data });

  await db.$transaction([
    db.registration.update({ where: { id }, data: data as Prisma.RegistrationUpdateInput }),
    db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "REGISTRATION_PARTICIPANT_UPDATED",
        entityType: "Registration",
        entityId: id,
        metadata: { ...changes, by: "athlete" } as Prisma.InputJsonValue,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Rodar — passa** (`npx vitest run tests/athlete-registration-participant-route.test.ts`)

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add app/api/athlete/registrations/[id]/route.ts tests/athlete-registration-participant-route.test.ts
git commit -m "feat(api): PATCH athlete/registrations/[id] — atleta edita a própria inscrição até o prazo"
```

---

## Task 7: `registrationEditDeadline` na edição de evento

**Files:**
- Modify: `app/api/events/[id]/route.ts` (`updateEventSchema` + o `data` do update)
- Modify: a rota admin equivalente de edição de evento (localizar: `grep -rl "updateEventSchema\|cancellationDeadline" app/api/admin`) — se existir; senão anotar que o admin edita evento pela mesma rota.
- Modify: `components/organizer/EditEventForm.tsx` (+ a admin, se separada) — campo date
- Test: `tests/events-id-route.test.ts` (adicionar caso) ou o teste da rota de evento existente

- [ ] **Step 1: Teste** — no teste da rota `PATCH /api/events/[id]` (existente), adicionar:

```ts
it("aceita registrationEditDeadline (ISO) e null", async () => {
  // organizador dono → PATCH { registrationEditDeadline: "2026-12-01T00:00:00.000Z" }
  //   → db.event.update chamado com data.registrationEditDeadline = new Date("2026-12-01...")
  // PATCH { registrationEditDeadline: null } → data.registrationEditDeadline = null
});
```

- [ ] **Step 2: Rodar — falha**

Run: `npx vitest run tests/events-id-route.test.ts`
Expected: FAIL (campo não reconhecido / não gravado)

- [ ] **Step 3: Implementar** — em `updateEventSchema`:

```ts
  registrationEditDeadline: z.string().datetime().optional().nullable(),
```

E onde monta o `data` do `db.event.update` (o padrão do arquivo pra `cancellationDeadline`):

```ts
  if (parsed.data.registrationEditDeadline !== undefined) {
    data.registrationEditDeadline = parsed.data.registrationEditDeadline
      ? new Date(parsed.data.registrationEditDeadline) : null;
  }
```

- [ ] **Step 4: Form** — em `EditEventForm.tsx`, perto do campo de `shirtSizeRestrictionDate` / `cancellationDeadline`, adicionar um `<input type="datetime-local">` "Prazo para o atleta editar a inscrição" ligado a `registrationEditDeadline` (converter pra ISO no submit, igual aos outros campos de data do form). Texto de ajuda: "Deixe em branco para que só o organizador possa editar os dados de uma inscrição."

- [ ] **Step 5: Rodar testes + build**

Run: `npx vitest run tests/events-id-route.test.ts && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/events/[id]/route.ts components/organizer/EditEventForm.tsx
git commit -m "feat(eventos): campo registrationEditDeadline (prazo do atleta editar a inscrição)"
```

---

## Task 8: `AthleteDetailsModal` + `RegistrationsTable` → snapshot + endpoint novo + 2º botão

**Files:**
- Modify: `components/registrations/AthleteDetailsModal.tsx`
- Modify: `components/registrations/RegistrationsTable.tsx`
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx` (`editEndpoint`), `app/admin/eventos/[id]/inscritos/page.tsx`
- Test: sem teste de UI; `npm run build`

- [ ] **Step 1: `RegistrationsTable` — o tipo `RegistrationRow` + o data source**

O `RegistrationRow` passa a carregar `participantName/Email/Cpf/Phone/BirthDate/Gender` (as páginas que montam a tabela — Task 9 — já vão selecionar isso). O `AthleteDetailsModal` recebe esses valores em vez de `athleteName`/`athleteEmail`/`profile`.

- [ ] **Step 2: `AthleteDetailsModal`** — o form de edição (`name/email/cpf/birthDate/phone/gender`) já existe e já faz `PATCH editEndpoint`. Mudanças:
  - as props que hoje são `athleteName` / `athleteEmail` / `profile` (do atleta) passam a ser os `participant*` da inscrição; o form inicializa deles.
  - o corpo do `PATCH` continua `{ name, email, cpf, birthDate, phone, gender }` — a rota nova (Task 4/5) aceita esse shape.
  - o título/label muda de "Editar dados do atleta" pra "Corrigir dados desta inscrição".
  - **2º botão** "Editar cadastro do atleta" → abre um modal/liga pro endpoint ANTIGO (`/api/organizer/registrations/${r.id}/athlete`, que segue existindo — ver Task 15 / §3.4 da spec). Pode reusar o mesmo componente de form com um `mode` prop e um `accountEndpoint` opcional.

- [ ] **Step 3: `inscritos` pages** — `editEndpoint={(r) => \`/api/organizer/registrations/\${r.id}\`}` (era `.../athlete`). Admin: `/api/admin/registrations/${r.id}`. Passar o `accountEndpoint` (antigo) pro 2º botão.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `✓ Compiled successfully`

- [ ] **Step 5: Commit**

```bash
git add components/registrations/AthleteDetailsModal.tsx components/registrations/RegistrationsTable.tsx "app/organizador/eventos/[id]/inscritos/page.tsx" "app/admin/eventos/[id]/inscritos/page.tsx"
git commit -m "feat(inscritos): modal edita o snapshot da inscrição; botão separado pro cadastro do atleta"
```

---

## Task 9: Consumidores — listas, tabelas e páginas de inscritos

**Files:**
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx`, `app/admin/eventos/[id]/inscritos/page.tsx`
- Modify: `lib/organizer/registrations.ts`, `lib/registrations/pending-queue.ts`
- Modify: `app/api/events/[id]/registrations/route.ts`
- Modify: `components/registrations/PendingCancellationsTable.tsx`, `components/payment/PendingRefundsTable.tsx`
- Test: `tests/organizer-registrations-helpers.test.ts`, `tests/pending-queue.test.ts`, `tests/events-registrations-route.test.ts` (os que existirem)

- [ ] **Step 1: Teste** — nos testes desses helpers, asserir que o objeto retornado usa `participant*`:

```ts
// exemplo p/ lib/organizer/registrations.ts
it("a linha da inscrição usa participantName/Email/Cpf, não athlete.*", async () => {
  // mock registration com participantName "Snapshot", athlete.name "Conta"
  // → resultado.name === "Snapshot"
});
```

- [ ] **Step 2: Rodar — falha nos casos novos**

- [ ] **Step 3: Implementar** — em cada arquivo:
  - trocar `athlete: { select: { name: true, email: true, athleteProfile: { select: { cpf, phone, birthDate, gender } } } }` por `participantName: true, participantEmail: true, participantCpf: true, participantPhone: true, participantBirthDate: true, participantGender: true` no `select` da `Registration`.
  - trocar `r.athlete.name` → `r.participantName`, `r.athlete.email` → `r.participantEmail`, `r.athlete.athleteProfile?.cpf` → `r.participantCpf`, etc.
  - manter `athlete: { select: { id: true } }` (ou `athleteUserId`) onde for preciso pra linkar ao perfil/dashboard.

- [ ] **Step 4: Rodar testes** (`npx vitest run` nos arquivos tocados)

- [ ] **Step 5: Commit**

```bash
git add app/organizador/eventos/[id]/inscritos/page.tsx app/admin/eventos/[id]/inscritos/page.tsx lib/organizer/registrations.ts lib/registrations/pending-queue.ts app/api/events/[id]/registrations/route.ts components/registrations/PendingCancellationsTable.tsx components/payment/PendingRefundsTable.tsx tests/
git commit -m "refactor(inscritos): listas e tabelas leem participant*"
```

---

## Task 10: Consumidores — exports e relatório geral

**Files:**
- Modify: `lib/registrations/export.ts`, `lib/reports/general-report.ts`
- Modify: `components/registrations/GeneralReportTable.tsx`
- Modify: `app/organizador/eventos/[id]/relatorio-geral/page.tsx`, `app/admin/eventos/[id]/relatorio-geral/page.tsx`
- Modify: `app/api/events/[id]/kit-deliveries/report-export/route.ts`
- Test: `tests/lib-registrations-export.test.ts`, `tests/lib-general-report.test.ts`

- [ ] **Step 1: Teste** — nos testes de export, o input de `Registration` passa a ter `participant*` e as colunas "Nome"/"E-mail"/"CPF"/"Idade"/"Gênero" saem deles.

```ts
it("export usa participantName e participantCpf", () => {
  const rows = buildExport([{ participantName: "Ana Snapshot", participantCpf: "12345678901",
    participantBirthDate: new Date("1990-01-01"), participantGender: "F", route: null, category: null, ... }], eventDate);
  expect(rows[0]).toContain("Ana Snapshot");
  expect(rows[0]).toContain("12345678901");
});
```

- [ ] **Step 2: Rodar — falha**

- [ ] **Step 3: Implementar** — em `lib/registrations/export.ts`: o tipo de entrada troca `athlete: { name, athleteProfile: {...} }` por `participantName`, `participantBirthDate`, `participantGender`, `participantCpf`. As linhas usam `r.participantName` etc. `calculateAge(r.participantBirthDate, eventDate)`. Idem `general-report.ts` e a rota de export de kit. As pages passam o `select` novo.

- [ ] **Step 4: Rodar testes**

- [ ] **Step 5: Commit**

```bash
git add lib/registrations/export.ts lib/reports/general-report.ts components/registrations/GeneralReportTable.tsx app/organizador/eventos/[id]/relatorio-geral/page.tsx app/admin/eventos/[id]/relatorio-geral/page.tsx app/api/events/[id]/kit-deliveries/report-export/route.ts tests/
git commit -m "refactor(exports): CSV/XLSX e relatório geral leem participant*"
```

---

## Task 11: Consumidores — entrega de kit

**Files:**
- Modify: `lib/kit-delivery.ts`
- Modify: `app/api/registrations/[id]/qrcode/route.ts`
- Modify: `app/organizador/eventos/[id]/entrega-kits/EntregaKitsClient.tsx`
- Test: `tests/lib-kit-delivery.test.ts`, `tests/registrations-qrcode-route.test.ts`

- [ ] **Step 1: Teste** — busca de kit por nome e por CPF passa a filtrar `participantName` / `participantCpf`; o resultado usa `participantName`.

```ts
it("busca de kit por nome filtra participantName; resultado usa participantName", async () => {
  // dbMock.registration.findMany assert: where.OR contém { participantName: { contains: "ana", mode: "insensitive" } }
  // linha retornada: athleteName === r.participantName
});
it("busca por CPF filtra participantCpf", async () => { /* where.OR contém { participantCpf: normalized } */ });
```

- [ ] **Step 2: Rodar — falha**

- [ ] **Step 3: Implementar** — em `lib/kit-delivery.ts`:
  - `cpfClause` → `[{ participantCpf: normalizedCpf }]` (era `{ athlete: { athleteProfile: { cpf } } }`).
  - a cláusula de nome → `{ participantName: { contains: trimmed, mode: "insensitive" } }`.
  - `orderBy: { participantName: "asc" }`.
  - `select`: `participantName`, `participantEmail`, `participantPhone` (era `athlete: { select: {...} }`).
  - `athleteName: r.participantName` (era `r.proxyAthleteDisplayName ?? r.athlete.name` — o snapshot JÁ é o nome do proxy quando for proxy, ver Task 3).
  - `email: r.participantEmail`, `phone: r.participantPhone`.
  - `app/api/registrations/[id]/qrcode/route.ts` e `EntregaKitsClient` — nome exibido no QR/crachá = `participantName`.

- [ ] **Step 4: Rodar testes**

- [ ] **Step 5: Commit**

```bash
git add lib/kit-delivery.ts app/api/registrations/[id]/qrcode/route.ts app/organizador/eventos/[id]/entrega-kits/EntregaKitsClient.tsx tests/
git commit -m "refactor(kit): busca e crachá usam participantName/participantCpf"
```

---

## Task 12: Consumidores — painel do atleta + resultados públicos

**Files:**
- Modify: `app/dashboard/inscricoes/page.tsx`, `app/dashboard/inscricoes/[id]/page.tsx`
- Modify: `app/(public)/eventos/[slug]/resultados/page.tsx`
- Test: os que existirem para essas páginas; senão `npm run build`

- [ ] **Step 1** — `dashboard/inscricoes/[id]/page.tsx`: o `select` da `Registration` troca `athlete: { select: { name } }` por `participantName` (+ `participantPhone`, `participantBirthDate`, `participantGender`, `shirtSize`, `teamName`, `emergencyContactName`, `emergencyContactPhone` — o Step 2 precisa), e a linha "Inscrição feita por você para {X}" usa `registration.participantName`. Também selecionar `event: { select: { registrationEditDeadline: true } }`. A lista (`dashboard/inscricoes/page.tsx`) usa `participantName`.
- [ ] **Step 2** — botão de auto-edição do atleta. Novo `components/dashboard/EditMyRegistrationButton.tsx` (client): recebe a inscrição + `deadline`. Renderiza só se `deadline && new Date(deadline) > new Date()` **e** `registration.athleteUserId === session.user.id`. Abre um modal com os campos `nome / telefone / nascimento / gênero / tamanho de camiseta / equipe / contato de emergência (nome, telefone)` — inicializados dos `participant*`/`shirtSize`/etc. da inscrição. Submit → `PATCH /api/athlete/registrations/${id}` (Task 6). Erro 403 (prazo) → `ErrorModal`. Sem dialog nativo (CLAUDE.md — usa `ConfirmModal`/`ErrorModal`). Inserir o botão no `dashboard/inscricoes/[id]/page.tsx`.
- [ ] **Step 3** — `resultados/page.tsx`: onde exibe o nome do atleta na linha de resultado, usar `participantName` da inscrição casada (o resultado é casado por `bibNumber`/CPF; a exibição usa o snapshot).
- [ ] **Step 4: Build** (`npm run build`)
- [ ] **Step 5: Commit**

```bash
git add app/dashboard/inscricoes/page.tsx app/dashboard/inscricoes/[id]/page.tsx components/dashboard/EditMyRegistrationButton.tsx app/(public)/eventos/[slug]/resultados/page.tsx
git commit -m "feat(atleta): auto-edição da inscrição no painel + resultado público usa participantName"
```

---

## Task 13: Consumidores — notificações, alertas e variáveis de template

**Files:**
- Modify: `lib/notifications.ts`
- Modify: `lib/alerts/payment-error.ts`, `lib/alerts/abandoned-cart.ts`, `lib/alerts/cancellation-requested.ts`, `lib/alerts/registration-cancelled-by-staff.ts`
- Modify: `lib/templates/variables.ts` (as `description` das variáveis do atleta)
- Test: `tests/notifications.test.ts`, `tests/alert-*.test.ts`

- [ ] **Step 1: Teste**

```ts
// tests/notifications.test.ts
it("notifyOrderConfirmed: conteúdo usa participantName; e-mail vai pro comprador", async () => {
  // order com 1 registration participantName "Snap", buyer.email "buyer@x"
  // → sendMail chamado com to: "buyer@x", body contém "Snap"
});
```

- [ ] **Step 2: Rodar — falha**

- [ ] **Step 3: Implementar**:
  - `lib/notifications.ts` (`notifyOrderConfirmed`): o `include` da `order.registrations` seleciona `participantName`/`participantEmail`; o corpo do e-mail lista `r.participantName`; o `to:` continua `order.buyer.email` (1 e-mail).
  - `lib/alerts/*`: onde o alerta cita o nome/e-mail do participante de uma inscrição → `participant*`.
  - `lib/templates/variables.ts`: nas `description` de `nome_atleta`, `email_atleta`, `telefone_atleta`, `documento_atleta`, `data_nascimento_atleta` — trocar "User.name / AthleteProfile.X" por "Registration.participant*". (`equipe_atleta` continua `AthleteProfile.teamName` — não é snapshot; `Registration.teamName` já é por inscrição, decidir: usar `registration.teamName ?? ""`. Manter simples: `registration.teamName`.)

- [ ] **Step 4: Rodar testes**

- [ ] **Step 5: Commit**

```bash
git add lib/notifications.ts lib/alerts/ lib/templates/variables.ts tests/
git commit -m "refactor(notificações): confirmação e alertas usam participant* da inscrição"
```

---

## Task 14: Consumidores — campanhas de WhatsApp + backup

**Files:**
- Modify: `lib/campaigns/resolve-recipient-variables.ts`, `lib/campaigns/recipients.ts`, `app/api/cron/send-campaign-messages/route.ts`
- Modify: `app/api/admin/backup/import/route.ts` (`toRegistrationRow`, `toEventRow`)
- Test: `tests/campaigns-resolve-recipient-variables.test.ts`, `tests/campaigns-recipients.test.ts`, `tests/cron-send-campaign-messages-route.test.ts`, `tests/backup-import-route.test.ts`

- [ ] **Step 1: Teste**

```ts
// tests/campaigns-resolve-recipient-variables.test.ts
it("nome_atleta / telefone_atleta vêm do participant* da inscrição do recipient", async () => {
  // recipient tem registrationId; registration.participantName "Snap", participantPhone "119..."
  // → values.nome_atleta === "Snap", values.telefone_atleta contém "119..."
});
// tests/cron-send-campaign-messages-route.test.ts
it("recipient com participantPhone null é pulado (não usa telefone da conta)", async () => { ... });
// tests/backup-import-route.test.ts
it("import restaura participant* e registrationEditDeadline", async () => { ... });
```

- [ ] **Step 2: Rodar — falha**

- [ ] **Step 3: Implementar**:
  - `resolve-recipient-variables.ts`: hoje resolve os vars do atleta de `db.user.findUnique({ where: { id: recipient.athleteUserId } })`. Passar a resolver de `db.registration.findUnique({ where: { id: recipient.registrationId }, select: { participantName, participantEmail, participantPhone, participantCpf, participantBirthDate, teamName } })`. Se o recipient não tiver `registrationId` (checar o modelo `CampaignRecipient`), manter o fallback pro user — mas anotar. `nome_atleta = registration.participantName`, `telefone_atleta = registration.participantPhone ?? ""`, `documento_atleta = registration.participantCpf ?? ""`, `data_nascimento_atleta` do `participantBirthDate`.
  - `send-campaign-messages/route.ts` + `recipients.ts`: o telefone do destinatário = `registration.participantPhone`. **`null` → pula o recipient** (marca como skipped, não envia). Opt-out continua por número.
  - `backup/import/route.ts`: `toRegistrationRow` ganha `participantName: s(row.participantName)`, `participantEmail: s(row.participantEmail)`, `participantPhone: sn(row.participantPhone)`, `participantBirthDate: dn(row.participantBirthDate)`, `participantGender: sn(row.participantGender)`, `participantCpf: sn(row.participantCpf)`. `toEventRow` ganha `registrationEditDeadline: dn(row.registrationEditDeadline)`.

- [ ] **Step 4: Rodar testes**

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/ app/api/cron/send-campaign-messages/route.ts app/api/admin/backup/import/route.ts tests/
git commit -m "refactor(campanhas/backup): personalização e restauração usam participant*"
```

---

## Task 15: Verificação final + rota /athlete + PROGRESSO

**Files:**
- Modify: `app/api/organizer/registrations/[id]/athlete/route.ts` (comentário/rename conceitual — §3.4 opção (a))
- Modify: `PROGRESSO.md`, `docs/superpowers/specs/2026-08-30-snapshot-dados-inscricao-design.md` (marcar §6)

- [ ] **Step 1: Suíte completa**

Run: `npx vitest run`
Expected: tudo verde. Corrigir mocks de testes não tocados que passaram a receber `participant*` no `select` (ex.: `tests/setup.ts` — se um default de `registration.findMany` precisar dos campos; `toHaveBeenCalledWith` estrito em `registration.create`).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: limpo.

- [ ] **Step 3: A rota `/athlete`** — adicionar um comentário de topo em `app/api/organizer/registrations/[id]/athlete/route.ts` deixando claro que ela **edita o cadastro do atleta** (`User` + `AthleteProfile`), NÃO os dados da inscrição — pra isso é `PATCH /api/organizer/registrations/[id]` (Task 4). Nenhuma mudança de comportamento nela.

- [ ] **Step 4: Revisão adversarial (grep) — registrar cada check no report**

- `grep -rn "\.athlete\.name\|\.athlete\.email\|athlete\?\.name\|athlete\?\.email" lib/ app/ components/` — só onde é legítimo: `resolveActingScope`/dedup, edição do cadastro do atleta (`/athlete`, `UserForm`, `app/api/athlete/profile`), topo do painel do atleta (`session.user.name`), e-mails de conta. **Nenhum** em contexto de exibir/exportar dados de uma inscrição.
- `grep -rn "athlete: { select" lib/ app/` — os que sobraram só selecionam `id` (pra linkar).
- `grep -rn "participantName\|participantEmail\|participantCpf" lib/ app/ components/` — presente em todos os consumidores das Tasks 9–14.
- Confirmar: nenhuma das rotas `PATCH .../registrations/[id]` chama `db.user.update` ou `db.athleteProfile.update`.
- Confirmar: `lib/checkout.ts` grava os 6 `participant*` em TODO caminho (normal e proxy).
- `backfillRegistrationParticipants` idempotente (rodar 2x num banco de teste).

- [ ] **Step 5: PROGRESSO.md** — nova entrada no topo: sub-projeto C concluído, arquivos principais, `vitest`/`tsc`/`build`. **PRÓXIMA TAREFA:** deploy — `git pull` → `docker build` → `prisma db push` do schema → **`docker compose run --rm --no-deps app sh -c "npx tsx prisma/backfill-registration-participants.ts"`** → restart. A migração de schema é aditiva (colunas nullable / com default), então o backfill pode rodar antes ou depois do restart sem quebrar — mas **antes** é o ideal (evita janela com `participantName = ""`). Depois: os 3 sub-projetos (A Twilio, B contas MP, C snapshot) saem juntos no primeiro deploy.

- [ ] **Step 6: Commit**

```bash
git add app/api/organizer/registrations/[id]/athlete/route.ts PROGRESSO.md docs/superpowers/specs/2026-08-30-snapshot-dados-inscricao-design.md
git commit -m "docs: conclui sub-projeto C (snapshot de dados da inscrição) — verificação + PROGRESSO"
```

---

## Self-Review

**1. Spec coverage:**

| Spec (seção) | Task |
|---|---|
| §1.1 `Registration.participant*` (6) | Task 1 |
| §1.2 `Event.registrationEditDeadline` | Task 1 + Task 7 (edição) |
| §1.3 backfill paginado idempotente | Task 2 |
| §2.1 snapshot no checkout (normal + proxy) | Task 3 |
| §2.2 sem mudança no `checkout/route.ts` | Task 3 (só `lib/checkout.ts`) |
| §3.1 `PATCH /api/organizer/registrations/[id]` + RBAC + auditoria | Task 4 |
| §3.2 `PATCH /api/admin/registrations/[id]` + actionKey | Task 5 |
| §3.3 `PATCH /api/athlete/registrations/[id]` + deadline + campos restritos | Task 6 |
| §3.4 rota `/athlete` vira "editar cadastro do atleta" (opção a) | Task 8 (2º botão) + Task 15 (comentário) |
| §3.5 UI: modal, painel do atleta, campo no form de evento | Task 7 (form) + Task 8 (modal) + Task 12 (painel do atleta — leitura; botão de auto-edição do atleta: **ver nota abaixo**) |
| §4.1 listas/tabelas | Task 9 |
| §4.2 exports | Task 10 |
| §4.3 kit | Task 11 |
| §4.4 painel do atleta | Task 12 |
| §4.5 resultados públicos | Task 12 |
| §4.6 notificações/alertas | Task 13 |
| §4.7 campanhas | Task 14 |
| §4.8 backup | Task 14 |
| §4.9 fica na conta (não muda) | Task 15 (grep confirma) |
| §5 casos de borda | Tasks 2, 3, 4, 6 (testes) |
| §6 testes | cada task + Task 15 (suíte) |
| §7 fora de escopo | não implementado |

**Gap que estava aqui (botão de auto-edição do atleta no painel) — corrigido:** a Task 12 agora tem o Step 2 (`EditMyRegistrationButton.tsx` → `PATCH /api/athlete/registrations/[id]`).

**2. Placeholder scan:** As Tasks 9–14 descrevem o padrão ("trocar `r.athlete.name` → `r.participantName`") em vez de reproduzir cada arquivo — é mecânico e idêntico entre arquivos, com o contrato explícito (os 6 campos, os nomes de coluna). Os testes têm o shape de asserção concreto. Task 7 e 8 são UI: componentes nomeados, props nomeadas, padrão de referência citado (`cancellationDeadline` no form; o `AthleteDetailsModal` já existente).

**3. Type consistency:**
- `ParticipantIdentity` / `resolveParticipantIdentity` / `participantSnapshotData` / `pickParticipantChanges` — Task 3, consumidos Tasks 4, 5, 6.
- Colunas `participantName/Email/Phone/BirthDate/Gender/Cpf` — Task 1, idênticas em todas as tasks.
- `Event.registrationEditDeadline` — Task 1, lida Task 6, escrita Task 7.
- actionKey `registrations.edit-athlete-any` — Task 5.
- `AuditLog action "REGISTRATION_PARTICIPANT_UPDATED"` — Tasks 4, 5, 6, idêntico.
- rota organizador `PATCH /api/organizer/registrations/[id]` (sem `/athlete`) — Task 4; `editEndpoint` na Task 8 aponta pra ela.

Sem inconsistências além do gap do painel do atleta, corrigido acima (dobrado na Task 12).
