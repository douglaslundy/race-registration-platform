# Templates 100% editáveis + alertas por evento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `DAILY_SUMMARY` and `RECONCILIATION_MISMATCH` 100% editable (no more code-generated
table fragments), split the admin daily-summary fee metric into platform vs. service fee, add a
per-event daily-summary contact feature, and let admins personalize any alert's text for a
specific event from `/admin/alertas`.

**Architecture:** Extends the existing template-engine infra from Etapa 2
(`lib/templates/{registry,resolve,render,seed,variables}.ts`, `MessageTemplate`/
`MessageTemplateVersion`). `DAILY_SUMMARY` becomes fully variable-driven (fixed metric set, no new
mechanism). `RECONCILIATION_MISMATCH` gains a `rowTemplate`/`rowVariables` pair on
`AlertTemplateDefinition` — the first "repeat this per list item" mechanism in the system — applied
by the code loop, editable by the admin. `DailySummaryRecipient` gains an optional `eventId` to
scope a contact to one event. `MessageTemplate.scope="EVENT"` (already supported since Etapa 2) gets
its first UI, admin-only, from `/admin/alertas`.

**Tech Stack:** Next.js 16 App Router, Prisma 5 + PostgreSQL, Vitest, TypeScript, NextAuth v5. No
new dependencies.

## Global Constraints

- Never use native `alert()`/`confirm()`/`window.prompt()` — use `ConfirmModal`/`ErrorModal`
  (`components/ui/`), per `CLAUDE.md`.
- `validateTemplateVariables` runs **separately** for `body` (against `def.variables`) and
  `rowTemplate` (against `def.rowVariables`) — never merge the two lists into one check.
- Every new `AlertKey`/variable name is snake_case, added to `lib/templates/variables.ts`
  (`ALL_VARIABLES`) with a non-empty `sample` — `tests/templates-variables.test.ts` enforces both
  generically.
- `tests/templates-registry.test.ts` enforces generically that every `factoryDefault(channel, role)`
  only references variables declared in that alert's `variables` list — any new/changed registry
  entry must keep this green without editing that generic test.
- Schema changes are additive only (new nullable columns / optional relations) — no
  `--accept-data-loss` needed. This project deploys schema changes via
  `npx prisma db push --skip-generate` in production, but still hand-authors a `migration.sql` per
  change for history (local dev DB is unreachable — never attempt `prisma migrate dev`; use
  `npx prisma validate` and `npx prisma generate` to verify the schema locally, both DB-less).
- Admin-only routes use `checkAdminOnlyApiPermission("message-templates.manage")` (API) /
  `requireAdmin()` (pages) — never loosen this for the per-event template-text personalization
  feature (Part 4), per the closed decision in the spec.
- Organizer-or-admin routes/pages (Part 3's per-event daily-summary contact) use
  `requireOrganizer()` + `resolveActingScope(session)` + an event-ownership `db.event.findFirst`
  filter, exactly like `app/organizador/eventos/[id]/editar/page.tsx` already does.
- No component-level (React Testing Library) tests exist anywhere in this codebase — UI components
  are covered by their API-route tests plus manual browser verification, not RTL. Don't introduce a
  new testing pattern here.
- Full reference spec: `docs/superpowers/specs/2026-08-04-templates-editaveis-e-alerta-por-evento.md`.

---

## Part 1 — `DAILY_SUMMARY` 100% editable + fee split

### Task 1: Split the admin fee metric into `platformFeeAmount` + `serviceFeeAmount`

**Files:**
- Modify: `lib/alerts/daily-summary-metrics.ts`
- Test: `tests/alert-daily-summary-metrics.test.ts`

**Interfaces:**
- Produces: `AdminDailySummary.platformFeeAmount: number`, `AdminDailySummary.serviceFeeAmount: number`
  (replaces the old `platformFeesRetained: number`) — consumed by Task 3.

- [ ] **Step 1: Update the failing assertions first**

In `tests/alert-daily-summary-metrics.test.ts`, replace the two assertions that reference
`platformFeesRetained`:

```ts
  it("retorna a taxa de plataforma e a taxa de pagamento separadamente (não somadas)", async () => {
    dbMock.order.aggregate.mockResolvedValueOnce({ _sum: { platformFeeAmount: 1000, paymentFeeAmount: 250 } });

    const result = await getAdminDailySummary(dayStart, dayEnd);

    expect(dbMock.order.aggregate).toHaveBeenCalledWith({
      _sum: { platformFeeAmount: true, paymentFeeAmount: true },
      where: { status: "PAID", createdAt: { gte: dayStart, lt: dayEnd } },
    });
    expect(result.platformFeeAmount).toBe(1000);
    expect(result.serviceFeeAmount).toBe(250);
  });
```

(replaces `"soma taxa de plataforma e taxa de pagamento das ordens pagas no período"`), and in
`"usa 0 como padrão quando as agregações retornam null (dia sem atividade)"`, replace
`expect(result.platformFeesRetained).toBe(0);` with:

```ts
    expect(result.platformFeeAmount).toBe(0);
    expect(result.serviceFeeAmount).toBe(0);
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx vitest run tests/alert-daily-summary-metrics.test.ts`
Expected: FAIL — `result.platformFeeAmount` is `undefined` (property doesn't exist yet).

- [ ] **Step 3: Update the interface and implementation**

In `lib/alerts/daily-summary-metrics.ts`, change:

```ts
export interface AdminDailySummary {
  newUsersCount: number;
  newOrganizersCount: number;
  eventsCreatedCount: number;
  paidRegistrationsCount: number;
  grossRevenue: number;
  platformFeeAmount: number;
  serviceFeeAmount: number;
  payoutsGeneratedCount: number;
  payoutsGeneratedAmount: number;
  cancelledOrRefundedCount: number;
}
```

and in `getAdminDailySummary`'s return, replace:

```ts
    platformFeesRetained: (feeAgg._sum.platformFeeAmount ?? 0) + (feeAgg._sum.paymentFeeAmount ?? 0),
```

with:

```ts
    platformFeeAmount: feeAgg._sum.platformFeeAmount ?? 0,
    serviceFeeAmount: feeAgg._sum.paymentFeeAmount ?? 0,
```

- [ ] **Step 4: Run the full suite, confirm green**

Run: `npx vitest run`
Expected: PASS. (Task 3 later updates the other files that currently reference
`platformFeesRetained` — `lib/alerts/daily-summary.ts` and `tests/alert-daily-summary.test.ts` — so
those two files will show type/reference errors until Task 3 lands; that's expected mid-plan state,
not a regression in this task's own files.)

- [ ] **Step 5: Commit**

```bash
git add lib/alerts/daily-summary-metrics.ts tests/alert-daily-summary-metrics.test.ts
git commit -m "feat: separa taxa de plataforma e taxa de servico no resumo diario do admin"
```

---

### Task 2: New variable catalog entries + rewrite the `DAILY_SUMMARY` registry entry

**Files:**
- Modify: `lib/templates/variables.ts`, `lib/templates/registry.ts`
- Test: `tests/templates-registry.test.ts`

**Interfaces:**
- Produces: `DAILY_SUMMARY.variables` grows to include `novos_organizadores`, `taxa_plataforma`,
  `taxa_servico`, `repasses_gerados`, `valor_repasses`, `cancelamentos_estornos`,
  `cancelamentos_solicitados`, `lotes_esgotados` — consumed by Task 3's `buildAdminMetricsValues`/
  `buildOrganizerMetricsValues`.
- Consumes: none beyond the existing registry/variables shape.

- [ ] **Step 1: Write the failing test first**

Append to `tests/templates-registry.test.ts`, inside `describe("ALERT_REGISTRY", ...)`:

```ts
  it("DAILY_SUMMARY: o corpo de e-mail de fábrica não tem mais tabela hardcoded — toda métrica vem de variável", () => {
    const adminEmail = ALERT_REGISTRY.DAILY_SUMMARY.factoryDefault("EMAIL", "ADMIN");
    for (const v of [
      "novos_usuarios", "novos_organizadores", "eventos_criados", "total_inscricoes_pagas",
      "receita_periodo", "taxa_plataforma", "taxa_servico", "repasses_gerados", "valor_repasses",
      "cancelamentos_estornos",
    ]) {
      expect(adminEmail.body).toContain(`{{${v}}}`);
    }

    const organizerEmail = ALERT_REGISTRY.DAILY_SUMMARY.factoryDefault("EMAIL", "ORGANIZER");
    for (const v of ["total_inscricoes_pagas", "receita_periodo", "cupons_usados", "cancelamentos_solicitados", "lotes_esgotados"]) {
      expect(organizerEmail.body).toContain(`{{${v}}}`);
    }
  });
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run tests/templates-registry.test.ts -t "DAILY_SUMMARY: o corpo de e-mail"`
Expected: FAIL — current admin/organizer EMAIL bodies don't contain most of these variables.

- [ ] **Step 3: Add the 8 new variable definitions**

In `lib/templates/variables.ts`, append inside `ALL_VARIABLES` (after the existing `cupons_usados`
entry, still in the "Específicas de alerta" block):

```ts
  { name: "novos_organizadores", label: "Novos organizadores", category: "Plataforma", description: "Contagem de novos organizadores cadastrados no dia. Só disponível no resumo diário do administrador.", sample: "1" },
  { name: "taxa_plataforma", label: "Taxa da plataforma", category: "Plataforma", description: "Soma de Order.platformFeeAmount no período, formatada em R$. Só disponível no resumo diário do administrador.", sample: "R$ 150,00" },
  { name: "taxa_servico", label: "Taxa de serviço", category: "Plataforma", description: "Soma de Order.paymentFeeAmount no período, formatada em R$. Só disponível no resumo diário do administrador.", sample: "R$ 45,00" },
  { name: "repasses_gerados", label: "Repasses gerados", category: "Plataforma", description: "Quantidade de repasses (TransferPayout) gerados no período. Só disponível no resumo diário do administrador.", sample: "3" },
  { name: "valor_repasses", label: "Valor dos repasses", category: "Plataforma", description: "Valor total dos repasses gerados no período, formatado em R$. Só disponível no resumo diário do administrador.", sample: "R$ 900,00" },
  { name: "cancelamentos_estornos", label: "Cancelamentos/estornos", category: "Plataforma", description: "Cancelamentos solicitados + pagamentos estornados/chargeback no período. Só disponível no resumo diário do administrador.", sample: "2" },
  { name: "cancelamentos_solicitados", label: "Cancelamentos solicitados", category: "Plataforma", description: "Cancelamentos solicitados no período. Disponível no resumo diário do organizador e no resumo diário por evento.", sample: "1" },
  { name: "lotes_esgotados", label: "Lotes esgotados", category: "Plataforma", description: "Lotes que esgotaram no período. Só disponível no resumo diário do organizador.", sample: "1" },
```

- [ ] **Step 4: Rewrite `DAILY_SUMMARY.variables` and `factoryDefault` in `lib/templates/registry.ts`**

Replace the whole `DAILY_SUMMARY` entry with:

```ts
  DAILY_SUMMARY: {
    alertKey: "DAILY_SUMMARY",
    description: "Resumo diário — 100% editável (e-mail e WhatsApp, admin e organizador), incluindo a tabela de métricas.",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["ADMIN", "ORGANIZER"],
    variables: [
      "data_resumo", "papel_destinatario", "total_inscricoes_pagas", "receita_periodo",
      "novos_usuarios", "eventos_criados", "cupons_usados", "link_plataforma",
      "novos_organizadores", "taxa_plataforma", "taxa_servico",
      "repasses_gerados", "valor_repasses", "cancelamentos_estornos",
      "cancelamentos_solicitados", "lotes_esgotados",
    ],
    factoryDefault: (channel, recipientRole) => {
      if (channel === "EMAIL") {
        if (recipientRole === "ORGANIZER") {
          return {
            subject: "Resumo diário — {{data_resumo}}",
            body:
              `<p>Olá,</p>\n` +
              `<p>Resumo de <strong>{{data_resumo}}</strong> (visão de {{papel_destinatario}}):</p>\n` +
              `<table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">\n` +
              `  <tbody>\n` +
              `    <tr><td>Inscrições pagas</td><td><strong>{{total_inscricoes_pagas}}</strong></td></tr>\n` +
              `    <tr><td>Receita</td><td><strong>{{receita_periodo}}</strong></td></tr>\n` +
              `    <tr><td>Cupons usados</td><td><strong>{{cupons_usados}}</strong></td></tr>\n` +
              `    <tr><td>Cancelamentos solicitados</td><td><strong>{{cancelamentos_solicitados}}</strong></td></tr>\n` +
              `    <tr><td>Lotes esgotados</td><td><strong>{{lotes_esgotados}}</strong></td></tr>\n` +
              `  </tbody>\n` +
              `</table>`,
          };
        }
        return {
          subject: "Resumo diário — {{data_resumo}}",
          body:
            `<p>Olá,</p>\n` +
            `<p>Resumo de <strong>{{data_resumo}}</strong> (visão de {{papel_destinatario}}):</p>\n` +
            `<table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">\n` +
            `  <tbody>\n` +
            `    <tr><td>Novos usuários</td><td><strong>{{novos_usuarios}}</strong></td></tr>\n` +
            `    <tr><td>Novos organizadores</td><td><strong>{{novos_organizadores}}</strong></td></tr>\n` +
            `    <tr><td>Eventos criados</td><td><strong>{{eventos_criados}}</strong></td></tr>\n` +
            `    <tr><td>Inscrições pagas</td><td><strong>{{total_inscricoes_pagas}}</strong></td></tr>\n` +
            `    <tr><td>Receita bruta</td><td><strong>{{receita_periodo}}</strong></td></tr>\n` +
            `    <tr><td>Taxa da plataforma</td><td><strong>{{taxa_plataforma}}</strong></td></tr>\n` +
            `    <tr><td>Taxa de serviço</td><td><strong>{{taxa_servico}}</strong></td></tr>\n` +
            `    <tr><td>Repasses gerados</td><td><strong>{{repasses_gerados}} ({{valor_repasses}})</strong></td></tr>\n` +
            `    <tr><td>Cancelamentos/estornos</td><td><strong>{{cancelamentos_estornos}}</strong></td></tr>\n` +
            `  </tbody>\n` +
            `</table>`,
        };
      }
      return recipientRole === "ORGANIZER"
        ? { body: `Resumo de ontem: {{total_inscricoes_pagas}} inscrições pagas, {{receita_periodo}} em receita, {{cupons_usados}} cupons usados. Veja mais em {{link_plataforma}}/organizador.` }
        : { body: `Resumo de ontem: {{total_inscricoes_pagas}} inscrições pagas, {{receita_periodo}} em receita bruta, {{novos_usuarios}} novos usuários, {{eventos_criados}} eventos criados. Veja mais em {{link_plataforma}}/admin.` };
    },
  },
```

(WhatsApp bodies are unchanged from before — they were already fully editable; only the two new fee
variables become *available*, not mandatory, per the spec's explicit decision not to force a
WhatsApp text change.)

- [ ] **Step 5: Run the full suite, confirm green**

Run: `npx vitest run`
Expected: PASS, including the generic `templates-registry.test.ts` and `templates-variables.test.ts`
checks (new variables are well-formed, no duplicates, and every registry variable reference is
declared).

- [ ] **Step 6: Commit**

```bash
git add lib/templates/variables.ts lib/templates/registry.ts tests/templates-registry.test.ts
git commit -m "feat: DAILY_SUMMARY ganha variaveis pra taxa de plataforma/servico e demais metricas, tabela de email 100% editavel"
```

---

### Task 3: Stop code-generating the daily-summary table

**Files:**
- Modify: `lib/email.ts` (`sendDailySummaryEmail`), `lib/alerts/daily-summary.ts`
- Test: `tests/lib-email.test.ts`, `tests/alert-daily-summary.test.ts`

**Interfaces:**
- Consumes: `AdminDailySummary.platformFeeAmount`/`serviceFeeAmount` (Task 1),
  `DAILY_SUMMARY.variables` (Task 2).
- Produces: `sendDailySummaryEmail(params: { to: string; role: "ADMIN" | "ORGANIZER"; dateLabel:
  string; metrics?: Record<string, string> })` — **`rows` param removed**. Any other code calling
  this function must stop passing `rows`.

- [ ] **Step 1: Update `tests/lib-email.test.ts`'s `sendDailySummaryEmail` block first (failing)**

Replace the whole `describe("sendDailySummaryEmail", ...)` block (lines 408-476) with:

```ts
describe("sendDailySummaryEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmtpConfig).mockResolvedValue(smtpConfig);
    vi.mocked(isSmtpReady).mockReturnValue(true);
  });

  it("renderiza o corpo inteiro a partir do template — nenhuma tabela é gerada em código", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto customizado — {{data_resumo}}",
      body: "<p>Introdução para {{papel_destinatario}} em {{data_resumo}}.</p><p>Inscrições: {{total_inscricoes_pagas}}, receita: {{receita_periodo}}</p>",
      source: "global",
    });

    await sendDailySummaryEmail({
      to: "admin@example.com",
      role: "ADMIN",
      dateLabel: "03/08/2026",
      metrics: { total_inscricoes_pagas: "10", receita_periodo: "R$ 1.000,00" },
    });

    expect(getEffectiveTemplate).toHaveBeenCalledWith("DAILY_SUMMARY", "EMAIL", "ADMIN");
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@example.com", subject: "Assunto customizado — 03/08/2026" }),
    );
    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Introdução para administrador em 03/08/2026.");
    expect(sentHtml).toContain("Inscrições: 10, receita: R$ 1.000,00");
    // Sem tabela hardcoded — só o que o template devolveu.
    expect(sentHtml).not.toContain("<table");
  });

  it("um template customizado que referencia novas variáveis de taxa renderiza os valores supridos via params.metrics", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Resumo — {{data_resumo}}",
      body: "<p>Taxa da plataforma: {{taxa_plataforma}}. Taxa de serviço: {{taxa_servico}}.</p>",
      source: "global",
    });

    await sendDailySummaryEmail({
      to: "admin@example.com",
      role: "ADMIN",
      dateLabel: "03/08/2026",
      metrics: { taxa_plataforma: "R$ 150,00", taxa_servico: "R$ 45,00" },
    });

    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Taxa da plataforma: R$ 150,00. Taxa de serviço: R$ 45,00.");
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run tests/lib-email.test.ts -t "sendDailySummaryEmail"`
Expected: FAIL — current implementation still requires `rows` and always appends a `<table>`.

- [ ] **Step 3: Rewrite `sendDailySummaryEmail` in `lib/email.ts`**

Replace the function (currently lines 444-474) with:

```ts
/** E-mail com o resumo diário de atividade (admin ou organizador) — 100% gerado a partir do
 * template do banco; nenhuma parte é montada em código. */
export async function sendDailySummaryEmail(params: {
  to: string;
  role: "ADMIN" | "ORGANIZER";
  dateLabel: string;
  /** Métricas cruas (total_inscricoes_pagas, receita_periodo, taxa_plataforma etc.) — mesmo mapa
   * usado pelo texto de WhatsApp deste alerta (ver lib/alerts/daily-summary.ts). */
  metrics?: Record<string, string>;
}): Promise<void> {
  const appName = await getAppName();
  const roleLabel = params.role === "ADMIN" ? "administrador" : "organizador";
  const values = { data_resumo: params.dateLabel, papel_destinatario: roleLabel, ...params.metrics };
  const template = await getEffectiveTemplate("DAILY_SUMMARY", "EMAIL", params.role);
  const subject = renderTemplateSubject(template.subject ?? "", values);
  const body = renderTemplate(template.body, values, "EMAIL");
  await sendMail({ to: params.to, subject, html: layout(appName, body) });
}
```

- [ ] **Step 4: Update `lib/alerts/daily-summary.ts`**

Remove `buildAdminEmailRows` and `buildOrganizerEmailRows` entirely (no longer used). Extend
`buildAdminMetricsValues` and `buildOrganizerMetricsValues`:

```ts
function buildAdminMetricsValues(m: AdminDailySummary, baseUrl: string): Record<string, string> {
  return {
    total_inscricoes_pagas: String(m.paidRegistrationsCount),
    receita_periodo: formatCurrency(m.grossRevenue),
    novos_usuarios: String(m.newUsersCount),
    novos_organizadores: String(m.newOrganizersCount),
    eventos_criados: String(m.eventsCreatedCount),
    taxa_plataforma: formatCurrency(m.platformFeeAmount),
    taxa_servico: formatCurrency(m.serviceFeeAmount),
    repasses_gerados: String(m.payoutsGeneratedCount),
    valor_repasses: formatCurrency(m.payoutsGeneratedAmount),
    cancelamentos_estornos: String(m.cancelledOrRefundedCount),
    link_plataforma: baseUrl,
  };
}

function buildOrganizerMetricsValues(m: OrganizerDailySummary, baseUrl: string): Record<string, string> {
  return {
    total_inscricoes_pagas: String(m.paidRegistrationsCount),
    receita_periodo: formatCurrency(m.grossRevenue),
    cupons_usados: String(m.couponsUsedCount),
    cancelamentos_solicitados: String(m.cancellationsRequestedCount),
    lotes_esgotados: String(m.soldOutBatchesCount),
    link_plataforma: baseUrl,
  };
}
```

Then remove every `rows: build...EmailRows(metrics)` (or `rows: build...EmailRows(metrics)` inline
argument) from the two `sendDailySummaryEmail({...})` call sites inside `sendAdminDailySummaries`
(2 call sites: the admin's own row and the extra-recipient loop) and the two inside
`sendOrganizerDailySummaries` — each call keeps `to`, `role`, `dateLabel`, `metrics`, drops `rows`.

- [ ] **Step 5: Update `tests/alert-daily-summary.test.ts` fixtures**

Replace `platformFeesRetained: 5000` in `adminMetricsFixture` (line 46) with
`platformFeeAmount: 3000, serviceFeeAmount: 2000,`. This is the only reference to
`platformFeesRetained` in this file (verified via `git grep -n platformFeesRetained
tests/alert-daily-summary.test.ts`) — no other assertion needs updating.

- [ ] **Step 6: Run the full suite, confirm green**

Run: `npx vitest run`
Expected: PASS — 0 references to `rows`/`buildAdminEmailRows`/`buildOrganizerEmailRows`/
`platformFeesRetained` remain anywhere (`git grep -n "platformFeesRetained\|buildAdminEmailRows\|buildOrganizerEmailRows"` returns nothing).

- [ ] **Step 7: Commit**

```bash
git add lib/email.ts lib/alerts/daily-summary.ts tests/lib-email.test.ts tests/alert-daily-summary.test.ts
git commit -m "feat: resumo diario por email para de gerar tabela em codigo, 100% vindo do template"
```

---

## Part 2 — `RECONCILIATION_MISMATCH` row-template mechanism

### Task 4: Schema migration — `rowTemplate` column

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260804000000_add_message_template_row_template/migration.sql`

**Interfaces:**
- Produces: `MessageTemplate.rowTemplate: string | null`, `MessageTemplateVersion.rowTemplate: string
  | null` — consumed by Task 5 (`resolve.ts`), Task 8 (API routes), Task 9 (UI).

- [ ] **Step 1: Edit `prisma/schema.prisma`**

In `model MessageTemplate`, add after `body`:

```prisma
  body            String   @db.Text
  rowTemplate     String?  @db.Text
```

In `model MessageTemplateVersion`, add after `body`:

```prisma
  body            String   @db.Text
  rowTemplate     String?  @db.Text
```

- [ ] **Step 2: Validate the schema (no DB needed)**

Run: `npx prisma validate`
Expected: "The schema at prisma\schema.prisma is valid 🚀"

Run: `npx prisma generate`
Expected: Client regenerates cleanly; `MessageTemplate`/`MessageTemplateVersion` TS types now
include `rowTemplate: string | null`.

- [ ] **Step 3: Hand-author the migration**

Create `prisma/migrations/20260804000000_add_message_template_row_template/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "message_templates" ADD COLUMN "rowTemplate" TEXT;

-- AlterTable
ALTER TABLE "message_template_versions" ADD COLUMN "rowTemplate" TEXT;
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS (schema-only change; no test yet asserts on `rowTemplate`, that starts in Task 5).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260804000000_add_message_template_row_template
git commit -m "feat: adiciona coluna rowTemplate em MessageTemplate/MessageTemplateVersion (aditiva)"
```

---

### Task 5: Registry + resolve — `rowTemplate`/`rowVariables` mechanism

**Files:**
- Modify: `lib/templates/registry.ts`, `lib/templates/resolve.ts`, `lib/templates/variables.ts`
- Test: `tests/templates-resolve.test.ts`, `tests/templates-registry.test.ts`

**Interfaces:**
- Produces: `AlertTemplateDefinition.rowTemplate?: (channel: AlertChannel) => string`,
  `AlertTemplateDefinition.rowVariables?: string[]`; `EffectiveTemplate.rowTemplate?: string`
  (resolved with the same event→global→factory precedence as `body`, but **always falls back to the
  factory row template live** when the resolved DB row's `rowTemplate` is null/empty — this is the
  same "uncustomized row shadows new factory content" failure class found and fixed earlier this
  session for `body`/`subject`, prevented here at read-time instead of needing a follow-up refresh
  script).
- Consumes: `MessageTemplate.rowTemplate` (Task 4).

- [ ] **Step 1: Update `tests/templates-resolve.test.ts`'s `select` assertions first (failing)**

There are exactly 2 occurrences of `select: { subject: true, body: true }` in
`toHaveBeenCalledWith` assertions in this file — the event-lookup select in
`"usa o template de evento quando existe e está ativo"` and the global-lookup select in
`"sem eventId, não tenta buscar template de evento"`. Change both to
`select: { subject: true, body: true, rowTemplate: true }`.

Append two new tests:

```ts
  it("quando o alertKey tem rowTemplate no registry e a linha do banco não tem um customizado, usa o de fábrica", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({ subject: "S", body: "B", rowTemplate: null });

    const result = await getEffectiveTemplate("RECONCILIATION_MISMATCH", "EMAIL", "ADMIN");

    const factory = registry.ALERT_REGISTRY.RECONCILIATION_MISMATCH.rowTemplate!("EMAIL");
    expect(result.rowTemplate).toBe(factory);
  });

  it("quando a linha do banco já tem um rowTemplate customizado, usa ele em vez do de fábrica", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({
      subject: "S", body: "B", rowTemplate: "<tr><td>{{evento}}</td></tr>",
    });

    const result = await getEffectiveTemplate("RECONCILIATION_MISMATCH", "EMAIL", "ADMIN");

    expect(result.rowTemplate).toBe("<tr><td>{{evento}}</td></tr>");
  });
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run tests/templates-resolve.test.ts`
Expected: FAIL on the `select` assertions and the 2 new tests (`rowTemplate` doesn't exist on
`EffectiveTemplate` yet).

- [ ] **Step 3: Extend `AlertTemplateDefinition` in `lib/templates/registry.ts`**

```ts
export interface AlertTemplateDefinition {
  alertKey: AlertKey;
  description: string;
  channels: AlertChannel[];
  recipientRoles: RecipientRole[];
  variables: string[];
  factoryDefault: (channel: AlertChannel, recipientRole: string) => { subject?: string; body: string };
  /** Só pra alertas com uma lista de tamanho variável (hoje: RECONCILIATION_MISMATCH) — aplicado
   * pelo código a cada item da lista, editável pelo admin. */
  rowTemplate?: (channel: AlertChannel) => string;
  /** Variáveis válidas dentro do rowTemplate — subconjunto SEPARADO de `variables`, nunca misturado
   * na mesma validação (ver validateTemplateVariables em cada call site). */
  rowVariables?: string[];
}
```

- [ ] **Step 4: Add `rowTemplate`/`rowVariables` to `RECONCILIATION_MISMATCH`**

```ts
  RECONCILIATION_MISMATCH: {
    alertKey: "RECONCILIATION_MISMATCH",
    description: "Divergência de conciliação — avisa todos os admins quando o cron encontra pagamentos pendentes divergentes do gateway. 100% editável, incluindo o texto de cada linha da lista de divergências.",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["ADMIN"],
    variables: ["total_divergencias", "divergencias_corrigidas", "divergencias_manuais"],
    factoryDefault: (channel) =>
      channel === "EMAIL"
        ? {
            subject: "Conciliação de pagamentos — {{total_divergencias}} divergência(s) encontrada(s)",
            body:
              `<p>A rotina de conciliação encontrou divergências entre o status local e o status no gateway de\n` +
              `pagamento ({{divergencias_corrigidas}} corrigida(s) automaticamente, {{divergencias_manuais}} precisa(m) de revisão\n` +
              `manual).</p>\n` +
              `<p>Divergências marcadas como "Requer verificação manual" precisam de revisão em Admin →\n` +
              `Conciliação.</p>`,
          }
        : {
            body: `Conciliação de pagamentos: {{divergencias_corrigidas}} corrigida(s) automaticamente, {{divergencias_manuais}} precisam de revisão manual. Acesse /admin/conciliacao para detalhes.`,
          },
    rowTemplate: (channel) =>
      channel === "EMAIL"
        ? `<tr><td>{{evento}}</td><td>{{pedido}}</td><td>{{status_local}}</td><td>{{status_gateway}}</td><td>{{situacao}}</td></tr>`
        : `{{evento}} — Pedido {{pedido}}: {{situacao}}`,
    rowVariables: ["evento", "pedido", "status_local", "status_gateway", "situacao"],
  },
```

- [ ] **Step 5: Add the 5 `rowVariables` definitions to `lib/templates/variables.ts`**

```ts
  { name: "evento", label: "Evento (linha de divergência)", category: "Conciliação", description: "Event.title da divergência. Só disponível no template de cada linha do alerta de conciliação.", sample: "Corrida Exemplo 5k" },
  { name: "pedido", label: "Pedido (linha de divergência)", category: "Conciliação", description: "Order.id da divergência. Só disponível no template de cada linha do alerta de conciliação.", sample: "ord_exemplo123" },
  { name: "status_local", label: "Status local (linha de divergência)", category: "Conciliação", description: "Status do pagamento no banco local antes da correção. Só disponível no template de cada linha do alerta de conciliação.", sample: "PENDING" },
  { name: "status_gateway", label: "Status no gateway (linha de divergência)", category: "Conciliação", description: "Status do pagamento no gateway. Só disponível no template de cada linha do alerta de conciliação.", sample: "PAID" },
  { name: "situacao", label: "Situação (linha de divergência)", category: "Conciliação", description: "'Corrigido automaticamente' ou 'Requer verificação manual'. Só disponível no template de cada linha do alerta de conciliação.", sample: "Corrigido automaticamente" },
```

- [ ] **Step 6: Extend `lib/templates/resolve.ts`**

```ts
import { db } from "@/lib/db";
import { getAlertDefinition, type AlertChannel } from "./registry";

export interface EffectiveTemplate {
  subject?: string;
  body: string;
  rowTemplate?: string;
  source: "event" | "global" | "factory";
}

function factoryFallback(alertKey: string, channel: AlertChannel, recipientRole: string): EffectiveTemplate {
  const def = getAlertDefinition(alertKey);
  if (!def) return { subject: undefined, body: "", source: "factory" };
  const { subject, body } = def.factoryDefault(channel, recipientRole);
  return { subject, body, rowTemplate: def.rowTemplate?.(channel), source: "factory" };
}

export async function getEffectiveTemplate(
  alertKey: string,
  channel: AlertChannel,
  recipientRole: string,
  eventId?: string,
): Promise<EffectiveTemplate> {
  try {
    if (eventId) {
      const eventRow = await db.messageTemplate.findFirst({
        where: { alertKey, channel, recipientRole, scope: "EVENT", eventId, active: true },
        select: { subject: true, body: true, rowTemplate: true },
      });
      if (eventRow) {
        return {
          subject: eventRow.subject ?? undefined,
          body: eventRow.body,
          rowTemplate: eventRow.rowTemplate ?? getAlertDefinition(alertKey)?.rowTemplate?.(channel),
          source: "event",
        };
      }
    }

    const globalRow = await db.messageTemplate.findFirst({
      where: { alertKey, channel, recipientRole, scope: "GLOBAL", eventId: null, active: true },
      select: { subject: true, body: true, rowTemplate: true },
    });
    if (globalRow) {
      return {
        subject: globalRow.subject ?? undefined,
        body: globalRow.body,
        rowTemplate: globalRow.rowTemplate ?? getAlertDefinition(alertKey)?.rowTemplate?.(channel),
        source: "global",
      };
    }

    return factoryFallback(alertKey, channel, recipientRole);
  } catch (err) {
    console.error(`[getEffectiveTemplate] falha ao resolver ${alertKey}/${channel}/${recipientRole}, usando fábrica:`, err);
    try {
      return factoryFallback(alertKey, channel, recipientRole);
    } catch {
      return { subject: undefined, body: "", source: "factory" };
    }
  }
}
```

- [ ] **Step 7: Run the full suite, confirm green**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/templates/registry.ts lib/templates/resolve.ts lib/templates/variables.ts tests/templates-resolve.test.ts
git commit -m "feat: mecanismo de rowTemplate/rowVariables no registry e resolve, com fallback de fabrica sempre ao vivo"
```

---

### Task 6: `sendReconciliationMismatchEmail` uses `rowTemplate`

**Files:**
- Modify: `lib/email.ts`
- Test: `tests/lib-email.test.ts`

**Interfaces:**
- Consumes: `EffectiveTemplate.rowTemplate` (Task 5).

- [ ] **Step 1: Update the failing test first**

Replace the `describe("sendReconciliationMismatchEmail", ...)` block (lines 169-220) with:

```ts
describe("sendReconciliationMismatchEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmtpConfig).mockResolvedValue(smtpConfig);
    vi.mocked(isSmtpReady).mockReturnValue(true);
  });

  const mismatches = [
    { paymentId: "pay-1", orderId: "ord-1", eventTitle: "Corrida X", localStatus: "PENDING", gatewayStatus: "PAID", corrected: true },
    { paymentId: "pay-2", orderId: "ord-2", eventTitle: "Corrida Y", localStatus: "PENDING", gatewayStatus: "REFUNDED", corrected: false },
  ];

  it("usa o rowTemplate resolvido pra montar cada linha da tabela, não mais hardcoded", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto — {{total_divergencias}}",
      body: "<p>Intro {{divergencias_corrigidas}}/{{divergencias_manuais}}</p><p>Aviso final</p>",
      rowTemplate: "<tr><td>Linha: {{evento}} / {{pedido}} / {{situacao}}</td></tr>",
      source: "global",
    });

    await sendReconciliationMismatchEmail({ to: "admin@example.com", mismatches });

    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Linha: Corrida X / ord-1 / Corrigido automaticamente");
    expect(sentHtml).toContain("Linha: Corrida Y / ord-2 / Requer verificação manual");
  });

  it("preserva a ordem visual original: introdução, tabela de divergências e depois o aviso", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto — {{total_divergencias}}",
      body: "<p>Intro {{divergencias_corrigidas}}/{{divergencias_manuais}}</p><p>Aviso final</p>",
      rowTemplate: "<tr><td>{{evento}}</td></tr>",
      source: "global",
    });

    await sendReconciliationMismatchEmail({ to: "admin@example.com", mismatches });

    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    const introIndex = sentHtml.indexOf("Intro 1/1");
    const tableIndex = sentHtml.indexOf("<table");
    const avisoIndex = sentHtml.indexOf("Aviso final");
    expect(introIndex).toBeGreaterThanOrEqual(0);
    expect(tableIndex).toBeGreaterThan(introIndex);
    expect(avisoIndex).toBeGreaterThan(tableIndex);
  });

  it("sem rowTemplate resolvido (caso extremo), não lança — gera linhas vazias em vez de quebrar o envio", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto", body: "<p>Intro</p>", source: "global",
    });

    await expect(sendReconciliationMismatchEmail({ to: "admin@example.com", mismatches })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run tests/lib-email.test.ts -t "sendReconciliationMismatchEmail"`
Expected: FAIL — current implementation ignores `rowTemplate` and hand-builds `<tr>`.

- [ ] **Step 3: Rewrite `sendReconciliationMismatchEmail` in `lib/email.ts`**

```ts
/** E-mail avisando o admin sobre divergências encontradas na conciliação de pagamentos. */
export async function sendReconciliationMismatchEmail(params: {
  to: string;
  mismatches: { paymentId: string; orderId: string; eventTitle: string; localStatus: string; gatewayStatus: string; corrected: boolean }[];
}): Promise<void> {
  const appName = await getAppName();
  const correctedCount = params.mismatches.filter((m) => m.corrected).length;
  const manualCount = params.mismatches.length - correctedCount;
  const values = {
    total_divergencias: String(params.mismatches.length),
    divergencias_corrigidas: String(correctedCount),
    divergencias_manuais: String(manualCount),
  };
  const template = await getEffectiveTemplate("RECONCILIATION_MISMATCH", "EMAIL", "ADMIN");
  const subject = renderTemplateSubject(template.subject ?? "", values);
  const intro = renderTemplate(template.body, values, "EMAIL");
  const rows = params.mismatches
    .map((m) =>
      renderTemplate(
        template.rowTemplate ?? "",
        {
          evento: m.eventTitle,
          pedido: m.orderId,
          status_local: m.localStatus,
          status_gateway: m.gatewayStatus,
          situacao: m.corrected ? "Corrigido automaticamente" : "Requer verificação manual",
        },
        "EMAIL",
      ),
    )
    .join("");
  const table =
    `<table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">\n` +
    `  <thead><tr><th>Evento</th><th>Pedido</th><th>Status local</th><th>Status no gateway</th><th>Situação</th></tr></thead>\n` +
    `  <tbody>${rows}</tbody>\n` +
    `</table>`;
  // O corpo editável traz os 2 parágrafos originais (introdução + aviso de revisão manual)
  // concatenados; a tabela precisa ser reinserida entre eles pra preservar a ordem visual original.
  const firstParagraphEnd = intro.indexOf("</p>");
  const introHead = firstParagraphEnd === -1 ? intro : intro.slice(0, firstParagraphEnd + 4);
  const introTail = firstParagraphEnd === -1 ? "" : intro.slice(firstParagraphEnd + 4);
  await sendMail({
    to: params.to,
    subject,
    html: layout(appName, `${introHead}\n${table}\n${introTail}`),
  });
}
```

- [ ] **Step 4: Run the full suite, confirm green**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email.ts tests/lib-email.test.ts
git commit -m "feat: email de conciliacao monta cada linha via rowTemplate em vez de hardcoded"
```

---

### Task 7: WhatsApp de conciliação usa `rowTemplate`

**Files:**
- Modify: `lib/alerts/reconciliation.ts`
- Test: `tests/alert-reconciliation.test.ts`

**Interfaces:**
- Consumes: `EffectiveTemplate.rowTemplate` (Task 5).

- [ ] **Step 1: Update the failing tests first**

In `tests/alert-reconciliation.test.ts`, update the "zero-regressão" test (around line 139) — its
expected text must now include the joined row lines:

```ts
  it("zero-regressão: texto de WhatsApp vem do template de fábrica de RECONCILIATION_MISMATCH, incluindo a linha de cada divergência (sem mock de resolve/render, sem override no banco)", async () => {
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true, minutesThreshold: 15 });
    dbMock.user.findMany.mockResolvedValue([{ email: "admin1@example.com", phone: "5511999999999" }]);

    await notifyReconciliationMismatches(mismatchFixture);

    const correctedCount = mismatchFixture.filter((m) => m.corrected).length;
    const manualCount = mismatchFixture.length - correctedCount;
    const expectedIntro = `Conciliação de pagamentos: ${correctedCount} corrigida(s) automaticamente, ${manualCount} precisam de revisão manual. Acesse /admin/conciliacao para detalhes.`;
    const expectedRow = `Corrida Teste — Pedido order-1: Requer verificação manual`;
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999999999", `${expectedIntro}\n${expectedRow}`);
  });
```

And the "um template customizado que referencia {{total_divergencias}}" test (around line 190) —
its expected text also gains the joined row line (rendered from the *factory* `rowTemplate`, since
this test only mocks `messageTemplate.findFirst` for the body, not `rowTemplate`):

```ts
  it("um template customizado que referencia {{total_divergencias}} (antes não suprido) renderiza a contagem, não em branco, e ainda inclui a linha de cada divergência", async () => {
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true, minutesThreshold: 15 });
    dbMock.user.findMany.mockResolvedValue([{ email: "admin1@example.com", phone: "5511999999999" }]);
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({
      subject: null,
      body: "Encontramos {{total_divergencias}} divergência(s): {{divergencias_corrigidas}} corrigida(s), {{divergencias_manuais}} manual(is).",
    });

    await notifyReconciliationMismatches(mismatchFixture);

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511999999999",
      "Encontramos 1 divergência(s): 0 corrigida(s), 1 manual(is).\nCorrida Teste — Pedido order-1: Requer verificação manual",
    );
  });
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run tests/alert-reconciliation.test.ts`
Expected: FAIL — current WhatsApp text has no per-mismatch row lines.

- [ ] **Step 3: Update the WhatsApp block in `lib/alerts/reconciliation.ts`**

Replace the `try { ... }` block inside the `settings.whatsappEnabled` loop (lines 81-92) with:

```ts
        try {
          const template = await getEffectiveTemplate("RECONCILIATION_MISMATCH", "WHATSAPP", "ADMIN");
          const introText = renderTemplate(
            template.body,
            {
              total_divergencias: String(newMismatches.length),
              divergencias_corrigidas: String(correctedCount),
              divergencias_manuais: String(manualCount),
            },
            "WHATSAPP",
          );
          const rowsText = newMismatches
            .map((m) =>
              renderTemplate(
                template.rowTemplate ?? "",
                {
                  evento: m.eventTitle,
                  pedido: m.orderId,
                  status_local: m.localStatus,
                  status_gateway: m.gatewayStatus,
                  situacao: m.corrected ? "Corrigido automaticamente" : "Requer verificação manual",
                },
                "WHATSAPP",
              ),
            )
            .join("\n");
          const text = rowsText ? `${introText}\n${rowsText}` : introText;
          await sendWhatsAppMessage(admin.phone, text);
        } catch (err) {
```

(the `catch` block and its body stay exactly as-is — only the `try` body changes).

- [ ] **Step 4: Run the full suite, confirm green**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/alerts/reconciliation.ts tests/alert-reconciliation.test.ts
git commit -m "feat: whatsapp de conciliacao inclui uma linha por divergencia via rowTemplate"
```

---

### Task 8: API routes persist/restore `rowTemplate`

**Files:**
- Modify: `app/api/admin/message-templates/[id]/route.ts` (PUT), `app/api/admin/message-templates/[id]/revert/[versionId]/route.ts`
- Test: `tests/api-admin-message-templates.test.ts`, `tests/api-admin-message-templates-actions.test.ts`

**Interfaces:**
- Consumes: `AlertTemplateDefinition.rowVariables` (Task 5), `MessageTemplate.rowTemplate` (Task 4).

- [ ] **Step 1: Update the failing tests first**

In `tests/api-admin-message-templates.test.ts`, append inside `describe("PUT /api/admin/message-templates/[id]", ...)`:

```ts
  it("rejeita variável desconhecida dentro do rowTemplate sem misturar com a lista de variáveis do body", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({
      id: "tpl-1", alertKey: "RECONCILIATION_MISMATCH", channel: "EMAIL", recipientRole: "ADMIN",
      subject: "S", body: "B", rowTemplate: "R", active: true,
    });

    const res = await putTemplate(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ subject: "S", body: "B", rowTemplate: "{{campo_inventado}}", active: true }),
      }) as any,
      { params: Promise.resolve({ id: "tpl-1" }) },
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.unknownVariables).toContain("campo_inventado");
    expect(dbMock.messageTemplate.update).not.toHaveBeenCalled();
  });

  it("salva rowTemplate com sucesso e grava a versão anterior (incluindo o rowTemplate antigo)", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({
      id: "tpl-1", alertKey: "RECONCILIATION_MISMATCH", channel: "EMAIL", recipientRole: "ADMIN",
      subject: "S antigo", body: "B antigo", rowTemplate: "R antigo", active: true,
    });
    dbMock.messageTemplate.update.mockResolvedValueOnce({ id: "tpl-1" });

    const res = await putTemplate(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ subject: "S novo", body: "B novo", rowTemplate: "<tr><td>{{evento}}</td></tr>", active: true }),
      }) as any,
      { params: Promise.resolve({ id: "tpl-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.messageTemplateVersion.create).toHaveBeenCalledWith({
      data: { templateId: "tpl-1", subject: "S antigo", body: "B antigo", rowTemplate: "R antigo", active: true, changedByUserId: "admin-1" },
    });
    expect(dbMock.messageTemplate.update).toHaveBeenCalledWith({
      where: { id: "tpl-1" },
      data: { subject: "S novo", body: "B novo", rowTemplate: "<tr><td>{{evento}}</td></tr>", active: true, updatedByUserId: "admin-1" },
    });
  });
```

Note: the existing "salva com sucesso" test (LOW_STOCK fixture, no `rowTemplate` in its `findUnique`
mock or in the PUT body) must keep passing unchanged — `rowTemplate` stays `undefined` throughout,
which Prisma/zod both treat as "not provided," and the version-create/update calls it currently
asserts don't include a `rowTemplate` key at all. Since Step 3 always includes `rowTemplate:
existing.rowTemplate` / `rowTemplate` in the `data` objects, **update that existing test's two
`toHaveBeenCalledWith` blocks** to add `rowTemplate: undefined` — Vitest's `toEqual`-style matcher
used by `toHaveBeenCalledWith` treats an explicit `undefined` value the same as an absent key, so
this addition is safe and keeps the assertion accurate.

In `tests/api-admin-message-templates-actions.test.ts`, update the `describe("POST
.../revert/[versionId]", ...)` "restaura o conteúdo da versão" test to include `rowTemplate` in both
mocks and both assertions:

```ts
  it("restaura o conteúdo da versão e grava o estado atual como novo histórico, incluindo rowTemplate", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({ id: "tpl-1", subject: "Atual", body: "Corpo atual", rowTemplate: "Linha atual", active: true });
    dbMock.messageTemplateVersion.findMany.mockResolvedValueOnce([
      { id: "ver-1", templateId: "tpl-1", subject: "Antigo", body: "Corpo antigo", rowTemplate: "Linha antiga", active: true },
    ]);
    dbMock.messageTemplate.update.mockResolvedValueOnce({ id: "tpl-1", subject: "Antigo", body: "Corpo antigo", rowTemplate: "Linha antiga" });

    const res = await revert(new Request("http://localhost", { method: "POST" }) as any, { params: Promise.resolve({ id: "tpl-1", versionId: "ver-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.messageTemplateVersion.create).toHaveBeenCalledWith({
      data: { templateId: "tpl-1", subject: "Atual", body: "Corpo atual", rowTemplate: "Linha atual", active: true, changedByUserId: "admin-1" },
    });
    expect(dbMock.messageTemplate.update).toHaveBeenCalledWith({
      where: { id: "tpl-1" },
      data: { subject: "Antigo", body: "Corpo antigo", rowTemplate: "Linha antiga", active: true, updatedByUserId: "admin-1" },
    });
  });
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run tests/api-admin-message-templates.test.ts tests/api-admin-message-templates-actions.test.ts`
Expected: FAIL — routes don't handle `rowTemplate` yet.

- [ ] **Step 3: Update the PUT handler in `app/api/admin/message-templates/[id]/route.ts`**

```ts
const putSchema = z.object({
  subject: z.string().max(998).optional(),
  body: z.string().min(1),
  rowTemplate: z.string().optional(),
  active: z.boolean(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const existing = await db.messageTemplate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

  const parsed = putSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { subject, body, rowTemplate, active } = parsed.data;

  const def = getAlertDefinition(existing.alertKey);
  const { valid, unknown } = validateTemplateVariables(`${subject ?? ""} ${body}`, def?.variables ?? []);
  if (!valid) {
    return NextResponse.json({ error: "Variável desconhecida no template", unknownVariables: unknown }, { status: 400 });
  }
  if (def?.rowVariables) {
    const rowCheck = validateTemplateVariables(rowTemplate ?? "", def.rowVariables);
    if (!rowCheck.valid) {
      return NextResponse.json({ error: "Variável desconhecida no template de cada linha", unknownVariables: rowCheck.unknown }, { status: 400 });
    }
  }

  await db.messageTemplateVersion.create({
    data: {
      templateId: id,
      subject: existing.subject,
      body: existing.body,
      rowTemplate: existing.rowTemplate,
      active: existing.active,
      changedByUserId: session.user.id,
    },
  });

  const template = await db.messageTemplate.update({
    where: { id },
    data: { subject, body, rowTemplate, active, updatedByUserId: session.user.id },
  });

  return NextResponse.json({ template });
}
```

- [ ] **Step 4: Update the revert handler in `app/api/admin/message-templates/[id]/revert/[versionId]/route.ts`**

```ts
  await db.messageTemplateVersion.create({
    data: { templateId: id, subject: template.subject, body: template.body, rowTemplate: template.rowTemplate, active: template.active, changedByUserId: session.user.id },
  });

  const updated = await db.messageTemplate.update({
    where: { id },
    data: { subject: target.subject, body: target.body, rowTemplate: target.rowTemplate, active: target.active, updatedByUserId: session.user.id },
  });
```

- [ ] **Step 5: Run the full suite, confirm green**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/message-templates/[id]/route.ts app/api/admin/message-templates/[id]/revert/[versionId]/route.ts tests/api-admin-message-templates.test.ts tests/api-admin-message-templates-actions.test.ts
git commit -m "feat: PUT e revert de templates persistem e restauram o rowTemplate"
```

---

### Task 9: Admin UI — "Template de cada linha" field

**Files:**
- Modify: `components/admin/MessageTemplateEditor.tsx`, `app/admin/alertas/templates/[id]/page.tsx`

**Interfaces:**
- Consumes: `def.rowVariables` (Task 5), `template.rowTemplate` (Task 4).

No automated test for this task — this codebase has no component-level (React Testing Library)
tests anywhere (only API-route tests and manual browser verification, per Global Constraints).

- [ ] **Step 1: Extend `MessageTemplateEditor.tsx` props and state**

Add `rowVariables?: VariableDef[]` and `initialRowTemplate?: string | null` to the props type, and
add state:

```tsx
  const [rowTemplate, setRowTemplate] = useState(initialRowTemplate ?? "");
```

- [ ] **Step 2: Include `rowTemplate` in the save payload when applicable**

In `handleSave`, change the `body: JSON.stringify({...})` to:

```tsx
      body: JSON.stringify({
        subject: channel === "EMAIL" ? subject : undefined,
        body,
        ...(rowVariables && rowVariables.length > 0 ? { rowTemplate } : {}),
        active,
      }),
```

Also extend the error branch to surface `unknownVariables` from the row-template validation the
same way it already does for the body (`data.unknownVariables` already covers both cases since the
API returns the same shape for either check).

- [ ] **Step 3: Render the field, conditionally, plus its own variable legend**

Right after the "Corpo da mensagem" `<div>` block, add:

```tsx
        {rowVariables && rowVariables.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1">Template de cada linha</label>
            <textarea
              value={rowTemplate}
              onChange={(e) => setRowTemplate(e.target.value)}
              rows={3}
              className="input-field font-mono text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Aplicado a cada item da lista (ex.: cada divergência de conciliação), repetido automaticamente pelo sistema.
            </p>
          </div>
        )}
```

And, in the right-hand "Variáveis disponíveis" card, after the existing `{categories.map(...)}`
block, add a second legend for row variables:

```tsx
        {rowVariables && rowVariables.length > 0 && (
          <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mt-2">Variáveis do template de cada linha</h3>
            <ul className="space-y-1 mt-1">
              {rowVariables.map((v) => (
                <li key={v.name} className="text-sm">
                  <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{`{{${v.name}}}`}</code>{" "}
                  <span className="text-gray-500">{v.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
```

- [ ] **Step 4: Wire it in `app/admin/alertas/templates/[id]/page.tsx`**

```tsx
  const def = getAlertDefinition(template.alertKey);
  const variables = getVariablesByNames(def?.variables ?? []);
  const rowVariables = def?.rowVariables ? getVariablesByNames(def.rowVariables) : undefined;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-bold">{def?.description ?? template.alertKey}</h1>
      <MessageTemplateEditor
        templateId={template.id}
        initialSubject={template.subject}
        initialBody={template.body}
        initialRowTemplate={template.rowTemplate}
        initialActive={template.active}
        channel={template.channel as "EMAIL" | "WHATSAPP"}
        variables={variables}
        rowVariables={rowVariables}
        versions={versions.map((v) => ({
          id: v.id,
          subject: v.subject,
          body: v.body,
          active: v.active,
          createdAt: v.createdAt.toISOString(),
        }))}
      />
    </div>
  );
```

- [ ] **Step 5: Run the full suite, confirm green**

Run: `npx vitest run`
Expected: PASS (this task touches no test files; confirms nothing else broke).

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/admin/MessageTemplateEditor.tsx app/admin/alertas/templates/[id]/page.tsx
git commit -m "feat: editor de templates ganha campo de template de cada linha (rowTemplate)"
```

---

## Part 3 — Alerta diário por evento

### Task 10: Schema migration — `DailySummaryRecipient.eventId`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260804010000_add_daily_summary_recipient_event/migration.sql`

**Interfaces:**
- Produces: `DailySummaryRecipient.eventId: string | null` — consumed by Task 13 (`sendEventDailySummaries`), Task 15 (API routes).

- [ ] **Step 1: Edit `prisma/schema.prisma`**

In `model DailySummaryRecipient`, add `eventId` and the `event` relation:

```prisma
model DailySummaryRecipient {
  id        String                     @id @default(cuid())
  userId    String
  name      String
  type      DailySummaryRecipientType
  value     String
  eventId   String?
  createdAt DateTime                   @default(now())

  user  User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  event Event? @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([eventId])
  @@map("daily_summary_recipients")
}
```

In `model Event`, add the reverse relation next to the existing `messageTemplates` line:

```prisma
  messageTemplates MessageTemplate[]
  dailySummaryRecipients DailySummaryRecipient[]
```

- [ ] **Step 2: Validate the schema (no DB needed)**

Run: `npx prisma validate`
Run: `npx prisma generate`
Expected: both clean; `DailySummaryRecipient` TS type now includes `eventId: string | null`.

- [ ] **Step 3: Hand-author the migration**

Create `prisma/migrations/20260804010000_add_daily_summary_recipient_event/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "daily_summary_recipients" ADD COLUMN "eventId" TEXT;

-- CreateIndex
CREATE INDEX "daily_summary_recipients_eventId_idx" ON "daily_summary_recipients"("eventId");

-- AddForeignKey
ALTER TABLE "daily_summary_recipients" ADD CONSTRAINT "daily_summary_recipients_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS (schema-only change).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260804010000_add_daily_summary_recipient_event
git commit -m "feat: adiciona eventId opcional em DailySummaryRecipient (aditiva)"
```

---

### Task 11: `getEventDailySummary` aggregation

**Files:**
- Modify: `lib/alerts/daily-summary-metrics.ts`
- Test: `tests/alert-daily-summary-metrics.test.ts`

**Interfaces:**
- Produces: `EventDailySummary { paidRegistrationsCount, grossRevenue, couponsUsedCount, cancellationsRequestedCount, vagasRestantes }`, `getEventDailySummary(eventId: string, dayStart: Date, dayEnd: Date): Promise<EventDailySummary>` — consumed by Task 13.

- [ ] **Step 1: Write the failing test first**

Append a new `describe` block to `tests/alert-daily-summary-metrics.test.ts`:

```ts
describe("getEventDailySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.registration.count.mockResolvedValue(0);
    dbMock.order.aggregate.mockResolvedValue({ _sum: { subtotalAmount: null } });
    dbMock.order.count.mockResolvedValue(0);
    dbMock.ticketBatch.findMany.mockResolvedValue([]);
  });

  it("escopa todas as métricas ao eventId informado (não ao organizerId)", async () => {
    dbMock.registration.count.mockResolvedValueOnce(4);
    dbMock.order.aggregate.mockResolvedValueOnce({ _sum: { subtotalAmount: 40000 } });

    const result = await getEventDailySummary("event-1", dayStart, dayEnd);

    expect(dbMock.registration.count).toHaveBeenCalledWith({
      where: { eventId: "event-1", status: "CONFIRMED", createdAt: { gte: dayStart, lt: dayEnd } },
    });
    expect(dbMock.order.aggregate).toHaveBeenCalledWith({
      _sum: { subtotalAmount: true },
      where: { status: "PAID", eventId: "event-1", createdAt: { gte: dayStart, lt: dayEnd } },
    });
    expect(result.paidRegistrationsCount).toBe(4);
    expect(result.grossRevenue).toBe(40000);
  });

  it("calcula vagasRestantes como a soma de (capacidade - vendidas) dos lotes ativos do evento", async () => {
    dbMock.ticketBatch.findMany.mockResolvedValueOnce([
      { capacity: 100, soldCount: 60 },
      { capacity: 50, soldCount: 50 },
    ]);

    const result = await getEventDailySummary("event-1", dayStart, dayEnd);

    expect(dbMock.ticketBatch.findMany).toHaveBeenCalledWith({
      where: { eventId: "event-1", active: true },
      select: { capacity: true, soldCount: true },
    });
    expect(result.vagasRestantes).toBe(40);
  });

  it("nunca deixa vagasRestantes negativa quando um lote vendeu acima da capacidade", async () => {
    dbMock.ticketBatch.findMany.mockResolvedValueOnce([{ capacity: 10, soldCount: 15 }]);

    const result = await getEventDailySummary("event-1", dayStart, dayEnd);

    expect(result.vagasRestantes).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run tests/alert-daily-summary-metrics.test.ts -t "getEventDailySummary"`
Expected: FAIL — `getEventDailySummary` doesn't exist yet.

- [ ] **Step 3: Implement it**

Append to `lib/alerts/daily-summary-metrics.ts`:

```ts
export interface EventDailySummary {
  paidRegistrationsCount: number;
  grossRevenue: number;
  couponsUsedCount: number;
  cancellationsRequestedCount: number;
  vagasRestantes: number;
}

export async function getEventDailySummary(eventId: string, dayStart: Date, dayEnd: Date): Promise<EventDailySummary> {
  const period = { gte: dayStart, lt: dayEnd };

  const [paidRegistrationsCount, revenueAgg, couponsUsedCount, cancellationsRequestedCount, batches] =
    await Promise.all([
      db.registration.count({ where: { eventId, status: "CONFIRMED", createdAt: period } }),
      db.order.aggregate({ _sum: { subtotalAmount: true }, where: { status: "PAID", eventId, createdAt: period } }),
      db.order.count({ where: { eventId, couponId: { not: null }, createdAt: period } }),
      db.registration.count({ where: { eventId, cancellationRequestedAt: period } }),
      db.ticketBatch.findMany({ where: { eventId, active: true }, select: { capacity: true, soldCount: true } }),
    ]);

  const vagasRestantes = batches.reduce((sum, b) => sum + Math.max(0, b.capacity - b.soldCount), 0);

  return {
    paidRegistrationsCount,
    grossRevenue: revenueAgg._sum.subtotalAmount ?? 0,
    couponsUsedCount,
    cancellationsRequestedCount,
    vagasRestantes,
  };
}
```

- [ ] **Step 4: Run the full suite, confirm green**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/alerts/daily-summary-metrics.ts tests/alert-daily-summary-metrics.test.ts
git commit -m "feat: adiciona getEventDailySummary, metricas escopadas a um unico evento"
```

---

### Task 12: `DAILY_SUMMARY_EVENT` alert key

**Files:**
- Modify: `lib/templates/registry.ts`, `lib/templates/variables.ts`
- Test: `tests/templates-registry.test.ts` (generic tests cover this automatically)

**Interfaces:**
- Produces: new `AlertKey` member `"DAILY_SUMMARY_EVENT"`, registry entry — consumed by Task 13.
- Consumes: reuses existing variables `nome_evento`, `cupons_usados`, `cancelamentos_solicitados`,
  `data_resumo` (already added in Task 2) — **do not redeclare these**, `ALL_VARIABLES` uniqueness
  is enforced by `tests/templates-variables.test.ts`.

- [ ] **Step 1: Write the failing test first**

Append to `tests/templates-registry.test.ts`:

```ts
  it("DAILY_SUMMARY_EVENT: existe no registry, com EMAIL e WHATSAPP, e o corpo de fábrica usa nome_evento", () => {
    const def = ALERT_REGISTRY.DAILY_SUMMARY_EVENT;
    expect(def).toBeDefined();
    expect(def.channels).toEqual(["EMAIL", "WHATSAPP"]);
    expect(def.factoryDefault("EMAIL", "ADMIN").body).toContain("{{nome_evento}}");
    expect(def.factoryDefault("WHATSAPP", "ADMIN").body).toContain("{{nome_evento}}");
  });
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run tests/templates-registry.test.ts -t "DAILY_SUMMARY_EVENT"`
Expected: FAIL — `ALERT_REGISTRY.DAILY_SUMMARY_EVENT` is `undefined`.

- [ ] **Step 3: Add the 3 new variable definitions to `lib/templates/variables.ts`**

```ts
  { name: "inscricoes_pagas", label: "Inscrições pagas (evento)", category: "Evento", description: "Inscrições pagas no dia, só deste evento. Só disponível no resumo diário por evento.", sample: "4" },
  { name: "receita_evento", label: "Receita do evento", category: "Evento", description: "Receita bruta do evento no dia, formatada em R$. Só disponível no resumo diário por evento.", sample: "R$ 360,00" },
  { name: "vagas_restantes", label: "Vagas restantes", category: "Evento", description: "Soma de (capacidade - vendidas) dos lotes ativos do evento. Só disponível no resumo diário por evento.", sample: "56" },
```

- [ ] **Step 4: Add `"DAILY_SUMMARY_EVENT"` to the `AlertKey` union and `ALERT_REGISTRY`**

```ts
export type AlertKey =
  | "LOW_STOCK"
  | "ABANDONED_CART"
  | "PAYMENT_ERROR"
  | "PAYMENT_ERROR_ORDER_CANCELLED"
  | "RECONCILIATION_MISMATCH"
  | "CANCELLATION_REQUESTED"
  | "DAILY_SUMMARY"
  | "DAILY_SUMMARY_EVENT"
  | "ADVERTISER_REQUEST_PENDING"
  | "ORDER_CONFIRMED"
  | "ORDER_CONFIRMED_PROXY_BUYER"
  | "ORDER_CONFIRMED_PROXY_ATHLETE";
```

Add the entry (right after `DAILY_SUMMARY`):

```ts
  DAILY_SUMMARY_EVENT: {
    alertKey: "DAILY_SUMMARY_EVENT",
    description: "Resumo diário de um evento específico — enviado só pros contatos cadastrados na tela de edição do evento.",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["ADMIN"],
    variables: ["data_resumo", "nome_evento", "inscricoes_pagas", "receita_evento", "cupons_usados", "cancelamentos_solicitados", "vagas_restantes"],
    factoryDefault: (channel) =>
      channel === "EMAIL"
        ? {
            subject: "Resumo diário — {{nome_evento}} — {{data_resumo}}",
            body:
              `<p>Olá,</p>\n` +
              `<p>Resumo de <strong>{{nome_evento}}</strong> em <strong>{{data_resumo}}</strong>:</p>\n` +
              `<table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">\n` +
              `  <tbody>\n` +
              `    <tr><td>Inscrições pagas</td><td><strong>{{inscricoes_pagas}}</strong></td></tr>\n` +
              `    <tr><td>Receita</td><td><strong>{{receita_evento}}</strong></td></tr>\n` +
              `    <tr><td>Cupons usados</td><td><strong>{{cupons_usados}}</strong></td></tr>\n` +
              `    <tr><td>Cancelamentos solicitados</td><td><strong>{{cancelamentos_solicitados}}</strong></td></tr>\n` +
              `    <tr><td>Vagas restantes</td><td><strong>{{vagas_restantes}}</strong></td></tr>\n` +
              `  </tbody>\n` +
              `</table>`,
          }
        : {
            body: `Resumo de {{nome_evento}} ({{data_resumo}}): {{inscricoes_pagas}} inscrições pagas, {{receita_evento}} em receita, {{cupons_usados}} cupons usados, {{cancelamentos_solicitados}} cancelamentos solicitados, {{vagas_restantes}} vagas restantes.`,
          },
  },
```

Note: `recipientRoles: ["ADMIN"]` is a placeholder role — every real recipient of this alert is an
ad-hoc `DailySummaryRecipient` contact, not a user with an actual `ADMIN` role (same pattern as how
`ADVERTISER_REQUEST_PENDING` uses `"ADMIN"` generically).

- [ ] **Step 5: Run the full suite, confirm green**

Run: `npx vitest run`
Expected: PASS, including `seedMessageTemplatesFromRegistry` (this new alertKey gets auto-seeded —
no manual DB step needed beyond the normal deploy `prisma db push`).

- [ ] **Step 6: Commit**

```bash
git add lib/templates/registry.ts lib/templates/variables.ts tests/templates-registry.test.ts
git commit -m "feat: novo alertKey DAILY_SUMMARY_EVENT no registry"
```

---

### Task 13: `sendEventDailySummaries` + fix aggregate double-send bug

**Files:**
- Modify: `lib/alerts/daily-summary.ts`, `lib/email.ts`
- Test: `tests/alert-daily-summary.test.ts`

**Interfaces:**
- Consumes: `getEventDailySummary` (Task 11), `DAILY_SUMMARY_EVENT` (Task 12), `DailySummaryRecipient.eventId` (Task 10).
- Produces: `sendEventDailySummaries(dayStart: Date, dayEnd: Date): Promise<{ sent: number; failed: number }>`, `sendEventDailySummaryEmail(params: { to: string; values: Record<string,string> }): Promise<void>` (in `lib/email.ts`) — consumed by Task 14 (cron route).

**Important — a real bug this task must also fix:** `sendAdminDailySummaries`/`sendOrganizerDailySummaries`
already query `db.dailySummaryRecipient.findMany({ where: { userId: admin.id } })` for "extra
recipients," filtered only by `userId`. Once Task 10 adds `eventId`, an event-scoped contact (whose
`userId` is set to the event's organizer per the spec) would *also* match that query and incorrectly
receive the aggregate admin/organizer summary in addition to its own event-scoped one. Both queries
must add `eventId: null` to stay scoped to non-event ("aggregate") extra recipients only.

- [ ] **Step 1: Write the failing tests first**

Append to `tests/alert-daily-summary.test.ts` (new imports needed at the top: add
`sendEventDailySummaries` to the `@/lib/alerts/daily-summary` import, add `getEventDailySummary` to
the mocked `@/lib/alerts/daily-summary-metrics` module, and add `sendEventDailySummaryEmail` to the
mocked `@/lib/email` module):

```ts
describe("sendAdminDailySummaries — não inclui destinatários de resumo por evento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
    vi.mocked(getAdminDailySummary).mockResolvedValue(adminMetricsFixture);
  });

  it("filtra destinatários extras por eventId: null — um contato de resumo por evento não recebe o agregado", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "admin-1", email: "admin1@example.com", phone: null, dailySummaryEmailEnabled: false, dailySummaryWhatsappEnabled: false },
    ]);
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([]);

    await sendAdminDailySummaries(dayStart, dayEnd);

    expect(dbMock.dailySummaryRecipient.findMany).toHaveBeenCalledWith({
      where: { userId: "admin-1", eventId: null },
      select: { id: true, name: true, type: true, value: true },
    });
  });
});

describe("sendEventDailySummaries", () => {
  const eventMetricsFixture = {
    paidRegistrationsCount: 4,
    grossRevenue: 40000,
    couponsUsedCount: 1,
    cancellationsRequestedCount: 0,
    vagasRestantes: 20,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
    vi.mocked(getEventDailySummary).mockResolvedValue(eventMetricsFixture);
  });

  it("não faz nada quando não há contatos de resumo por evento cadastrados", async () => {
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([]);

    const result = await sendEventDailySummaries(dayStart, dayEnd);

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sendEventDailySummaryEmail).not.toHaveBeenCalled();
  });

  it("calcula as métricas do evento uma única vez, mesmo com 2 contatos do mesmo evento", async () => {
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([
      { id: "r1", name: "Maria", type: "EMAIL", value: "maria@example.com", eventId: "event-1" },
      { id: "r2", name: "João", type: "WHATSAPP", value: "5511999999999", eventId: "event-1" },
    ]);
    dbMock.event.findMany.mockResolvedValueOnce([{ id: "event-1", title: "Corrida X" }]);

    const result = await sendEventDailySummaries(dayStart, dayEnd);

    expect(getEventDailySummary).toHaveBeenCalledTimes(1);
    expect(sendEventDailySummaryEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "maria@example.com", values: expect.objectContaining({ nome_evento: "Corrida X" }) }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999999999", expect.any(String));
    expect(result).toEqual({ sent: 2, failed: 0 });
  });

  it("não reenvia quando o dia já foi reivindicado (dedupe por contato)", async () => {
    vi.mocked(claimAlert).mockResolvedValue(false);
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([
      { id: "r1", name: "Maria", type: "EMAIL", value: "maria@example.com", eventId: "event-1" },
    ]);
    dbMock.event.findMany.mockResolvedValueOnce([{ id: "event-1", title: "Corrida X" }]);

    const result = await sendEventDailySummaries(dayStart, dayEnd);

    expect(sendEventDailySummaryEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0 });
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run tests/alert-daily-summary.test.ts`
Expected: FAIL — `sendEventDailySummaries`/`getEventDailySummary`/`sendEventDailySummaryEmail` not
wired, and the extra-recipient queries don't filter `eventId: null` yet.

- [ ] **Step 3: Add `sendEventDailySummaryEmail` to `lib/email.ts`**

```ts
/** E-mail com o resumo diário de UM evento específico, enviado aos contatos cadastrados na tela de
 * edição do evento (não confundir com sendDailySummaryEmail, que é o agregado admin/organizador). */
export async function sendEventDailySummaryEmail(params: {
  to: string;
  values: Record<string, string>;
}): Promise<void> {
  const appName = await getAppName();
  const template = await getEffectiveTemplate("DAILY_SUMMARY_EVENT", "EMAIL", "ADMIN");
  const subject = renderTemplateSubject(template.subject ?? "", params.values);
  const body = renderTemplate(template.body, params.values, "EMAIL");
  await sendMail({ to: params.to, subject, html: layout(appName, body) });
}
```

- [ ] **Step 4: Fix the extra-recipient queries in `sendAdminDailySummaries`/`sendOrganizerDailySummaries`**

In both functions, in `lib/alerts/daily-summary.ts`, change:

```ts
      const extraRecipients = await db.dailySummaryRecipient.findMany({
        where: { userId: admin.id },
```

and (organizer version):

```ts
      const extraRecipients = await db.dailySummaryRecipient.findMany({
        where: { userId: organizer.id },
```

to:

```ts
      const extraRecipients = await db.dailySummaryRecipient.findMany({
        where: { userId: admin.id, eventId: null },
```

```ts
      const extraRecipients = await db.dailySummaryRecipient.findMany({
        where: { userId: organizer.id, eventId: null },
```

- [ ] **Step 5: Add `sendEventDailySummaries` to `lib/alerts/daily-summary.ts`**

Add to the imports:

```ts
import { sendEventDailySummaryEmail } from "@/lib/email";
import {
  getAdminDailySummary,
  getOrganizerDailySummary,
  getEventDailySummary,
  type AdminDailySummary,
  type OrganizerDailySummary,
  type EventDailySummary,
} from "./daily-summary-metrics";
```

Add near the top, alongside the existing constants:

```ts
const ALERT_TYPE_EVENT = "DAILY_SUMMARY_EVENT";
const ENTITY_TYPE_EVENT = "DailySummaryEvent";
```

Append the function:

```ts
function buildEventMetricsValues(m: EventDailySummary, eventTitle: string, dateLabel: string): Record<string, string> {
  return {
    data_resumo: dateLabel,
    nome_evento: eventTitle,
    inscricoes_pagas: String(m.paidRegistrationsCount),
    receita_evento: formatCurrency(m.grossRevenue),
    cupons_usados: String(m.couponsUsedCount),
    cancelamentos_solicitados: String(m.cancellationsRequestedCount),
    vagas_restantes: String(m.vagasRestantes),
  };
}

async function buildEventWhatsAppText(values: Record<string, string>): Promise<string> {
  const template = await getEffectiveTemplate("DAILY_SUMMARY_EVENT", "WHATSAPP", "ADMIN");
  return renderTemplate(template.body, values, "WHATSAPP");
}

export async function sendEventDailySummaries(dayStart: Date, dayEnd: Date): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  try {
    const recipients = await db.dailySummaryRecipient.findMany({
      where: { eventId: { not: null } },
      select: { id: true, name: true, type: true, value: true, eventId: true },
    });
    if (recipients.length === 0) return { sent, failed };

    const eventIds = [...new Set(recipients.map((r) => r.eventId as string))];
    const events = await db.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, title: true } });
    const eventTitleMap = new Map(events.map((e) => [e.id, e.title]));

    const cfg = await getSmtpConfig();
    const smtpReady = isSmtpReady(cfg);
    const key = dateKey(dayStart);
    const dateLabel = formatDateLabel(dayStart);

    // Calcula a métrica UMA vez por evento (não uma vez por contato) — vários contatos do mesmo
    // evento reaproveitam o mesmo resultado.
    const metricsCache = new Map<string, EventDailySummary>();
    for (const eventId of eventIds) {
      try {
        metricsCache.set(eventId, await getEventDailySummary(eventId, dayStart, dayEnd));
      } catch (err) {
        console.error("[sendEventDailySummaries] failed to compute metrics for event", eventId, err);
      }
    }

    for (const recipient of recipients) {
      const eventId = recipient.eventId as string;
      const metrics = metricsCache.get(eventId);
      if (!metrics) {
        failed++;
        continue;
      }
      const eventTitle = eventTitleMap.get(eventId) ?? "Evento removido";
      const values = buildEventMetricsValues(metrics, eventTitle, dateLabel);
      const entityId = `${key}:recipient:${recipient.id}`;

      if (recipient.type === "EMAIL" && smtpReady) {
        try {
          if (await claimAlert(ALERT_TYPE_EVENT, ENTITY_TYPE_EVENT, entityId, "EMAIL")) {
            await sendEventDailySummaryEmail({ to: recipient.value, values });
            sent++;
          }
        } catch (err) {
          failed++;
          await unclaimAlert(ALERT_TYPE_EVENT, entityId, "EMAIL");
          console.error("[sendEventDailySummaries] failed for", recipient.name, err);
        }
      }

      if (recipient.type === "WHATSAPP") {
        try {
          if (await claimAlert(ALERT_TYPE_EVENT, ENTITY_TYPE_EVENT, entityId, "WHATSAPP")) {
            await sendWhatsAppMessage(recipient.value, await buildEventWhatsAppText(values));
            sent++;
          }
        } catch (err) {
          failed++;
          await unclaimAlert(ALERT_TYPE_EVENT, entityId, "WHATSAPP");
          console.error("[sendEventDailySummaries] failed for", recipient.name, err);
        }
      }
    }
  } catch (err) {
    console.error("[sendEventDailySummaries] failed:", err);
  }
  return { sent, failed };
}
```

- [ ] **Step 6: Run the full suite, confirm green**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/alerts/daily-summary.ts lib/email.ts tests/alert-daily-summary.test.ts
git commit -m "feat: envia resumo diario por evento e corrige double-send de contatos escopados a evento no agregado"
```

---

### Task 14: Wire `sendEventDailySummaries` into the cron route

**Files:**
- Modify: `app/api/cron/daily-summary/route.ts`
- Test: `tests/cron-daily-summary-route.test.ts`

**Interfaces:**
- Consumes: `sendEventDailySummaries` (Task 13).

- [ ] **Step 1: Update the failing test first**

Replace the `vi.mock("@/lib/alerts/daily-summary", ...)` block and the second `it` in
`tests/cron-daily-summary-route.test.ts`:

```ts
vi.mock("@/lib/alerts/daily-summary", () => ({
  getYesterdayBrasiliaWindow: vi.fn(),
  sendAdminDailySummaries: vi.fn(),
  sendOrganizerDailySummaries: vi.fn(),
  sendEventDailySummaries: vi.fn(),
}));

import { POST } from "@/app/api/cron/daily-summary/route";
import {
  getYesterdayBrasiliaWindow,
  sendAdminDailySummaries,
  sendOrganizerDailySummaries,
  sendEventDailySummaries,
} from "@/lib/alerts/daily-summary";
```

```ts
  it("chama os três envios com a janela do dia anterior e retorna os totais", async () => {
    vi.mocked(sendAdminDailySummaries).mockResolvedValueOnce({ sent: 3, failed: 0 });
    vi.mocked(sendOrganizerDailySummaries).mockResolvedValueOnce({ sent: 5, failed: 1 });
    vi.mocked(sendEventDailySummaries).mockResolvedValueOnce({ sent: 2, failed: 0 });

    const res = await POST(makeRequest({ "x-cron-secret": "test-secret" }));
    const body = await res.json();

    expect(sendAdminDailySummaries).toHaveBeenCalledWith(dayStart, dayEnd);
    expect(sendOrganizerDailySummaries).toHaveBeenCalledWith(dayStart, dayEnd);
    expect(sendEventDailySummaries).toHaveBeenCalledWith(dayStart, dayEnd);
    expect(body).toEqual({ adminsSent: 3, adminsFailed: 0, organizersSent: 5, organizersFailed: 1, eventsSent: 2, eventsFailed: 0 });
  });
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run tests/cron-daily-summary-route.test.ts`
Expected: FAIL — route doesn't call `sendEventDailySummaries` yet.

- [ ] **Step 3: Update `app/api/cron/daily-summary/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  getYesterdayBrasiliaWindow,
  sendAdminDailySummaries,
  sendOrganizerDailySummaries,
  sendEventDailySummaries,
} from "@/lib/alerts/daily-summary";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { dayStart, dayEnd } = getYesterdayBrasiliaWindow();
  const [admins, organizers, events] = await Promise.all([
    sendAdminDailySummaries(dayStart, dayEnd),
    sendOrganizerDailySummaries(dayStart, dayEnd),
    sendEventDailySummaries(dayStart, dayEnd),
  ]);

  return NextResponse.json({
    adminsSent: admins.sent,
    adminsFailed: admins.failed,
    organizersSent: organizers.sent,
    organizersFailed: organizers.failed,
    eventsSent: events.sent,
    eventsFailed: events.failed,
  });
}
```

- [ ] **Step 4: Run the full suite, confirm green**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/daily-summary/route.ts tests/cron-daily-summary-route.test.ts
git commit -m "feat: cron de resumo diario tambem dispara o resumo por evento"
```

---

### Task 15: API routes for event-scoped daily-summary contacts

**Files:**
- Create: `app/api/events/[id]/daily-summary-recipients/route.ts`, `app/api/events/[id]/daily-summary-recipients/[recipientId]/route.ts`
- Test: Create `tests/event-daily-summary-recipients-route.test.ts`, `tests/event-daily-summary-recipients-id-route.test.ts`

**Interfaces:**
- Consumes: `resolveActingScope` (existing, `lib/auth/rbac.ts`), `DailySummaryRecipient.eventId` (Task 10).
- Produces: `GET/POST /api/events/[id]/daily-summary-recipients`, `DELETE
  /api/events/[id]/daily-summary-recipients/[recipientId]` — consumed by Task 16 (UI).

- [ ] **Step 1: Write the failing tests first**

Create `tests/event-daily-summary-recipients-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, POST } from "@/app/api/events/[id]/daily-summary-recipients/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/events/event-1/daily-summary-recipients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("GET /api/events/[id]/daily-summary-recipients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await GET(new Request("http://localhost") as any, makeContext("event-1"));
    expect(res.status).toBe(401);
  });

  it("retorna 404 quando o evento não existe ou não pertence ao organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost") as any, makeContext("event-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "event-1", organizer: { userId: "org-1" } },
      select: { id: true, organizer: { select: { userId: true } } },
    });
    expect(res.status).toBe(404);
  });

  it("admin acessa qualquer evento, sem filtro de organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", organizer: { userId: "org-1" } });
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([]);

    const res = await GET(new Request("http://localhost") as any, makeContext("event-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "event-1" },
      select: { id: true, organizer: { select: { userId: true } } },
    });
    expect(res.status).toBe(200);
  });

  it("lista os contatos cadastrados pra esse evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", organizer: { userId: "org-1" } });
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([
      { id: "r1", name: "Maria", type: "EMAIL", value: "maria@example.com" },
    ]);

    const res = await GET(new Request("http://localhost") as any, makeContext("event-1"));
    const body = await res.json();

    expect(dbMock.dailySummaryRecipient.findMany).toHaveBeenCalledWith({
      where: { eventId: "event-1" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, type: true, value: true },
    });
    expect(body).toEqual({ recipients: [{ id: "r1", name: "Maria", type: "EMAIL", value: "maria@example.com" }] });
  });
});

describe("POST /api/events/[id]/daily-summary-recipients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna 400 quando o e-mail é inválido", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", organizer: { userId: "org-1" } });

    const res = await POST(makeRequest({ name: "Maria", type: "EMAIL", value: "não-é-email" }), makeContext("event-1"));
    expect(res.status).toBe(400);
    expect(dbMock.dailySummaryRecipient.create).not.toHaveBeenCalled();
  });

  it("cria o contato com userId apontando pro organizador dono do evento, mesmo quando é o admin quem cadastra", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", organizer: { userId: "org-owner-1" } });
    dbMock.dailySummaryRecipient.create.mockResolvedValueOnce({ id: "r1", name: "Maria", type: "EMAIL", value: "maria@example.com" });

    const res = await POST(makeRequest({ name: "Maria", type: "EMAIL", value: "maria@example.com" }), makeContext("event-1"));

    expect(res.status).toBe(201);
    expect(dbMock.dailySummaryRecipient.create).toHaveBeenCalledWith({
      data: { userId: "org-owner-1", eventId: "event-1", name: "Maria", type: "EMAIL", value: "maria@example.com" },
      select: { id: true, name: true, type: true, value: true },
    });
  });
});
```

Create `tests/event-daily-summary-recipients-id-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { DELETE } from "@/app/api/events/[id]/daily-summary-recipients/[recipientId]/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string, recipientId: string) {
  return { params: Promise.resolve({ id, recipientId }) };
}

describe("DELETE /api/events/[id]/daily-summary-recipients/[recipientId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna 404 quando o evento não pertence ao organizador autenticado", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(new Request("http://localhost") as any, makeContext("event-1", "r1"));
    expect(res.status).toBe(404);
    expect(dbMock.dailySummaryRecipient.delete).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o contato não pertence a esse evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", organizer: { userId: "org-1" } });
    dbMock.dailySummaryRecipient.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(new Request("http://localhost") as any, makeContext("event-1", "r1"));

    expect(dbMock.dailySummaryRecipient.findFirst).toHaveBeenCalledWith({ where: { id: "r1", eventId: "event-1" } });
    expect(res.status).toBe(404);
  });

  it("remove o contato quando pertence ao evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", organizer: { userId: "org-1" } });
    dbMock.dailySummaryRecipient.findFirst.mockResolvedValueOnce({ id: "r1", eventId: "event-1" });

    const res = await DELETE(new Request("http://localhost") as any, makeContext("event-1", "r1"));
    const body = await res.json();

    expect(dbMock.dailySummaryRecipient.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
    expect(body).toEqual({ success: true });
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run tests/event-daily-summary-recipients-route.test.ts tests/event-daily-summary-recipients-id-route.test.ts`
Expected: FAIL — route files don't exist yet.

- [ ] **Step 3: Implement `app/api/events/[id]/daily-summary-recipients/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

const schema = z
  .object({
    name: z.string().min(1, "Nome é obrigatório"),
    type: z.enum(["EMAIL", "WHATSAPP"]),
    value: z.string().min(1, "Valor é obrigatório"),
  })
  .superRefine((data, ctx) => {
    if (data.type === "EMAIL") {
      if (!z.string().email().safeParse(data.value).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "E-mail inválido" });
      }
    } else {
      const digits = data.value.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 11) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: "Informe DDD + número (10 ou 11 dígitos, sem +55)",
        });
      }
    }
  });

async function checkEventAccess(eventId: string) {
  const session = await auth();
  if (!session?.user) {
    return { allowed: false as const, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }
  if (!["ADMIN", "ORGANIZER", "ASSISTANT"].includes(session.user.role)) {
    return { allowed: false as const, response: NextResponse.json({ error: "Não autorizado" }, { status: 403 }) };
  }
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({
    where: scope.actingAsAdmin ? { id: eventId } : { id: eventId, organizer: { userId: session.user.id } },
    select: { id: true, organizer: { select: { userId: true } } },
  });
  if (!event) {
    return { allowed: false as const, response: NextResponse.json({ error: "Evento não encontrado" }, { status: 404 }) };
  }
  return { allowed: true as const, session, event };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkEventAccess(id);
  if (!check.allowed) return check.response;

  const recipients = await db.dailySummaryRecipient.findMany({
    where: { eventId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, type: true, value: true },
  });
  return NextResponse.json({ recipients });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkEventAccess(id);
  if (!check.allowed) return check.response;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const value = parsed.data.type === "WHATSAPP" ? parsed.data.value.replace(/\D/g, "") : parsed.data.value;

  // userId sempre aponta pro organizador dono do evento — mesmo quando é o admin quem cadastra,
  // preservando "esse contato pertence ao dono do evento" (mesma regra dos contatos agregados).
  const recipient = await db.dailySummaryRecipient.create({
    data: { userId: check.event.organizer.userId, eventId: id, name: parsed.data.name, type: parsed.data.type, value },
    select: { id: true, name: true, type: true, value: true },
  });

  return NextResponse.json({ recipient }, { status: 201 });
}
```

- [ ] **Step 4: Implement `app/api/events/[id]/daily-summary-recipients/[recipientId]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; recipientId: string }> }) {
  const { id, recipientId } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!["ADMIN", "ORGANIZER", "ASSISTANT"].includes(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({
    where: scope.actingAsAdmin ? { id } : { id, organizer: { userId: session.user.id } },
    select: { id: true },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const recipient = await db.dailySummaryRecipient.findFirst({ where: { id: recipientId, eventId: id } });
  if (!recipient) return NextResponse.json({ error: "Destinatário não encontrado" }, { status: 404 });

  await db.dailySummaryRecipient.delete({ where: { id: recipientId } });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Run the full suite, confirm green**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/events/[id]/daily-summary-recipients tests/event-daily-summary-recipients-route.test.ts tests/event-daily-summary-recipients-id-route.test.ts
git commit -m "feat: rotas de contato de resumo diario escopado a um evento (organizador ou admin do evento)"
```

---

### Task 16: UI — "Resumo diário deste evento" on the event edit page

**Files:**
- Create: `components/organizer/EventDailySummaryRecipientsManager.tsx`
- Modify: `app/organizador/eventos/[id]/editar/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/events/[id]/daily-summary-recipients`, `DELETE
  /api/events/[id]/daily-summary-recipients/[recipientId]` (Task 15).

No automated test — matches the Global Constraints note (no component-level tests in this
codebase). **Manual browser verification required before considering this task done**, per the
spec's Risks section: log in as an organizer, open an event's edit page, add an EMAIL contact, add a
WHATSAPP contact, remove one, confirm the list updates.

- [ ] **Step 1: Create `components/organizer/EventDailySummaryRecipientsManager.tsx`**

Adapt `components/profile/DailySummaryRecipientsManager.tsx` verbatim, with these changes: add an
`eventId: string` prop, and point every `fetch` at
`` `/api/events/${eventId}/daily-summary-recipients` `` (GET/POST) and
`` `/api/events/${eventId}/daily-summary-recipients/${deletingId}` `` (DELETE) instead of
`/api/daily-summary-recipients`:

```tsx
"use client";

import { useEffect, useState } from "react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

type RecipientType = "EMAIL" | "WHATSAPP";

type Recipient = {
  id: string;
  name: string;
  type: RecipientType;
  value: string;
};

export default function EventDailySummaryRecipientsManager({ eventId }: { eventId: string }) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [type, setType] = useState<RecipientType>("EMAIL");
  const [value, setValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch(`/api/events/${eventId}/daily-summary-recipients`)
      .then((res) => res.json())
      .then(({ recipients }) => setRecipients(recipients ?? []))
      .finally(() => setLoading(false));
  }, [eventId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/daily-summary-recipients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type, value: value.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (typeof data.error === "string") {
          setError(data.error);
        } else {
          const fieldMessage = Object.values(data.error?.fieldErrors ?? {}).flat()[0];
          const formMessage = data.error?.formErrors?.[0];
          setError((fieldMessage as string) ?? formMessage ?? "Erro ao adicionar destinatário.");
        }
        return;
      }
      const { recipient } = await res.json();
      setRecipients((prev) => [...prev, recipient]);
      setName("");
      setValue("");
    } finally {
      setAdding(false);
    }
  }

  async function doDelete() {
    if (!deletingId) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/daily-summary-recipients/${deletingId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (typeof data.error === "string") {
          setError(data.error);
        } else {
          const fieldMessage = Object.values(data.error?.fieldErrors ?? {}).flat()[0];
          const formMessage = data.error?.formErrors?.[0];
          setError((fieldMessage as string) ?? formMessage ?? "Erro ao remover destinatário.");
        }
        return;
      }
      setRecipients((prev) => prev.filter((r) => r.id !== deletingId));
    } finally {
      setDeleting(false);
      setDeletingId(null);
    }
  }

  if (loading) return null;

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold text-gray-900 dark:text-gray-100">Resumo diário deste evento</h2>
      <p className="text-xs text-gray-500">
        Cadastre contatos, por nome, para receberem um resumo diário só com os números deste evento (diferente do
        resumo agregado de todos os eventos, configurado no seu perfil).
      </p>

      {recipients.length > 0 && (
        <ul className="space-y-1">
          {recipients.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-800 rounded px-3 py-2"
            >
              <span>
                <strong>{r.name}</strong> — {r.type === "EMAIL" ? "E-mail" : "WhatsApp"}: {r.value}
              </span>
              <button type="button" onClick={() => setDeletingId(r.id)} className="text-red-600 text-xs hover:underline">
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field text-sm"
            placeholder="Ex: Maria (financeiro)"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo</label>
          <select value={type} onChange={(e) => setType(e.target.value as RecipientType)} className="input-field text-sm">
            <option value="EMAIL">E-mail</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            {type === "EMAIL" ? "E-mail" : "Telefone (DDD + número)"}
          </label>
          <input
            type={type === "EMAIL" ? "email" : "tel"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="input-field text-sm"
            placeholder={type === "EMAIL" ? "nome@exemplo.com" : "11999999999"}
            required
          />
        </div>
        <div className="sm:col-span-4">
          {type === "WHATSAPP" && (
            <p className="text-xs text-gray-500 mb-2">
              Informe só DDD + número, sem o +55 — o código do país é adicionado automaticamente no envio.
            </p>
          )}
          <button type="submit" disabled={adding} className="btn-secondary text-sm">
            {adding ? "Adicionando..." : "Adicionar destinatário"}
          </button>
        </div>
      </form>

      <ConfirmModal
        open={!!deletingId}
        title="Remover destinatário"
        message="Tem certeza que deseja remover este destinatário do resumo diário deste evento?"
        tone="danger"
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setDeletingId(null)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `app/organizador/eventos/[id]/editar/page.tsx`**

```tsx
import EditEventForm from "@/components/organizer/EditEventForm";
import EventDailySummaryRecipientsManager from "@/components/organizer/EventDailySummaryRecipientsManager";
```

```tsx
      <h1 className="text-2xl font-bold">Editar evento</h1>
      <EditEventForm event={event} cancellationPolicyEnabled={cancellationPolicyEnabled} />
      <EventDailySummaryRecipientsManager eventId={id} />
```

- [ ] **Step 3: Run the full suite, confirm green**

Run: `npx vitest run`
Run: `npx tsc --noEmit`
Expected: both clean (this task adds no test files but must not break anything else).

- [ ] **Step 4: Manual browser verification**

Start the dev server, log in as an organizer, open `/organizador/eventos/[id]/editar` for a real
event, and confirm: the new "Resumo diário deste evento" card renders below the edit form; adding an
EMAIL contact and a WHATSAPP contact both work and show up in the list; removing one works and the
list updates without a page reload.

- [ ] **Step 5: Commit**

```bash
git add components/organizer/EventDailySummaryRecipientsManager.tsx app/organizador/eventos/[id]/editar/page.tsx
git commit -m "feat: tela de edicao de evento ganha secao de resumo diario deste evento"
```

---

## Part 4 — Personalização de qualquer alerta por evento (admin, em `/admin/alertas`)

### Task 17: API — event-scoped template override (GET/PUT/DELETE)

**Files:**
- Create: `app/api/admin/message-templates/[id]/eventos/[eventId]/route.ts`
- Test: Create `tests/api-admin-message-templates-events.test.ts`

**Interfaces:**
- Consumes: `getEffectiveTemplate` (Task 5), `checkAdminOnlyApiPermission` (existing).
- Produces: `GET/PUT/DELETE /api/admin/message-templates/[id]/eventos/[eventId]` — consumed by Task 19 (page).

- [ ] **Step 1: Write the failing tests first**

Create `tests/api-admin-message-templates-events.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";

vi.mock("@/lib/auth/rbac", () => ({ checkAdminOnlyApiPermission: vi.fn() }));
vi.mock("@/lib/templates/resolve", () => ({ getEffectiveTemplate: vi.fn() }));

import { GET, PUT, DELETE } from "@/app/api/admin/message-templates/[id]/eventos/[eventId]/route";
import { getEffectiveTemplate } from "@/lib/templates/resolve";

const dbMock = db as any;
const adminSession = { user: { id: "admin-1", role: "ADMIN" } };

function allow() {
  vi.mocked(checkAdminOnlyApiPermission).mockResolvedValue({ allowed: true, session: adminSession as any });
}
function ctx(id: string, eventId: string) {
  return { params: Promise.resolve({ id, eventId }) };
}

describe("GET .../eventos/[eventId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404 quando o template global não existe", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost") as any, ctx("tpl-1", "event-1"));
    expect(res.status).toBe(404);
  });

  it("sem override de evento: retorna o conteúdo efetivo atual com isOverride: false", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({
      id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER",
    });
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce(null);
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({ subject: "Assunto global", body: "Corpo global", source: "global" });

    const res = await GET(new Request("http://localhost") as any, ctx("tpl-1", "event-1"));
    const data = await res.json();

    expect(getEffectiveTemplate).toHaveBeenCalledWith("LOW_STOCK", "EMAIL", "ORGANIZER", "event-1");
    expect(data.isOverride).toBe(false);
    expect(data.template.body).toBe("Corpo global");
    expect(data.template.id).toBeNull();
  });

  it("com override de evento já criado: retorna a linha salva com isOverride: true", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({
      id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER",
    });
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({ id: "tpl-event-1", body: "Corpo customizado" });
    dbMock.messageTemplateVersion.findMany.mockResolvedValueOnce([]);

    const res = await GET(new Request("http://localhost") as any, ctx("tpl-1", "event-1"));
    const data = await res.json();

    expect(data.isOverride).toBe(true);
    expect(data.template.body).toBe("Corpo customizado");
  });
});

describe("PUT .../eventos/[eventId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cria a linha EVENT quando ainda não existe (upsert)", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({ id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER" });
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce(null);
    dbMock.messageTemplate.create.mockResolvedValueOnce({ id: "tpl-event-1" });

    const res = await PUT(
      new Request("http://localhost", { method: "PUT", body: JSON.stringify({ subject: "S {{nome_evento}}", body: "B {{nome_organizador}}", active: true }) }) as any,
      ctx("tpl-1", "event-1"),
    );

    expect(res.status).toBe(200);
    expect(dbMock.messageTemplate.create).toHaveBeenCalledWith({
      data: {
        alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER", scope: "EVENT", eventId: "event-1",
        subject: "S {{nome_evento}}", body: "B {{nome_organizador}}", rowTemplate: undefined, active: true, updatedByUserId: "admin-1",
      },
    });
  });

  it("atualiza a linha EVENT quando já existe (grava versão antes)", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({ id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER" });
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({ id: "tpl-event-1", subject: "S antigo", body: "B antigo", rowTemplate: null, active: true });
    dbMock.messageTemplate.update.mockResolvedValueOnce({ id: "tpl-event-1" });

    const res = await PUT(
      new Request("http://localhost", { method: "PUT", body: JSON.stringify({ subject: "S novo", body: "B novo", active: true }) }) as any,
      ctx("tpl-1", "event-1"),
    );

    expect(res.status).toBe(200);
    expect(dbMock.messageTemplateVersion.create).toHaveBeenCalledWith({
      data: { templateId: "tpl-event-1", subject: "S antigo", body: "B antigo", rowTemplate: null, active: true, changedByUserId: "admin-1" },
    });
    expect(dbMock.messageTemplate.update).toHaveBeenCalledWith({
      where: { id: "tpl-event-1" },
      data: { subject: "S novo", body: "B novo", rowTemplate: undefined, active: true, updatedByUserId: "admin-1" },
    });
  });

  it("rejeita variável desconhecida sem criar nem atualizar nada", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({ id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER" });
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });

    const res = await PUT(
      new Request("http://localhost", { method: "PUT", body: JSON.stringify({ subject: "S", body: "{{hacker_var}}", active: true }) }) as any,
      ctx("tpl-1", "event-1"),
    );

    expect(res.status).toBe(400);
    expect(dbMock.messageTemplate.create).not.toHaveBeenCalled();
    expect(dbMock.messageTemplate.update).not.toHaveBeenCalled();
  });

  it("404 quando o evento não existe", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({ id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER" });
    dbMock.event.findUnique.mockResolvedValueOnce(null);

    const res = await PUT(
      new Request("http://localhost", { method: "PUT", body: JSON.stringify({ body: "B", active: true }) }) as any,
      ctx("tpl-1", "event-inexistente"),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE .../eventos/[eventId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404 quando não existe personalização pra remover", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({ id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER" });
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(new Request("http://localhost") as any, ctx("tpl-1", "event-1"));
    expect(res.status).toBe(404);
    expect(dbMock.messageTemplate.delete).not.toHaveBeenCalled();
  });

  it("apaga a linha EVENT de vez (não marca active: false)", async () => {
    allow();
    dbMock.messageTemplate.findUnique.mockResolvedValueOnce({ id: "tpl-1", alertKey: "LOW_STOCK", channel: "EMAIL", recipientRole: "ORGANIZER" });
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({ id: "tpl-event-1" });

    const res = await DELETE(new Request("http://localhost") as any, ctx("tpl-1", "event-1"));
    const body = await res.json();

    expect(dbMock.messageTemplate.delete).toHaveBeenCalledWith({ where: { id: "tpl-event-1" } });
    expect(body).toEqual({ success: true });
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run tests/api-admin-message-templates-events.test.ts`
Expected: FAIL — route file doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `app/api/admin/message-templates/[id]/eventos/[eventId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getAlertDefinition } from "@/lib/templates/registry";
import { validateTemplateVariables } from "@/lib/templates/render";
import { getEffectiveTemplate } from "@/lib/templates/resolve";

async function findEventOverride(globalTemplate: { alertKey: string; channel: string; recipientRole: string }, eventId: string) {
  return db.messageTemplate.findFirst({
    where: {
      alertKey: globalTemplate.alertKey,
      channel: globalTemplate.channel,
      recipientRole: globalTemplate.recipientRole,
      scope: "EVENT",
      eventId,
    },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;

  const { id, eventId } = await params;
  const globalTemplate = await db.messageTemplate.findUnique({ where: { id } });
  if (!globalTemplate) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

  const eventRow = await findEventOverride(globalTemplate, eventId);
  if (eventRow) {
    const versions = await db.messageTemplateVersion.findMany({ where: { templateId: eventRow.id }, orderBy: { createdAt: "desc" } });
    return NextResponse.json({ template: eventRow, versions, isOverride: true });
  }

  const effective = await getEffectiveTemplate(
    globalTemplate.alertKey,
    globalTemplate.channel as "EMAIL" | "WHATSAPP",
    globalTemplate.recipientRole,
    eventId,
  );
  return NextResponse.json({
    template: {
      id: null,
      alertKey: globalTemplate.alertKey,
      channel: globalTemplate.channel,
      recipientRole: globalTemplate.recipientRole,
      subject: effective.subject ?? null,
      body: effective.body,
      rowTemplate: effective.rowTemplate ?? null,
      active: true,
    },
    versions: [],
    isOverride: false,
  });
}

const putSchema = z.object({
  subject: z.string().max(998).optional(),
  body: z.string().min(1),
  rowTemplate: z.string().optional(),
  active: z.boolean(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, eventId } = await params;
  const globalTemplate = await db.messageTemplate.findUnique({ where: { id } });
  if (!globalTemplate) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const parsed = putSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { subject, body, rowTemplate, active } = parsed.data;

  const def = getAlertDefinition(globalTemplate.alertKey);
  const { valid, unknown } = validateTemplateVariables(`${subject ?? ""} ${body}`, def?.variables ?? []);
  if (!valid) {
    return NextResponse.json({ error: "Variável desconhecida no template", unknownVariables: unknown }, { status: 400 });
  }
  if (def?.rowVariables) {
    const rowCheck = validateTemplateVariables(rowTemplate ?? "", def.rowVariables);
    if (!rowCheck.valid) {
      return NextResponse.json({ error: "Variável desconhecida no template de cada linha", unknownVariables: rowCheck.unknown }, { status: 400 });
    }
  }

  const existing = await findEventOverride(globalTemplate, eventId);

  let eventRow;
  if (existing) {
    await db.messageTemplateVersion.create({
      data: { templateId: existing.id, subject: existing.subject, body: existing.body, rowTemplate: existing.rowTemplate, active: existing.active, changedByUserId: session.user.id },
    });
    eventRow = await db.messageTemplate.update({
      where: { id: existing.id },
      data: { subject, body, rowTemplate, active, updatedByUserId: session.user.id },
    });
  } else {
    eventRow = await db.messageTemplate.create({
      data: {
        alertKey: globalTemplate.alertKey,
        channel: globalTemplate.channel,
        recipientRole: globalTemplate.recipientRole,
        scope: "EVENT",
        eventId,
        subject,
        body,
        rowTemplate,
        active,
        updatedByUserId: session.user.id,
      },
    });
  }

  return NextResponse.json({ template: eventRow, isOverride: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;

  const { id, eventId } = await params;
  const globalTemplate = await db.messageTemplate.findUnique({ where: { id } });
  if (!globalTemplate) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

  const eventRow = await findEventOverride(globalTemplate, eventId);
  if (!eventRow) return NextResponse.json({ error: "Personalização não encontrada" }, { status: 404 });

  // Apaga de vez (não marca active: false) — decisão fechada na spec: uma personalização por
  // evento desativada não tem valor (diferente do GLOBAL, que sempre existe como registro único).
  await db.messageTemplate.delete({ where: { id: eventRow.id } });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Run the full suite, confirm green**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/message-templates/[id]/eventos tests/api-admin-message-templates-events.test.ts
git commit -m "feat: rotas de personalizacao de template por evento (GET/PUT/DELETE, admin-only)"
```

---

### Task 18: `MessageTemplateEditor` supports event-scoped save/delete

**Files:**
- Modify: `components/admin/MessageTemplateEditor.tsx`, `app/admin/alertas/templates/[id]/page.tsx`

**Interfaces:**
- Produces: new props `saveUrl: string` (replaces the hardcoded PUT path), `deleteUrl?: string`,
  `isOverride?: boolean`, `showPreviewAndTestSend?: boolean` (defaults `true`) — consumed by Task 19.

No automated test (component-level, per Global Constraints) — covered by Task 17's route tests plus
manual browser verification in Task 19.

- [ ] **Step 1: Change the props signature**

```tsx
export default function MessageTemplateEditor({
  templateId,
  saveUrl,
  showPreviewAndTestSend = true,
  isOverride = false,
  deleteUrl,
  initialSubject,
  initialBody,
  initialRowTemplate,
  initialActive,
  channel,
  variables,
  rowVariables,
  versions,
}: {
  templateId: string | null;
  saveUrl: string;
  showPreviewAndTestSend?: boolean;
  isOverride?: boolean;
  deleteUrl?: string;
  initialSubject: string | null;
  initialBody: string;
  initialRowTemplate?: string | null;
  initialActive: boolean;
  channel: "EMAIL" | "WHATSAPP";
  variables: VariableDef[];
  rowVariables?: VariableDef[];
  versions: VersionRow[];
}) {
```

Add `"use client";`-scoped imports and state for delete-override and navigation:

```tsx
import { useRouter } from "next/navigation";
```

```tsx
  const router = useRouter();
  const [rowTemplate, setRowTemplate] = useState(initialRowTemplate ?? "");
  const [confirmingDeleteOverride, setConfirmingDeleteOverride] = useState(false);
  const [deletingOverride, setDeletingOverride] = useState(false);
```

- [ ] **Step 2: Point `handleSave` at `saveUrl` and include `rowTemplate` when applicable**

```tsx
  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    const res = await fetch(saveUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: channel === "EMAIL" ? subject : undefined,
        body,
        ...(rowVariables && rowVariables.length > 0 ? { rowTemplate } : {}),
        active,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(
        data.unknownVariables?.length
          ? `Variáveis desconhecidas: ${data.unknownVariables.map((v: string) => `{{${v}}}`).join(", ")}`
          : data.error ?? "Erro ao salvar",
      );
      return;
    }
    setMessage("Salvo com sucesso.");
  }
```

`handlePreview`/`handleTestSend`/`handleRevert` stay unchanged (still hit `/api/admin/message-templates/${templateId}/...` — only rendered when `showPreviewAndTestSend` is true and `templateId` is non-null, per Step 4).

- [ ] **Step 3: Add `handleDeleteOverride`**

```tsx
  async function handleDeleteOverride() {
    if (!deleteUrl) return;
    setDeletingOverride(true);
    setError(null);
    const res = await fetch(deleteUrl, { method: "DELETE" });
    setDeletingOverride(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao remover personalização");
      setConfirmingDeleteOverride(false);
      return;
    }
    router.push("/admin/alertas");
  }
```

- [ ] **Step 4: Gate preview/test-send buttons and render the delete-override button**

Change the buttons block:

```tsx
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary px-6 disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
          {showPreviewAndTestSend && templateId && (
            <>
              <button type="button" onClick={handlePreview} className="btn-secondary px-4">
                Pré-visualizar
              </button>
              <button type="button" onClick={handleTestSend} className="btn-secondary px-4">
                Enviar teste pra mim
              </button>
            </>
          )}
          {deleteUrl && isOverride && (
            <button
              type="button"
              onClick={() => setConfirmingDeleteOverride(true)}
              className="btn-secondary px-4 text-red-600"
            >
              Remover personalização (voltar ao texto global)
            </button>
          )}
        </div>
```

Also wrap the existing `{preview && (...)}`, `{versions.length > 0 && (...)}` blocks unchanged
(they already degrade gracefully — `preview` state is simply never set when the buttons are hidden,
and `versions` will be `[]` for event-scope callers per Task 19).

Add the new `ConfirmModal` next to the existing revert one:

```tsx
      <ConfirmModal
        open={confirmingDeleteOverride}
        title="Remover personalização"
        message="Isso remove o texto customizado deste evento — ele volta a usar o texto global."
        confirmLabel="Remover"
        tone="danger"
        loading={deletingOverride}
        onConfirm={handleDeleteOverride}
        onCancel={() => setConfirmingDeleteOverride(false)}
      />
```

- [ ] **Step 5: Add the row-template field and its legend (same as Task 9 — if Task 9 already
landed, this step is a no-op; both tasks touch the same file so whichever lands second should find
these already present)**

(This step's content is identical to Task 9 Steps 1 and 3 — included here for completeness in case
the tasks execute out of order; skip if already present.)

- [ ] **Step 6: Update the existing caller, `app/admin/alertas/templates/[id]/page.tsx`**

```tsx
      <MessageTemplateEditor
        templateId={template.id}
        saveUrl={`/api/admin/message-templates/${template.id}`}
        initialSubject={template.subject}
        initialBody={template.body}
        initialRowTemplate={template.rowTemplate}
        initialActive={template.active}
        channel={template.channel as "EMAIL" | "WHATSAPP"}
        variables={variables}
        rowVariables={rowVariables}
        versions={versions.map((v) => ({
          id: v.id,
          subject: v.subject,
          body: v.body,
          active: v.active,
          createdAt: v.createdAt.toISOString(),
        }))}
      />
```

- [ ] **Step 7: Run the full suite, confirm green**

Run: `npx vitest run`
Run: `npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add components/admin/MessageTemplateEditor.tsx app/admin/alertas/templates/[id]/page.tsx
git commit -m "feat: editor de templates suporta salvar/remover personalizacao por evento"
```

---

### Task 19: New page — personalize a template for one event

**Files:**
- Create: `app/admin/alertas/templates/[id]/eventos/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `MessageTemplateEditor` (Task 18), `getEffectiveTemplate` (Task 5).

No automated test (Server Component page rendering data already covered by Task 17's route-level
logic, which this page duplicates via direct `db` calls — same pattern as the existing
`EditMessageTemplatePage`). **Manual browser verification required**, per the spec's Risks section.

- [ ] **Step 1: Create the page**

```tsx
import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { getVariablesByNames } from "@/lib/templates/variables";
import { getAlertDefinition } from "@/lib/templates/registry";
import { getEffectiveTemplate } from "@/lib/templates/resolve";
import MessageTemplateEditor from "@/components/admin/MessageTemplateEditor";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Personalizar template por evento — Admin" };

export default async function EditEventMessageTemplatePage({
  params,
}: {
  params: Promise<{ id: string; eventId: string }>;
}) {
  await requireAdmin();
  const { id, eventId } = await params;

  const [globalTemplate, event] = await Promise.all([
    db.messageTemplate.findUnique({ where: { id } }),
    db.event.findUnique({ where: { id: eventId }, select: { id: true, title: true } }),
  ]);
  if (!globalTemplate || !event) notFound();

  const eventRow = await db.messageTemplate.findFirst({
    where: {
      alertKey: globalTemplate.alertKey,
      channel: globalTemplate.channel,
      recipientRole: globalTemplate.recipientRole,
      scope: "EVENT",
      eventId,
    },
  });

  const def = getAlertDefinition(globalTemplate.alertKey);
  const variables = getVariablesByNames(def?.variables ?? []);
  const rowVariables = def?.rowVariables ? getVariablesByNames(def.rowVariables) : undefined;

  let initialSubject: string | null;
  let initialBody: string;
  let initialRowTemplate: string | null;
  let initialActive: boolean;
  const isOverride = !!eventRow;

  if (eventRow) {
    initialSubject = eventRow.subject;
    initialBody = eventRow.body;
    initialRowTemplate = eventRow.rowTemplate;
    initialActive = eventRow.active;
  } else {
    const effective = await getEffectiveTemplate(
      globalTemplate.alertKey,
      globalTemplate.channel as "EMAIL" | "WHATSAPP",
      globalTemplate.recipientRole,
      eventId,
    );
    initialSubject = effective.subject ?? null;
    initialBody = effective.body;
    initialRowTemplate = effective.rowTemplate ?? null;
    initialActive = true;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold">{def?.description ?? globalTemplate.alertKey}</h1>
        <p className="text-sm text-gray-500">Personalizando só para o evento: <strong>{event.title}</strong></p>
      </div>
      <p className="text-sm text-gray-500">
        {isOverride
          ? "Este evento já tem um texto próprio para este alerta."
          : "Este evento ainda usa o texto global — salvar aqui cria uma personalização só para ele."}
      </p>
      <MessageTemplateEditor
        templateId={eventRow?.id ?? null}
        saveUrl={`/api/admin/message-templates/${id}/eventos/${eventId}`}
        showPreviewAndTestSend={false}
        isOverride={isOverride}
        deleteUrl={isOverride ? `/api/admin/message-templates/${id}/eventos/${eventId}` : undefined}
        initialSubject={initialSubject}
        initialBody={initialBody}
        initialRowTemplate={initialRowTemplate}
        initialActive={initialActive}
        channel={globalTemplate.channel as "EMAIL" | "WHATSAPP"}
        variables={variables}
        rowVariables={rowVariables}
        versions={[]}
      />
    </div>
  );
}
```

(`versions={[]}` deliberately skips revert-history for event overrides — not part of the spec's
backend section for this feature, which only asks for GET/PUT/DELETE.)

- [ ] **Step 2: Run the full suite, confirm green**

Run: `npx vitest run`
Run: `npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 3: Manual browser verification**

Start the dev server, log in as admin, navigate directly to
`/admin/alertas/templates/<a real template id>/eventos/<a real event id>`: confirm the "ainda usa o
texto global" message shows, editing + saving creates the override (message flips to "já tem um
texto próprio"), the "Remover personalização" button appears and works (redirects back to
`/admin/alertas`), and re-visiting the same URL after removal shows the global-fallback message
again.

- [ ] **Step 4: Commit**

```bash
git add app/admin/alertas/templates/[id]/eventos
git commit -m "feat: pagina de personalizacao de template por evento"
```

---

### Task 20: `MessageTemplateList` — "Personalizar para um evento" picker

**Files:**
- Modify: `components/admin/MessageTemplateList.tsx`, `app/admin/alertas/page.tsx`

**Interfaces:**
- Consumes: the new page from Task 19 (navigates to it via `router.push`).

No automated test (component-level, per Global Constraints) — verify manually alongside Task 19.

- [ ] **Step 1: Add an event picker per row in `MessageTemplateList.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

interface TemplateRow {
  id: string | null;
  alertKey: string;
  description: string;
  channel: string;
  recipientRole: string;
  scope: string;
  active: boolean;
  updatedAt: string | null;
}

interface EventOption {
  id: string;
  title: string;
}

export default function MessageTemplateList({ templates, events }: { templates: TemplateRow[]; events: EventOption[] }) {
  const router = useRouter();
  const [selectedEvent, setSelectedEvent] = useState<Record<string, string>>({});

  function goToEventOverride(t: TemplateRow) {
    const key = `${t.alertKey}:${t.channel}:${t.recipientRole}`;
    const eventId = selectedEvent[key];
    if (!t.id || !eventId) return;
    router.push(`/admin/alertas/templates/${t.id}/eventos/${eventId}`);
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            <th className="py-2 pr-4">Alerta</th>
            <th className="py-2 pr-4">Canal</th>
            <th className="py-2 pr-4">Destinatário</th>
            <th className="py-2 pr-4">Personalização</th>
            <th className="py-2 pr-4">Última alteração</th>
            <th className="py-2 pr-4" />
            <th className="py-2">Personalizar por evento</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => {
            const key = `${t.alertKey}:${t.channel}:${t.recipientRole}`;
            return (
              <tr key={key} className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-2 pr-4">{t.description}</td>
                <td className="py-2 pr-4">{t.channel === "EMAIL" ? "E-mail" : "WhatsApp"}</td>
                <td className="py-2 pr-4">{t.recipientRole}</td>
                <td className="py-2 pr-4">
                  <span className={t.id && t.active ? "text-green-700 dark:text-green-400" : "text-gray-400"}>
                    {t.id && t.active ? "Personalizado" : "Texto padrão"}
                  </span>
                </td>
                <td className="py-2 pr-4 text-gray-500">
                  {t.updatedAt ? new Date(t.updatedAt).toLocaleString("pt-BR") : "Nunca editado"}
                </td>
                <td className="py-2 pr-4">
                  {t.id && (
                    <Link href={`/admin/alertas/templates/${t.id}`} className="text-primary-700 dark:text-primary-400 hover:underline">
                      Editar
                    </Link>
                  )}
                </td>
                <td className="py-2">
                  {t.id && (
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedEvent[key] ?? ""}
                        onChange={(e) => setSelectedEvent((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="input-field text-xs py-1"
                      >
                        <option value="">Selecione um evento…</option>
                        {events.map((ev) => (
                          <option key={ev.id} value={ev.id}>{ev.title}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => goToEventOverride(t)}
                        disabled={!selectedEvent[key]}
                        className="text-primary-700 dark:text-primary-400 hover:underline text-xs disabled:opacity-40 disabled:hover:no-underline"
                      >
                        Personalizar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Fetch events and pass them from `app/admin/alertas/page.tsx`**

```tsx
import { db } from "@/lib/db";
```

```tsx
  const [lowStock, abandonedCart, paymentError, reconciliation, cancellation, advertiserRequest, events] = await Promise.all([
    getLowStockAlertSettings(),
    getAbandonedCartAlertSettings(),
    getPaymentErrorAlertSettings(),
    getReconciliationAlertSettings(),
    getCancellationAlertSettings(),
    getAdvertiserRequestAlertSettings(),
    db.event.findMany({ where: { status: { notIn: ["CANCELLED"] } }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);
```

```tsx
      <div>
        <h2 className="text-lg font-semibold mb-3">Templates de mensagem</h2>
        <MessageTemplateList templates={await listTemplatesForAdmin()} events={events} />
      </div>
```

- [ ] **Step 3: Run the full suite, confirm green**

Run: `npx vitest run`
Run: `npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 4: Manual browser verification**

On `/admin/alertas`, confirm the new "Personalizar por evento" column shows an event `<select>` +
"Personalizar" button per row (disabled until an event is chosen), and clicking it after selecting
an event navigates to the Task 19 page for that exact template + event.

- [ ] **Step 5: Commit**

```bash
git add components/admin/MessageTemplateList.tsx app/admin/alertas/page.tsx
git commit -m "feat: lista de templates ganha seletor de evento pra personalizacao por evento"
```

---

---

## Part 5 — Thread `eventId` through the real senders (per-event personalization actually takes effect)

**Context (added after the final whole-branch review of Parts 1-4):** the final review found that `getEffectiveTemplate`'s `eventId` parameter — which lets an admin's per-event template override (Part 4) actually be selected — was only ever passed by the two read-only display routes Part 4 itself added. Every real sender (email/WhatsApp dispatch) called `getEffectiveTemplate` with 3 arguments, never 4, so an admin could save a per-event override and it would never be used. This was a gap in the original spec/plan, not an implementation defect — confirmed and scoped explicitly by the user, who chose to close it now rather than ship the write-only UI.

Not every alert is single-event-scoped: `RECONCILIATION_MISMATCH` (spans many events in one admin email), `DAILY_SUMMARY`/aggregate (spans all of an organizer's events), and `ADVERTISER_REQUEST_PENDING` (not event-related at all) correctly stay 3-argument calls — threading `eventId` through them would be meaningless or wrong. Only alerts genuinely scoped to one event at send time are in scope for Part 5: `DAILY_SUMMARY_EVENT`, `ORDER_CONFIRMED`/`ORDER_CONFIRMED_PROXY_BUYER`/`ORDER_CONFIRMED_PROXY_ATHLETE`, `LOW_STOCK`, `ABANDONED_CART`, `PAYMENT_ERROR`/`PAYMENT_ERROR_ORDER_CANCELLED`, `CANCELLATION_REQUESTED`.

### Task 21: `DAILY_SUMMARY_EVENT` senders pass `eventId`

**Files:**
- Modify: `lib/email.ts` (`sendEventDailySummaryEmail`), `lib/alerts/daily-summary.ts` (`buildEventWhatsAppText`, and `sendEventDailySummaries`'s two call sites)
- Test: `tests/alert-daily-summary.test.ts` (and `tests/lib-email.test.ts` if a direct test for `sendEventDailySummaryEmail` exists there — check first)

**Interfaces:**
- `sendEventDailySummaryEmail(params: { to: string; values: Record<string,string>; eventId?: string })` — add `eventId` to the params type, pass it as the 4th arg to `getEffectiveTemplate("DAILY_SUMMARY_EVENT", "EMAIL", "ADMIN", params.eventId)`.
- `buildEventWhatsAppText` currently takes `(values: Record<string,string>)` — add an `eventId: string` second parameter, pass it as the 4th arg to `getEffectiveTemplate("DAILY_SUMMARY_EVENT", "WHATSAPP", "ADMIN", eventId)`.
- `sendEventDailySummaries`'s per-recipient loop already has `eventId` in scope (it's iterating per event) — pass it into both the `sendEventDailySummaryEmail({...})` call and the `buildEventWhatsAppText(values, eventId)` call.

- [ ] **Step 1:** Read the current content of both files and the current `describe("sendEventDailySummaries", ...)` block in `tests/alert-daily-summary.test.ts` (added in Task 13) before editing.
- [ ] **Step 2 (TDD):** Update the existing test assertion(s) in `tests/alert-daily-summary.test.ts` that check `sendEventDailySummaryEmail`/the WhatsApp send to also expect `eventId` (e.g. add `eventId: "event-1"` to the `expect.objectContaining({...})` already asserting on `to`/`values`). Confirm the test fails against current code (missing `eventId` in the actual call).
- [ ] **Step 3:** Apply the 3 code changes above.
- [ ] **Step 4:** Run `npx vitest run` — full suite green. Run `npx tsc --noEmit` — clean.
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: resumo diario por evento passa eventId pro resolver de template, personalizacao por evento passa a valer nesse alerta"
```

### Task 22: `ORDER_CONFIRMED` family passes `eventId`

**Files:**
- Modify: `lib/email.ts` (`sendRegistrationConfirmationEmail`), `lib/notifications.ts` (`sendWhatsAppIfActive`)
- Test: `tests/lib-email.test.ts` (`describe("sendRegistrationConfirmationEmail", ...)`), `tests/notifications.test.ts`

**Interfaces:**
- Both functions ALREADY receive `eventId` in their parameters (`sendRegistrationConfirmationEmail`'s `params.eventId?: string`, already threaded from `notifyOrderConfirmed` in `lib/notifications.ts`; `sendWhatsAppIfActive`'s `eventId: string | undefined` parameter, already passed by both call sites in `notifyOrderConfirmed`). This task is a 2-line change: add the already-available `eventId` as the 4th argument to the two `getEffectiveTemplate` calls — `lib/email.ts`'s `getEffectiveTemplate(params.alertKey, "EMAIL", params.recipientRole)` → add `, params.eventId`; `lib/notifications.ts`'s `getEffectiveTemplate(alertKey, "WHATSAPP", recipientRole)` → add `, eventId`. No signature changes needed anywhere — the data already flows end-to-end, it just wasn't being used at the last step.

- [ ] **Step 1 (TDD):** In `tests/lib-email.test.ts`'s `describe("sendRegistrationConfirmationEmail", ...)`, find the existing test(s) asserting `expect(getEffectiveTemplate).toHaveBeenCalledWith("ORDER_CONFIRMED", "EMAIL", "BUYER")` (or similar for the proxy-athlete variant) and add the expected `eventId` as a 4th argument to at least one of them (the fixture that already passes `eventId: "event-1"` in its call to `sendRegistrationConfirmationEmail`). In `tests/notifications.test.ts`, do the same for whichever assertion(s) check `getEffectiveTemplate`'s call args (if `notifications.test.ts` doesn't currently assert on `getEffectiveTemplate`'s exact args at all, check whether it mocks `@/lib/templates/resolve` — if not, this file exercises the real `getEffectiveTemplate`/`resolve.ts` path already, and a new assertion may need to check the rendered content differs by event, or simply confirming existing tests keep passing is sufficient — use judgment, read the file first). Confirm whichever test(s) you add/change fail against current code.
- [ ] **Step 2:** Apply the 2-line change to both files.
- [ ] **Step 3:** Run `npx vitest run` — full suite green. Run `npx tsc --noEmit` — clean.
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: confirmacao de inscricao passa eventId pro resolver de template, personalizacao por evento passa a valer nesse alerta"
```

### Task 23: `LOW_STOCK` passes `eventId`

**Files:**
- Modify: `lib/email.ts` (`sendLowStockEmail`), `lib/alerts/low-stock.ts` (`checkLowStockAlert`)
- Test: `tests/lib-email.test.ts` (`describe("sendLowStockEmail", ...)`), `tests/alert-low-stock.test.ts`

**Interfaces:**
- `sendLowStockEmail`'s params gain `eventId?: string`; pass it as the 4th arg to `getEffectiveTemplate("LOW_STOCK", "EMAIL", "ORGANIZER", params.eventId)`.
- `checkLowStockAlert`'s `db.ticketBatch.findUnique` query currently selects `event: { select: { title: true, organizer: {...} } }` — add `id: true` alongside `title: true` in that nested select, so `batch.event.id` becomes available. Pass `eventId: batch.event.id` into the existing `sendLowStockEmail({...})` call, and add `batch.event.id` as the 4th arg to the WHATSAPP branch's `getEffectiveTemplate("LOW_STOCK", "WHATSAPP", "ORGANIZER")` call.

- [ ] **Step 1 (TDD):** In `tests/alert-low-stock.test.ts`, `batchFixture.event` currently has no `id` field (only `title`, `organizer`) — add `id: "event-1"`. Update the assertion(s) checking `db.ticketBatch.findUnique`'s `select` shape (if any assert the exact select object) to include `id: true`. Add/update an assertion that `sendLowStockEmail` was called with `eventId: "event-1"`, and that the WHATSAPP `getEffectiveTemplate` call includes `"event-1"` as its 4th arg. In `tests/lib-email.test.ts`'s `sendLowStockEmail` test, add `eventId: "event-1"` to the call under test and assert `getEffectiveTemplate` was called with it as the 4th arg. Confirm these fail against current code.
- [ ] **Step 2:** Apply the changes to both source files.
- [ ] **Step 3:** Run `npx vitest run` — full suite green. Run `npx tsc --noEmit` — clean.
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: alerta de vagas se esgotando passa eventId pro resolver de template, personalizacao por evento passa a valer nesse alerta"
```

### Task 24: `ABANDONED_CART` passes `eventId`

**Files:**
- Modify: `lib/email.ts` (`sendAbandonedCartEmail`), `lib/alerts/abandoned-cart.ts` (`AbandonedOrder` interface, `sendAbandonedCartAlert`, `checkAbandonedCarts`), `app/api/admin/abandoned-carts/notify/route.ts` (`ORDER_SELECT`), `app/api/organizer/abandoned-carts/notify/route.ts` (`ORDER_SELECT`)
- Test: `tests/lib-email.test.ts` (`describe("sendAbandonedCartEmail", ...)`), `tests/alert-abandoned-cart.test.ts`

**Interfaces:**
- `sendAbandonedCartEmail`'s params gain `eventId?: string`; pass it as the 4th arg to `getEffectiveTemplate("ABANDONED_CART", "EMAIL", "BUYER", params.eventId)`.
- `AbandonedOrder.event` widens from `{ title: string }` to `{ id: string; title: string }`.
- `checkAbandonedCarts`'s `db.order.findMany` select currently has `event: { select: { title: true } }` — add `id: true`.
- Both `ORDER_SELECT` constants (`app/api/admin/abandoned-carts/notify/route.ts` and `app/api/organizer/abandoned-carts/notify/route.ts`) currently have `event: { select: { title: true } }` — add `id: true` to both (these two files' own tests use `select: expect.any(Object)`, a loose match, so this change does not require updating those two route test files — confirmed by reading them first).
- `sendAbandonedCartAlert` passes `eventId: order.event.id` into its `sendAbandonedCartEmail({...})` call, and adds `order.event.id` as the 4th arg to its WHATSAPP `getEffectiveTemplate("ABANDONED_CART", "WHATSAPP", "BUYER")` call.

- [ ] **Step 1 (TDD):** In `tests/alert-abandoned-cart.test.ts`, the order fixture's `event: { title: "Corrida Teste" }` needs `id: "event-1"` added. Update the `expect(sendAbandonedCartEmail).toHaveBeenCalledWith(...)` assertions (there are 2, per an earlier grep) to include `eventId: "event-1"`, and add/update an assertion that the WHATSAPP `getEffectiveTemplate` call includes `"event-1"` as its 4th arg. In `tests/lib-email.test.ts`'s `sendAbandonedCartEmail` test, add `eventId: "event-1"` to the call under test and assert `getEffectiveTemplate` was called with it as the 4th arg. Confirm these fail against current code.
- [ ] **Step 2:** Apply the changes to all 4 source files.
- [ ] **Step 3:** Run `npx vitest run` — full suite green (including `tests/admin-abandoned-carts-notify-route.test.ts` and `tests/organizer-abandoned-carts-notify-route.test.ts`, which should need no changes per the loose-select-match check above — if either does break, read why before changing anything, since that would mean the "loose match" assumption was wrong). Run `npx tsc --noEmit` — clean.
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: carrinho abandonado passa eventId pro resolver de template, personalizacao por evento passa a valer nesse alerta"
```

### Task 25: `PAYMENT_ERROR`/`PAYMENT_ERROR_ORDER_CANCELLED` passes `eventId`

**Files:**
- Modify: `lib/email.ts` (`sendPaymentErrorEmail`), `lib/alerts/payment-error.ts` (`CancellationNotificationTarget`, `sendCancellationInviteNotification`, `notifyPaymentError`, `notifyOrderCancelledWithoutPayment`)
- Test: `tests/lib-email.test.ts` (`describe("sendPaymentErrorEmail", ...)`), `tests/alert-payment-error.test.ts`

**Interfaces:**
- `sendPaymentErrorEmail`'s params gain `eventId?: string`; pass it as the 4th arg to `getEffectiveTemplate("PAYMENT_ERROR", "EMAIL", "BUYER", params.eventId)` (this alert's factory default is shared with `PAYMENT_ERROR_ORDER_CANCELLED` via `ALERT_REGISTRY.PAYMENT_ERROR.factoryDefault`, but note `getEffectiveTemplate` is always called with the literal alertKey `"PAYMENT_ERROR"` here, per the current code — leave that as-is, only add `eventId`).
- `CancellationNotificationTarget.event` widens from `{ title: string; slug: string }` to `{ id: string; title: string; slug: string }`.
- Both `notifyPaymentError` and `notifyOrderCancelledWithoutPayment`'s `db.payment.findUnique`/`db.order.findUnique` selects currently have `event: { select: { title: true, slug: true } }` — add `id: true` to both.
- `sendCancellationInviteNotification` passes `eventId: params.event.id` into its `sendPaymentErrorEmail({...})` call, and adds `params.event.id` as the 4th arg to its WHATSAPP `getEffectiveTemplate(params.alertKey, "WHATSAPP", "BUYER")` call.

- [ ] **Step 1 (TDD):** Read `tests/alert-payment-error.test.ts` first to find its order/payment fixtures' `event` shape and the existing `sendPaymentErrorEmail`/`getEffectiveTemplate` assertions — add `id: "event-1"` to the fixture(s) and `eventId: "event-1"` / the 4th arg to the relevant assertions. In `tests/lib-email.test.ts`'s `sendPaymentErrorEmail` test, add `eventId: "event-1"` to the call under test and assert `getEffectiveTemplate` was called with it as the 4th arg. Confirm these fail against current code.
- [ ] **Step 2:** Apply the changes to both source files.
- [ ] **Step 3:** Run `npx vitest run` — full suite green. Run `npx tsc --noEmit` — clean.
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: erro de pagamento passa eventId pro resolver de template, personalizacao por evento passa a valer nesse alerta"
```

### Task 26: `CANCELLATION_REQUESTED` passes `eventId`

**Files:**
- Modify: `lib/email.ts` (`sendCancellationRequestedEmail`), `lib/alerts/cancellation-requested.ts` (`notifyCancellationRequested`)
- Test: `tests/lib-email.test.ts` (add a `describe("sendCancellationRequestedEmail", ...)` block if none exists yet — check first), `tests/alert-cancellation-requested.test.ts`

**Interfaces:**
- `sendCancellationRequestedEmail`'s params gain `eventId?: string`; pass it as the 4th arg to `getEffectiveTemplate("CANCELLATION_REQUESTED", "EMAIL", params.recipientRole, params.eventId)`.
- `notifyCancellationRequested`'s `db.registration.findUnique` select currently has `event: { select: { title: true, organizer: {...} } }` — add `id: true` alongside `title: true`.
- The function passes `eventId: registration.event.id` into its `sendCancellationRequestedEmail({...})` call, and adds `registration.event.id` as the 4th arg to its WHATSAPP `getEffectiveTemplate("CANCELLATION_REQUESTED", "WHATSAPP", recipientRoleFor(recipient))` call.

- [ ] **Step 1 (TDD):** Read `tests/alert-cancellation-requested.test.ts` first to find its registration fixture's `event` shape and existing `sendCancellationRequestedEmail`/`getEffectiveTemplate` assertions — add `id: "event-1"` to the fixture and `eventId`/the 4th arg to the relevant assertions. Check `tests/lib-email.test.ts` for an existing `sendCancellationRequestedEmail` test block; if none exists, this function is only exercised indirectly via `tests/alert-cancellation-requested.test.ts` — that's fine, no new block is required, just make sure the existing indirect coverage still passes and reflects the new arg. Confirm your changed assertions fail against current code before fixing.
- [ ] **Step 2:** Apply the changes to both source files.
- [ ] **Step 3:** Run `npx vitest run` — full suite green. Run `npx tsc --noEmit` — clean.
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: solicitacao de cancelamento passa eventId pro resolver de template, personalizacao por evento passa a valer nesse alerta"
```

---

## Final verification (after all 20 tasks)

- [ ] Run `npx vitest run` — full suite green.
- [ ] Run `npx tsc --noEmit` — clean.
- [ ] Run `npm run build` — clean (per Global Constraints / project convention, this is required
  before considering the branch done).
- [ ] Manual browser pass covering both new UI surfaces flagged above (Task 16, Task 19/20) — this
  is the first time `scope=EVENT` is exposed to a human, and the spec explicitly calls out that
  automated tests alone aren't sufficient here.
- [ ] Confirm no remaining references to `platformFeesRetained`, `buildAdminEmailRows`, or
  `buildOrganizerEmailRows` anywhere in the repo (`git grep`).
- [ ] This batch includes 2 schema migrations (Task 4, Task 10) — deploy needs
  `npx prisma db push --skip-generate` on the VPS before/alongside the new image, same as every
  prior schema-changing deploy this project has done. `DAILY_SUMMARY_EVENT` and
  `RECONCILIATION_MISMATCH`'s `rowTemplate` are both auto-handled (new alertKey gets seeded by
  `seedMessageTemplatesFromRegistry()`; `rowTemplate` resolves live from the factory default when
  the DB column is null) — **no manual `db:refresh-templates` run is required for this batch**,
  unlike the DAILY_SUMMARY/RECONCILIATION_MISMATCH *body* text changes in Tasks 2 and 5, which DO
  change existing factory defaults and therefore DO need
  `npm run db:refresh-templates` run against production after deploy, same as every prior
  factory-text change this session.

