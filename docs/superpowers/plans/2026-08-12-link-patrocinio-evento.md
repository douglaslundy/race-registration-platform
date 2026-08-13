# Link de patrocínio por evento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um campo novo por evento (`sponsorLink`) disponível como variável
`{{link_patrocinio}}` nos templates de confirmação de inscrição (e-mail e WhatsApp),
editável pelo organizador na tela de edição do evento.

**Architecture:** Um campo `Event.sponsorLink` (string opcional). A variável
`link_patrocinio` é acrescentada à lista de variáveis permitidas dos 3 alertas de
confirmação em `lib/templates/registry.ts`, e o valor real (`event.sponsorLink ?? ""`) é
passado pro objeto `values` já existente em `sendRegistrationConfirmationEmail` (e-mail)
e `notifyOrderConfirmed` (WhatsApp) — o motor de renderização (`renderTemplate`) já
resolve variáveis não referenciadas sem efeito nenhum, então templates que não usam
`{{link_patrocinio}}` continuam idênticos a hoje.

**Tech Stack:** Next.js App Router, Prisma (Postgres), react-hook-form + zod, Vitest.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-08-12-link-patrocinio-evento-design.md`.
- **O banco local aponta para produção** — nenhuma task deste plano executa `prisma migrate dev`, `prisma db push`, ou qualquer comando que toque o banco. A migration é escrita à mão; aplicá-la em produção acontece fora deste plano, com confirmação explícita do usuário, no momento do deploy.
- `npx prisma generate` (só regenera o client TS a partir do schema) é seguro e necessário rodar localmente após a Task 1.
- `{{link_patrocinio}}` só nos alertas `ORDER_CONFIRMED`, `ORDER_CONFIRMED_PROXY_BUYER`, `ORDER_CONFIRMED_PROXY_ATHLETE` — não em `ABANDONED_CART`/`PAYMENT_ERROR*`.
- Campo vazio (`null`) resolve pra string vazia — nunca lança erro nem quebra o template.

---

### Task 1: Schema — campo `sponsorLink` + migration escrita à mão

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260813000000_add_event_sponsor_link/migration.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `Event.sponsorLink: string | null` no Prisma Client, consumido pelas Tasks 2 e 3.

- [ ] **Step 1: Adicionar o campo no schema**

Em `prisma/schema.prisma`, no `model Event`, logo após a linha
`shirtSizeRestrictionSizes    ShirtSize[]` (a última adição de campo do evento):

```prisma
  shirtSizeRestrictionSizes    ShirtSize[]
  sponsorLink                  String?
```

- [ ] **Step 2: Escrever a migration à mão**

Criar `prisma/migrations/20260813000000_add_event_sponsor_link/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "events" ADD COLUMN "sponsorLink" TEXT;
```

Este repositório tem `/prisma/migrations/` no `.gitignore` — commitar a migration exige
`git add -f` (mesma pegadinha já documentada e resolvida numa feature anterior). Não
rodar `prisma migrate dev`, `db push`, nem qualquer comando que conecte no banco — o
arquivo é só texto.

- [ ] **Step 3: Regenerar o Prisma Client (seguro, não toca no banco)**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client ... to ./node_modules/@prisma/client`, sem erros.

- [ ] **Step 4: Confirmar que o projeto ainda compila**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Commit (com `git add -f` pra migration)**

```bash
git add prisma/schema.prisma
git add -f prisma/migrations/20260813000000_add_event_sponsor_link/migration.sql
git commit -m "feat: schema do link de patrocinio por evento"
```

Depois do commit, confirmar que a migration foi de fato versionada:

```bash
git show --stat HEAD
git ls-files prisma/migrations/20260813000000_add_event_sponsor_link/
```

Ambos devem listar `migration.sql` — se não listarem, o `git add -f` falhou
silenciosamente e o arquivo não foi commitado.

---

### Task 2: Variável de template + envio (e-mail e WhatsApp)

**Files:**
- Modify: `lib/templates/registry.ts`
- Modify: `lib/email.ts`
- Modify: `lib/notifications.ts`
- Test: `tests/lib-email.test.ts`

**Interfaces:**
- Consumes: `Event.sponsorLink` (Task 1).
- Produces: nada consumido por outras tasks (Task 3 é independente, só mexe na UI de
  edição do evento).

- [ ] **Step 1: Acrescentar a variável nos 3 alertas de confirmação**

Em `lib/templates/registry.ts`, nos 3 blocos `ORDER_CONFIRMED`,
`ORDER_CONFIRMED_PROXY_BUYER` e `ORDER_CONFIRMED_PROXY_ATHLETE`, acrescentar
`"link_patrocinio"` ao array `variables` de cada um:

```ts
  ORDER_CONFIRMED: {
    alertKey: "ORDER_CONFIRMED",
    description: "Confirmação de inscrição — comprador confirmando a própria inscrição. Quando a inscrição tem uma observação registrada, a produção anexa um parágrafo extra com o texto — fora do escopo desta etapa (bloco condicional, o motor de renderização não suporta condicionais).",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["BUYER"],
    variables: ["nome_atleta", "nome_evento", "codigo_confirmacao", "link_evento", "link_patrocinio"],
    ...
```

```ts
  ORDER_CONFIRMED_PROXY_BUYER: {
    alertKey: "ORDER_CONFIRMED_PROXY_BUYER",
    description: "Confirmação de inscrição — comprador que inscreveu outra pessoa (procuração).",
    channels: ["WHATSAPP"],
    recipientRoles: ["BUYER"],
    variables: ["nome_atleta", "nome_evento", "codigo_confirmacao", "link_evento", "link_patrocinio"],
    ...
```

```ts
  ORDER_CONFIRMED_PROXY_ATHLETE: {
    alertKey: "ORDER_CONFIRMED_PROXY_ATHLETE",
    description: "Confirmação de inscrição — atleta convidado por procuração.",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["ATHLETE"],
    variables: ["nome_atleta", "nome_comprador", "nome_evento", "codigo_confirmacao", "link_evento", "link_patrocinio"],
    ...
```

(Não mexer em `factoryDefault` de nenhum dos 3 — o texto padrão de fábrica não precisa
referenciar a variável nova; ela só fica *disponível* pra quem quiser usar.)

- [ ] **Step 2: Write the failing tests para o e-mail de confirmação**

Em `tests/lib-email.test.ts`, dentro do `describe("sendRegistrationConfirmationEmail", ...)`
(dedicado a esta função), acrescentar dois casos novos:

```ts
  it("resolve {{link_patrocinio}} quando o evento tem um link de patrocínio cadastrado", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto — {{nome_evento}}",
      body: "<p>Olá {{nome_atleta}}, veja também: {{link_patrocinio}}</p>",
      source: "global",
    });

    await sendRegistrationConfirmationEmail({
      to: "atleta@example.com",
      name: "Maria",
      registrationId: "reg-1",
      orderId: "order-1",
      eventTitle: "Corrida X",
      eventId: "event-1",
      alertKey: "ORDER_CONFIRMED",
      recipientRole: "BUYER",
      sponsorLink: "https://www.strava.com/routes/123",
    });

    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("https://www.strava.com/routes/123");
  });

  it("resolve {{link_patrocinio}} pra string vazia quando o evento não tem link cadastrado", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto — {{nome_evento}}",
      body: "<p>Link: [{{link_patrocinio}}]</p>",
      source: "global",
    });

    await sendRegistrationConfirmationEmail({
      to: "atleta@example.com",
      name: "Maria",
      registrationId: "reg-1",
      orderId: "order-1",
      eventTitle: "Corrida X",
      eventId: "event-1",
      alertKey: "ORDER_CONFIRMED",
      recipientRole: "BUYER",
    });

    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Link: []");
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/lib-email.test.ts`
Expected: FAIL — os dois testes novos (o parâmetro `sponsorLink` ainda não existe em
`sendRegistrationConfirmationEmail`, e `{{link_patrocinio}}` não é substituído por nada,
ficando literal no HTML).

- [ ] **Step 4: Implementar em `lib/email.ts`**

Em `lib/email.ts`, `sendRegistrationConfirmationEmail`, acrescentar `sponsorLink` aos
`params` e ao objeto `values`:

```ts
export async function sendRegistrationConfirmationEmail(params: {
  to: string;
  name: string;
  registrationId: string;
  orderId: string;
  eventTitle?: string;
  eventId?: string;
  notes?: string;
  alertKey: "ORDER_CONFIRMED" | "ORDER_CONFIRMED_PROXY_ATHLETE";
  recipientRole: "BUYER" | "ATHLETE";
  buyerName?: string;
  sponsorLink?: string | null;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const url = `${baseUrl}/dashboard/inscricoes/${params.registrationId}`;
  const values = {
    nome_atleta: params.name,
    nome_comprador: params.buyerName ?? params.name,
    nome_evento: params.eventTitle ?? "",
    codigo_confirmacao: params.orderId,
    link_evento: url,
    link_patrocinio: params.sponsorLink ?? "",
  };
  ...
```

- [ ] **Step 5: Implementar em `lib/notifications.ts`**

No `select` da query de `order` em `notifyOrderConfirmed` (dentro de
`db.order.findUnique`), acrescentar `sponsorLink: true` ao `select` de `event`:

```ts
        event: { select: { id: true, title: true, sponsorLink: true } },
```

Passar `sponsorLink: order.event?.sponsorLink` nas duas chamadas a
`sendRegistrationConfirmationEmail` (linhas do comprador e do atleta, dentro dos
respectivos `try`):

```ts
          await sendRegistrationConfirmationEmail({
            to: order.buyer.email,
            name: order.buyer.name,
            registrationId: registration.id,
            orderId,
            eventTitle: order.event?.title,
            eventId: order.event?.id,
            sponsorLink: order.event?.sponsorLink,
            notes: registration.notes ?? undefined,
            alertKey: "ORDER_CONFIRMED",
            recipientRole: "BUYER",
          });
```

(mesma alteração no segundo call site, o do atleta em inscrição por procuração — mesmos
parâmetros, mais `alertKey: "ORDER_CONFIRMED_PROXY_ATHLETE"` e `buyerName`.)

Acrescentar `link_patrocinio: order.event?.sponsorLink ?? ""` aos dois objetos `values`
já passados pra `sendWhatsAppIfActive` (comprador, linha ~142-147 atual, e atleta, linha
~188-194 atual):

```ts
      {
        nome_atleta: registration.proxyAthleteDisplayName ?? registration.athlete.name,
        nome_evento: order.event?.title ?? "",
        codigo_confirmacao: orderId,
        link_evento: detailsUrl,
        link_patrocinio: order.event?.sponsorLink ?? "",
      },
```

```ts
      {
        nome_atleta: registration.proxyAthleteDisplayName ?? registration.athlete.name,
        nome_comprador: order.buyer.name,
        nome_evento: order.event?.title ?? "",
        codigo_confirmacao: orderId,
        link_evento: detailsUrl,
        link_patrocinio: order.event?.sponsorLink ?? "",
      },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/lib-email.test.ts`
Expected: PASS (todos os testes do arquivo, incluindo os dois novos).

Run: `npx vitest run tests/whatsapp.test.ts tests/lib-advertiser-request-pending.test.ts`
Expected: PASS — garantir que nada relacionado a `sendWhatsAppMessage`/templates quebrou
(esses arquivos não testam `notifyOrderConfirmed` diretamente, mas cobrem o mecanismo de
template/`values` que este passo reutiliza).

- [ ] **Step 7: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 8: Commit**

```bash
git add lib/templates/registry.ts lib/email.ts lib/notifications.ts tests/lib-email.test.ts
git commit -m "feat: variavel link_patrocinio nos templates de confirmacao de inscricao"
```

---

### Task 3: UI de edição do evento

**Files:**
- Modify: `components/organizer/EditEventForm.tsx`
- Modify: `app/api/events/[id]/route.ts`
- Modify: `app/organizador/eventos/[id]/editar/page.tsx`

**Interfaces:**
- Consumes: `Event.sponsorLink` (Task 1).
- Produces: nada.

- [ ] **Step 1: Acrescentar o campo ao `select` da página de edição**

Em `app/organizador/eventos/[id]/editar/page.tsx`, o `select` do `db.event.findFirst`
tem hoje `city: true, state: true, maxParticipants: true, organizerContact: true,` —
acrescentar `sponsorLink: true` nessa mesma linha:

```ts
        city: true, state: true, maxParticipants: true, organizerContact: true, sponsorLink: true,
```

- [ ] **Step 2: Estender o schema, o tipo `EventData` e os valores padrão do formulário**

Em `components/organizer/EditEventForm.tsx`, no `schema` (zod), acrescentar depois de
`organizerContact: z.string().optional(),` (linha 21 atual):

```ts
  organizerContact: z.string().optional(),
  sponsorLink: z.string().optional(),
```

No tipo `EventData` (linha 55-81 atual), acrescentar depois de
`organizerContact?: string | null;`:

```ts
  organizerContact?: string | null;
  sponsorLink?: string | null;
```

Nos `defaultValues` do `useForm`, depois de
`organizerContact: event.organizerContact ?? "",` (linha 120 atual):

```ts
      organizerContact: event.organizerContact ?? "",
      sponsorLink: event.sponsorLink ?? "",
```

- [ ] **Step 3: Adicionar o campo no JSX**

Logo após o campo "Contato do organizador" (linhas 222-225 atuais):

```tsx
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contato do organizador</label>
          <input {...register("organizerContact")} className="input w-full" placeholder="email ou WhatsApp" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Link de patrocínio</label>
          <input {...register("sponsorLink")} className="input w-full" placeholder="Strava, página do patrocinador etc." />
        </div>
```

(`sponsorLink` já viaja no `body` do `onSubmit` via `...data` — não precisa de linha
extra ali, mesmo padrão de `organizerContact`, que também não é redeclarado no fetch.)

- [ ] **Step 4: Estender o schema da rota PATCH**

Em `app/api/events/[id]/route.ts`, no `updateEventSchema`, acrescentar depois de
`organizerContact: z.string().optional().nullable(),` (linha 18 atual):

```ts
  organizerContact: z.string().optional().nullable(),
  sponsorLink: z.string().optional().nullable(),
```

(Não precisa de linha condicional no `db.event.update` — `sponsorLink` é string simples,
passa direto pelo `...parsed.data`, mesmo padrão de `organizerContact`.)

- [ ] **Step 5: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Conferir visualmente no navegador**

Run: `npm run dev`, abrir `/organizador/eventos/<id>/editar`. Confirmar:
- O campo "Link de patrocínio" aparece perto de "Contato do organizador".
- Preencher um link, salvar, reabrir a página: o valor persiste.
- Abrir a edição de template de `ORDER_CONFIRMED` (Admin → Alertas → templates, ou
  equivalente do organizador) e confirmar que `{{link_patrocinio}}` aparece como
  variável disponível pra inserir no texto.

- [ ] **Step 7: Commit**

```bash
git add components/organizer/EditEventForm.tsx "app/api/events/[id]/route.ts" "app/organizador/eventos/[id]/editar/page.tsx"
git commit -m "feat: organizador cadastra link de patrocinio na edicao do evento"
```

---

## Self-Review Notes

- **Spec coverage:** campo novo (Task 1) ✓; variável disponível só nos 3 alertas de
  confirmação, resolve pra vazio quando ausente (Task 2) ✓; UI de edição (Task 3) ✓.
- **Placeholder scan:** nenhum "TBD"/"similar to Task N" — cada task tem o código
  completo, inclusive os testes.
- **Type consistency:** `sponsorLink?: string | null` usado de forma consistente em
  `EventData` (Task 3), no `select`/`update` do Prisma (Tasks 1/3) e no parâmetro de
  `sendRegistrationConfirmationEmail` (Task 2, `string | null | undefined` — aceita tanto
  o `null` do banco quanto `undefined` de chamadas que não passam o campo).
- **Risco de produção:** a única ação que toca o banco de produção (aplicar a migration)
  fica fora das tasks, igual ao padrão já estabelecido nas features anteriores.
