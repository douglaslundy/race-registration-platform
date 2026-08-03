# Migrar os 6 alertas restantes pra ler templates do banco Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Terminar o rollout incremental da Etapa 2 (central de alertas) — migrar os 6 alertas que
ainda usam texto hardcoded (`ADVERTISER_REQUEST_PENDING`, `CANCELLATION_REQUESTED`,
`RECONCILIATION_MISMATCH`, `DAILY_SUMMARY`, `PAYMENT_ERROR`/`PAYMENT_ERROR_ORDER_CANCELLED`,
`ORDER_CONFIRMED`/`PROXY_BUYER`/`PROXY_ATHLETE`) pra ler do sistema de templates já construído
(`lib/templates/resolve.ts`/`render.ts`/`registry.ts`), com zero regressão comportamental quando
não há template salvo no banco (fallback de fábrica).

**Architecture:** Mesma receita já usada e testada em `lib/alerts/low-stock.ts` e
`lib/alerts/abandoned-cart.ts` (Tasks 10/11 do plano anterior,
`docs/superpowers/plans/2026-08-03-central-alertas-templates.md`): cada call site troca a
string/template-literal hardcoded por `getEffectiveTemplate(alertKey, channel, recipientRole)` +
`renderTemplate`/`renderTemplateSubject`. Toda a infraestrutura (schema, motor de variáveis,
registry, resolver, admin UI/API) já existe e está em produção — este plano só troca a origem do
texto nos pontos de disparo restantes, sem tocar na infraestrutura.

**Duas exceções conscientes** (mesmo padrão de "simplificação divulgada" já usado e aprovado em
revisão pra `RECONCILIATION_MISMATCH`/`DAILY_SUMMARY` no plano anterior — a tabela/resumo
detalhado continua gerado pelo código, só o texto fixo ao redor vira editável):
- `RECONCILIATION_MISMATCH` EMAIL: só o subject + parágrafo de introdução são editáveis; a tabela
  HTML de divergências individuais continua montada em `lib/email.ts::sendReconciliationMismatchEmail`.
  WHATSAPP dessa mesma alerta **não** tem tabela (é uma frase só) — migra por completo.
- `DAILY_SUMMARY` EMAIL: só subject + introdução; a tabela de métricas continua em
  `lib/email.ts::sendDailySummaryEmail`. WHATSAPP desse alerta hoje é uma frase rica com 3-4
  métricas — a Task 16 abaixo **estende o registry** (novas variáveis) pra migrar de verdade, não
  deixa esse canal de fora.

**Tech Stack:** Next.js 16, Prisma 5, Vitest — mesmo stack do plano anterior.

## Global Constraints

- Reusa 100% a infraestrutura já existente — não recriar `lib/templates/*`. Só importar
  `getEffectiveTemplate`/`renderTemplate`/`renderTemplateSubject` (já existem e passaram por
  revisão completa).
- Subject de EMAIL sempre via `renderTemplateSubject` (nunca `renderTemplate(subject, ..., "EMAIL")`
  — é o bug real encontrado e corrigido na leva anterior, não reintroduzir).
- Quando não há template salvo no banco, o texto renderizado tem que ser byte-idêntico ao
  hardcoded atual — provar com um teste real (sem mockar `@/lib/templates/resolve` nem
  `@/lib/templates/render`), igual ao padrão já estabelecido em `tests/alert-low-stock.test.ts` e
  `tests/alert-abandoned-cart.test.ts`. Testes que mockam o motor de renderização pra "provar"
  zero-regressão já foram identificados como falso-positivo duas vezes nesta sessão — não repetir.
- Preservar 100% a lógica de dedupe/claim/unclaim/recordAlert/audit existente em cada arquivo — só
  a construção do texto muda.
- Toda variável nova que um `factoryDefault` passar a usar precisa: (a) existir em
  `lib/templates/variables.ts` com `sample` preenchido (senão a Etapa 2's teste
  `ALL_VARIABLES.every(v => v.sample)` falha), e (b) estar na lista `variables` do próprio
  `alertKey` no registry (senão o teste de auto-consistência do registry falha).
- Todo arquivo novo/modificado `.ts`: `npx tsc --noEmit` limpo.
- TDD: teste falhando primeiro, ver falhar, implementar, ver passar, commitar.

---

### Task 13: Migrar `ADVERTISER_REQUEST_PENDING`

**Files:**
- Modify: `lib/email.ts` (`sendAdvertiserRequestPendingEmail`)
- Modify: `lib/alerts/advertiser-request-pending.ts` (texto do WhatsApp, dentro de `notifyAdvertiserRequestPending`)
- Test: `tests/lib-email.test.ts` (novo `describe`), `tests/lib-advertiser-request-pending.test.ts` (teste de zero-regressão)

**Interfaces:**
- Consome: `getEffectiveTemplate("ADVERTISER_REQUEST_PENDING", channel, "ADMIN")`,
  `renderTemplate`/`renderTemplateSubject` (já existem).
- Variáveis já cobertas no registry: `nome_plataforma`, `empresa_anunciante`, `nome_plano`,
  `link_solicitacoes_pendentes` — **`link_solicitacoes_pendentes` precisa ser calculado no call
  site** (`${baseUrl}/admin/anunciantes/solicitacoes`, mesmo padrão de `link_finalizar_pagamento`
  em `abandoned-cart.ts`), não existe hoje fora da string hardcoded.

- [ ] **Step 1: Ler os 2 arquivos atuais antes de editar**

Ler `lib/email.ts`'s `sendAdvertiserRequestPendingEmail` (por volta da linha 357-376, mas confirme
a linha real) e `lib/alerts/advertiser-request-pending.ts` inteiro (72 linhas) — não editar
baseado em número de linha de memória.

- [ ] **Step 2: Escrever o teste de zero-regressão (falhando)**

Adicionar a `tests/lib-advertiser-request-pending.test.ts` (arquivo já existe, tem 4 casos — ler
primeiro pra ver o padrão de mock/fixture usado):

```ts
it("com o banco sem template salvo, o texto do WhatsApp é idêntico ao hardcoded anterior", async () => {
  // usar o mesmo fixture de purchase/admins já usado nos outros testes deste arquivo
  // NÃO mockar @/lib/templates/resolve nem @/lib/templates/render
  await notifyAdvertiserRequestPending("purchase-1");

  expect(sendWhatsAppMessage).toHaveBeenCalledWith(
    expect.any(String),
    'Nova solicitação de anunciante: Empresa Exemplo (plano Plano Básico). Acesse o painel pra aprovar ou rejeitar.',
  );
});
```//

Ajuste os valores literais (`Empresa Exemplo`/`Plano Básico`) pros que o fixture real do arquivo
já usa — ler o arquivo primeiro, não inventar.

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx vitest run tests/lib-advertiser-request-pending.test.ts`
Expected: FAIL (código ainda não usa o resolver).

- [ ] **Step 4: Migrar `sendAdvertiserRequestPendingEmail` em `lib/email.ts`**

Adicionar import `getEffectiveTemplate`/`renderTemplate`/`renderTemplateSubject` (mesmo padrão de
`sendLowStockEmail`). Substituir o corpo por:

```ts
export async function sendAdvertiserRequestPendingEmail(params: {
  to: string;
  companyName: string;
  planName: string;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const values = {
    nome_plataforma: appName,
    empresa_anunciante: params.companyName,
    nome_plano: params.planName,
    link_solicitacoes_pendentes: `${baseUrl}/admin/anunciantes/solicitacoes`,
  };
  const template = await getEffectiveTemplate("ADVERTISER_REQUEST_PENDING", "EMAIL", "ADMIN");
  const subject = renderTemplateSubject(template.subject ?? "", values);
  const body = renderTemplate(template.body, values, "EMAIL");
  await sendMail({ to: params.to, subject, html: layout(appName, body) });
}
```

- [ ] **Step 5: Migrar o WhatsApp em `lib/alerts/advertiser-request-pending.ts`**

Adicionar imports `getEffectiveTemplate`/`renderTemplate`. Substituir o `await sendWhatsAppMessage(...)`
dentro do bloco `if (settings.whatsappEnabled)`:

```ts
        try {
          const template = await getEffectiveTemplate("ADVERTISER_REQUEST_PENDING", "WHATSAPP", "ADMIN");
          const text = renderTemplate(template.body, {
            empresa_anunciante: purchase.advertiser.companyName,
            nome_plano: purchase.adPlan.name,
          }, "WHATSAPP");
          await sendWhatsAppMessage(admin.phone, text);
        } catch (err) {
```

(manter o `catch` e o resto do bloco exatamente como está — só as 2 linhas de construção da
mensagem mudam.)

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npx vitest run tests/lib-advertiser-request-pending.test.ts tests/lib-email.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: limpo.

- [ ] **Step 7: Commit**

```bash
git add lib/email.ts lib/alerts/advertiser-request-pending.ts tests/lib-advertiser-request-pending.test.ts tests/lib-email.test.ts
git commit -m "feat: ADVERTISER_REQUEST_PENDING passa a ler template do banco (3º alerta migrado)"
```

---

### Task 14: Migrar `CANCELLATION_REQUESTED`

**Files:**
- Modify: `lib/email.ts` (`sendCancellationRequestedEmail`)
- Modify: `lib/alerts/cancellation-requested.ts` (texto do WhatsApp)
- Test: `tests/lib-email.test.ts`, teste de zero-regressão no arquivo de teste existente do módulo
  (localizar via `find`/grep por `notifyCancellationRequested` em `tests/` antes de escrever —
  pode já existir um arquivo dedicado).

**Interfaces:**
- `getEffectiveTemplate("CANCELLATION_REQUESTED", channel, recipientRole)` — **atenção**: o
  registry declara `recipientRoles: ["ADMIN", "ORGANIZER"]`, mas o código de
  `notifyCancellationRequested` trata os dois com o MESMO texto hoje (não distingue admin de
  organizador na mensagem). Resolver como `recipientRole: "ADMIN"` pra ambos por simplicidade
  **é uma decisão a confirmar antes de implementar** (ver Step 1) — resolver por destinatário real
  (`ADMIN` pros admins, `ORGANIZER` pro organizador) permite customização futura separada, mas
  precisa de 2 chamadas de `getEffectiveTemplate` por canal em vez de 1 (uma vez por loop de
  destinatário, recalculando `recipientRole` conforme quem é o destinatário atual).

- [ ] **Step 1: Ler o arquivo e decidir o resolver por destinatário**

Ler `lib/alerts/cancellation-requested.ts` inteiro (confirmar contra o conteúdo real, não a cópia
citada no §Interfaces acima). Implementar resolvendo `recipientRole` por destinatário real dentro
do loop `for (const recipient of recipients)` — compare `recipient` contra `registration.event.organizer.user`
(mesma referência de objeto usada na montagem de `recipients`) pra decidir `"ORGANIZER"` vs
`"ADMIN"`. Isso preserva a possibilidade de customização futura por papel sem mudar o texto de
fábrica hoje (que é idêntico pros dois — `variables: ["nome_atleta", "nome_evento", "motivo_cancelamento"]`
já cobre ambos igualmente).

- [ ] **Step 2: Escrever o teste de zero-regressão (falhando)**

No arquivo de teste existente (localizar primeiro), adicionar um teste que — sem mockar
`@/lib/templates/resolve`/`render` — chama `notifyCancellationRequested` e afirma que
`sendWhatsAppMessage` foi chamado com o texto exato:
`` `${athleteName} solicitou o cancelamento da inscrição em "${eventTitle}". Motivo: ${reason}. Acesse o painel para aprovar ou rejeitar.` ``
usando os valores do fixture já existente no arquivo.

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx vitest run <arquivo de teste>` — FAIL esperado.

- [ ] **Step 4: Migrar `sendCancellationRequestedEmail` em `lib/email.ts`**

Mesmo padrão das tasks anteriores — receber `recipientRole` como novo parâmetro da função (ou
inferir de um novo param `role: "ADMIN" | "ORGANIZER"`):

```ts
export async function sendCancellationRequestedEmail(params: {
  to: string;
  athleteName: string;
  eventTitle?: string;
  reason: string;
  recipientRole: "ADMIN" | "ORGANIZER";
}): Promise<void> {
  const appName = await getAppName();
  const values = {
    nome_atleta: params.athleteName,
    nome_evento: params.eventTitle ?? "",
    motivo_cancelamento: params.reason,
  };
  const template = await getEffectiveTemplate("CANCELLATION_REQUESTED", "EMAIL", params.recipientRole);
  const subject = renderTemplateSubject(template.subject ?? "", values);
  const body = renderTemplate(template.body, values, "EMAIL");
  await sendMail({ to: params.to, subject, html: layout(appName, body) });
}
```

Atualizar a assinatura em `lib/alerts/cancellation-requested.ts` pra passar `recipientRole`
(calculado no Step 1) em cada chamada de `sendCancellationRequestedEmail`.

- [ ] **Step 5: Migrar o WhatsApp**

Mesma lógica de `recipientRole` por destinatário, chamando `getEffectiveTemplate("CANCELLATION_REQUESTED", "WHATSAPP", recipientRole)`
e `renderTemplate(template.body, { nome_atleta: registration.athlete.name, nome_evento: registration.event.title, motivo_cancelamento: reason }, "WHATSAPP")`
no lugar da template string atual.

- [ ] **Step 6: Rodar e confirmar que passa; Step 7: `tsc --noEmit`; Step 8: Commit**

```bash
git add lib/email.ts lib/alerts/cancellation-requested.ts <arquivo de teste>
git commit -m "feat: CANCELLATION_REQUESTED passa a ler template do banco (4º alerta migrado)"
```

---

### Task 15: Migrar `RECONCILIATION_MISMATCH`

**Files:**
- Modify: `lib/email.ts` (`sendReconciliationMismatchEmail`)
- Modify: `lib/alerts/reconciliation.ts` (texto do WhatsApp, dentro de `notifyReconciliationMismatches`)
- Test: `tests/lib-email.test.ts`, arquivo de teste de `notifyReconciliationMismatches` (localizar
  via grep)

**Interfaces:**
- `variables` do registry: `["total_divergencias", "divergencias_corrigidas", "divergencias_manuais"]`.
- **Só subject + introdução do EMAIL são migrados** (decisão já registrada no registry — a tabela
  de divergências individuais continua montada em código, fora do escopo de variáveis). WHATSAPP
  migra por completo (não tem tabela, é uma frase só, já cabe 100% no registry).

- [ ] **Step 1: Ler os 2 arquivos atuais**

`lib/email.ts::sendReconciliationMismatchEmail` e `lib/alerts/reconciliation.ts` inteiro — já
lidos nesta sessão (conteúdo real confirmado), mas releia antes de editar pra garantir que
nenhuma outra mudança aconteceu.

- [ ] **Step 2: Escrever o teste de zero-regressão (falhando) pro WhatsApp**

No arquivo de teste de `notifyReconciliationMismatches` (grep primeiro), adicionar um teste sem
mockar `@/lib/templates/resolve`/`render` afirmando que `sendWhatsAppMessage` foi chamado com:
`` `Conciliação de pagamentos: ${correctedCount} corrigida(s) automaticamente, ${manualCount} precisam de revisão manual. Acesse /admin/conciliacao para detalhes.` ``
usando os valores do fixture existente.

- [ ] **Step 3: Rodar e confirmar que falha**

- [ ] **Step 4: Migrar `sendReconciliationMismatchEmail` — só subject + intro**

```ts
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
  const rows = params.mismatches
    .map(
      (m) =>
        `<tr><td>${m.eventTitle}</td><td>${m.orderId}</td><td>${m.localStatus}</td><td>${m.gatewayStatus}</td><td>${m.corrected ? "Corrigido automaticamente" : "Requer verificação manual"}</td></tr>`,
    )
    .join("");
  const template = await getEffectiveTemplate("RECONCILIATION_MISMATCH", "EMAIL", "ADMIN");
  const subject = renderTemplateSubject(template.subject ?? "", values);
  const intro = renderTemplate(template.body, values, "EMAIL");
  await sendMail({
    to: params.to,
    subject,
    html: layout(
      appName,
      `${intro}\n` +
        `<table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">\n` +
        `  <thead><tr><th>Evento</th><th>Pedido</th><th>Status local</th><th>Status no gateway</th><th>Situação</th></tr></thead>\n` +
        `  <tbody>${rows}</tbody>\n` +
        `</table>`,
    ),
  });
}
```

Note: o `intro` renderizado já contém os 2 parágrafos do registry (a introdução + o parágrafo
"Divergências marcadas como... precisam de revisão"); a tabela é concatenada depois, entre eles —
confirme visualmente que a ordem final bate com o HTML original (introdução, tabela, aviso) e
ajuste a concatenação se o registry colocar o aviso *depois* do que seria a posição da tabela (ler
`lib/templates/registry.ts`'s `RECONCILIATION_MISMATCH.factoryDefault` pra confirmar a ordem exata
dos 2 parágrafos antes de decidir onde a tabela entra no meio).

- [ ] **Step 5: Migrar o WhatsApp em `lib/alerts/reconciliation.ts`**

Substituir a chamada de `sendWhatsAppMessage` dentro do loop de admins:

```ts
        try {
          const template = await getEffectiveTemplate("RECONCILIATION_MISMATCH", "WHATSAPP", "ADMIN");
          const text = renderTemplate(template.body, {
            divergencias_corrigidas: String(correctedCount),
            divergencias_manuais: String(manualCount),
          }, "WHATSAPP");
          await sendWhatsAppMessage(admin.phone, text);
        } catch (err) {
```

- [ ] **Step 6: Rodar e confirmar; Step 7: `tsc --noEmit`; Step 8: Commit**

```bash
git add lib/email.ts lib/alerts/reconciliation.ts <arquivo de teste>
git commit -m "feat: RECONCILIATION_MISMATCH passa a ler template do banco (5º alerta migrado)"
```

---

### Task 16: Migrar `DAILY_SUMMARY` (estende o registry pro WhatsApp)

**Files:**
- Modify: `lib/templates/variables.ts` (novas variáveis pro WhatsApp de resumo diário)
- Modify: `lib/templates/registry.ts` (`DAILY_SUMMARY.variables` + `factoryDefault` do WHATSAPP)
- Modify: `lib/email.ts` (`sendDailySummaryEmail`)
- Modify: `lib/alerts/daily-summary.ts` (`buildAdminWhatsAppText`/`buildOrganizerWhatsAppText`)
- Test: `tests/templates-registry.test.ts` (roda automaticamente contra as novas entradas — não
  precisa de caso novo, só confirmar que continua passando), `tests/lib-email.test.ts`, arquivo de
  teste de `daily-summary` (grep primeiro)

**Contexto:** diferente dos outros 5, o WhatsApp de `DAILY_SUMMARY` hoje é uma frase rica com 3-4
métricas (`buildAdminWhatsAppText`/`buildOrganizerWhatsAppText` em `lib/alerts/daily-summary.ts`),
não cabendo no registry atual (`variables: ["data_resumo", "papel_destinatario"]`, pensado só pro
EMAIL). Esta task estende o catálogo pra cobrir o WhatsApp de verdade, em vez de deixar essa
combinação permanentemente hardcoded.

- [ ] **Step 1: Ler `lib/alerts/daily-summary.ts` inteiro**

Já lido nesta sessão (271 linhas, conteúdo confirmado) — releia antes de editar. Note que ADMIN e
ORGANIZER têm frases WhatsApp com métricas diferentes (admin: inscrições pagas, receita bruta,
novos usuários, eventos criados; organizador: inscrições pagas, receita, cupons usados) — ambos
compartilham o `alertKey` `DAILY_SUMMARY` mas com `recipientRole` diferente (`ADMIN` vs
`ORGANIZER`), então podem ter linhas de banco/textos de fábrica **distintos** por papel (o
registry já suporta isso — `factoryDefault(channel, recipientRole)` recebe o papel).

- [ ] **Step 2: Adicionar as 5 variáveis novas em `lib/templates/variables.ts`**

```ts
  { name: "total_inscricoes_pagas", label: "Inscrições pagas no dia", category: "Plataforma", description: "Contagem de inscrições pagas no resumo diário. Só disponível no alerta de resumo diário." },
  { name: "receita_periodo", label: "Receita do período", category: "Plataforma", description: "Receita bruta (admin) ou receita do organizador no resumo diário, formatada em R$. Só disponível no alerta de resumo diário." },
  { name: "novos_usuarios", label: "Novos usuários", category: "Plataforma", description: "Contagem de novos usuários cadastrados no dia. Só disponível no resumo diário do administrador." },
  { name: "eventos_criados", label: "Eventos criados", category: "Plataforma", description: "Contagem de eventos criados no dia. Só disponível no resumo diário do administrador." },
  { name: "cupons_usados", label: "Cupons usados", category: "Plataforma", description: "Contagem de cupons usados no dia. Só disponível no resumo diário do organizador." },
```

Adicionar `sample` pra cada uma seguindo o padrão já usado nas outras entradas (ex.:
`total_inscricoes_pagas: "12"`, `receita_periodo: "R$ 1.850,00"`, `novos_usuarios: "5"`,
`eventos_criados: "2"`, `cupons_usados: "3"` — no objeto `sample` de cada `VariableDefinition`,
confirme o nome exato do campo `sample` lendo `lib/templates/variables.ts` primeiro, já que foi
adicionado numa fix round anterior e pode não estar exatamente como descrito aqui).

- [ ] **Step 3: Atualizar `DAILY_SUMMARY` no registry**

```ts
  DAILY_SUMMARY: {
    alertKey: "DAILY_SUMMARY",
    description: "Resumo diário — subject e introdução do e-mail são editáveis (tabela de métricas continua gerada pelo código); o WhatsApp é totalmente editável.",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["ADMIN", "ORGANIZER"],
    variables: ["data_resumo", "papel_destinatario", "total_inscricoes_pagas", "receita_periodo", "novos_usuarios", "eventos_criados", "cupons_usados"],
    factoryDefault: (channel, recipientRole) => {
      if (channel === "EMAIL") {
        return { subject: "Resumo diário — {{data_resumo}}", body: `<p>Olá,</p>\n<p>Este é o resumo de atividade do dia <strong>{{data_resumo}}</strong> (visão de {{papel_destinatario}}):</p>` };
      }
      return recipientRole === "ORGANIZER"
        ? { body: `Resumo de ontem: {{total_inscricoes_pagas}} inscrições pagas, {{receita_periodo}} em receita, {{cupons_usados}} cupons usados. Veja mais em {{link_plataforma}}/organizador.` }
        : { body: `Resumo de ontem: {{total_inscricoes_pagas}} inscrições pagas, {{receita_periodo}} em receita bruta, {{novos_usuarios}} novos usuários, {{eventos_criados}} eventos criados. Veja mais em {{link_plataforma}}/admin.` };
    },
  },
```

Rode `npx vitest run tests/templates-registry.test.ts` — o teste de auto-consistência
(`validateTemplateVariables aceita o corpo de fábrica de todo alerta/canal/papel declarado`) vai
falhar se algum `{{var}}` usado acima não estiver na lista `variables` — é esperado servir como
checagem, não precisa escrever teste novo pra isso.

- [ ] **Step 4: Escrever os testes de zero-regressão (falhando) pro WhatsApp admin e organizador**

No arquivo de teste de `daily-summary` (grep primeiro pelo nome exato), adicionar 2 testes (sem
mockar `@/lib/templates/resolve`/`render`) confirmando que `sendWhatsAppMessage` recebe o texto
exato hoje hardcoded, usando os fixtures de métrica já existentes no arquivo.

- [ ] **Step 5: Rodar e confirmar que falham**

- [ ] **Step 6: Migrar `sendDailySummaryEmail` em `lib/email.ts` — só subject + intro**

```ts
export async function sendDailySummaryEmail(params: {
  to: string;
  role: "ADMIN" | "ORGANIZER";
  dateLabel: string;
  rows: { label: string; value: string }[];
}): Promise<void> {
  const appName = await getAppName();
  const roleLabel = params.role === "ADMIN" ? "administrador" : "organizador";
  const values = { data_resumo: params.dateLabel, papel_destinatario: roleLabel };
  const tableRows = params.rows
    .map((r) => `<tr><td style="padding:4px 8px">${r.label}</td><td style="padding:4px 8px;font-weight:bold">${r.value}</td></tr>`)
    .join("");
  const template = await getEffectiveTemplate("DAILY_SUMMARY", "EMAIL", params.role);
  const subject = renderTemplateSubject(template.subject ?? "", values);
  const intro = renderTemplate(template.body, values, "EMAIL");
  await sendMail({
    to: params.to,
    subject,
    html: layout(
      appName,
      `${intro}\n<table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">\n<tbody>${tableRows}</tbody>\n</table>`,
    ),
  });
}
```

- [ ] **Step 7: Migrar `buildAdminWhatsAppText`/`buildOrganizerWhatsAppText` em `lib/alerts/daily-summary.ts`**

Ambas viram `async` (chamam o resolver) e passam a receber `link_plataforma` calculado, mantendo a
mesma assinatura de retorno (`Promise<string>` em vez de `string`) — **atualize os 4 call sites**
(`sendAdminDailySummaries` chama `buildAdminWhatsAppText` 2x, `sendOrganizerDailySummaries` chama
`buildOrganizerWhatsAppText` 2x — todas dentro de `await sendWhatsAppMessage(phone, ...)`) pra
`await`arem a nova versão async:

```ts
async function buildAdminWhatsAppText(m: AdminDailySummary): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const template = await getEffectiveTemplate("DAILY_SUMMARY", "WHATSAPP", "ADMIN");
  return renderTemplate(template.body, {
    total_inscricoes_pagas: String(m.paidRegistrationsCount),
    receita_periodo: formatCurrency(m.grossRevenue),
    novos_usuarios: String(m.newUsersCount),
    eventos_criados: String(m.eventsCreatedCount),
    link_plataforma: baseUrl,
  }, "WHATSAPP");
}

async function buildOrganizerWhatsAppText(m: OrganizerDailySummary): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const template = await getEffectiveTemplate("DAILY_SUMMARY", "WHATSAPP", "ORGANIZER");
  return renderTemplate(template.body, {
    total_inscricoes_pagas: String(m.paidRegistrationsCount),
    receita_periodo: formatCurrency(m.grossRevenue),
    cupons_usados: String(m.couponsUsedCount),
    link_plataforma: baseUrl,
  }, "WHATSAPP");
}
```

Atualize os 4 call sites pra `await sendWhatsAppMessage(phone, await buildAdminWhatsAppText(metrics))`
(idem pro organizador) — releia o arquivo depois da Task 1 pra ter certeza dos números de linha
atuais antes de editar cada um.

- [ ] **Step 8: Rodar e confirmar que passa; Step 9: `tsc --noEmit`; Step 10: Commit**

```bash
git add lib/templates/variables.ts lib/templates/registry.ts lib/email.ts lib/alerts/daily-summary.ts <arquivo de teste>
git commit -m "feat: DAILY_SUMMARY passa a ler template do banco, inclui WhatsApp (6º alerta migrado)"
```

---

### Task 17: Migrar `PAYMENT_ERROR` + `PAYMENT_ERROR_ORDER_CANCELLED`

**Files:**
- Modify: `lib/email.ts` (`sendPaymentErrorEmail`)
- Modify: `lib/alerts/payment-error.ts` (`sendCancellationInviteNotification`, `notifyPaymentError`,
  `notifyOrderCancelledWithoutPayment`)
- Test: `tests/lib-email.test.ts`, `tests/alert-payment-error.test.ts` (já existe, tem casos pros
  dois fluxos — ler primeiro)

**Interfaces:**
- `notifyPaymentError` dispara com `alertKey: "PAYMENT_ERROR"`, `notifyOrderCancelledWithoutPayment`
  dispara com `alertKey: "PAYMENT_ERROR_ORDER_CANCELLED"` — os dois fluxos passam pelo MESMO
  helper compartilhado (`sendCancellationInviteNotification`), que precisa saber qual dos dois
  usar. Hoje ambos produzem texto idêntico (o registry já reflete isso —
  `PAYMENT_ERROR_ORDER_CANCELLED.factoryDefault` delega pro `PAYMENT_ERROR`), mas resolver por
  `alertKey` correto permite customização futura independente entre "cancelamento automático por
  pagamento recusado" e "cancelamento manual sem pagamento associado", que são situações
  diferentes pro usuário mesmo com o texto de fábrica igual hoje.

- [ ] **Step 1: Ler `lib/alerts/payment-error.ts` inteiro (confirmar contra o arquivo real)**

- [ ] **Step 2: Adicionar `alertKey` a `CancellationNotificationTarget`**

```ts
interface CancellationNotificationTarget {
  entityId: string;
  entityType: "Payment" | "Order";
  alertKey: "PAYMENT_ERROR" | "PAYMENT_ERROR_ORDER_CANCELLED";
  buyer: { name: string; email: string; athleteProfile: { phone: string | null } | null };
  event: { title: string; slug: string };
  bypassDedupe?: boolean;
}
```

`notifyPaymentError` passa `alertKey: "PAYMENT_ERROR"` na chamada de `sendCancellationInviteNotification`;
`notifyOrderCancelledWithoutPayment` passa `alertKey: "PAYMENT_ERROR_ORDER_CANCELLED"`. **Não muda**
o `ALERT_TYPE` constante usado pro dedupe (`claimAlert`/`unclaimAlert`/`recordAlert`) — esse
continua `"PAYMENT_ERROR"` fixo pros dois fluxos, é um namespace diferente do `alertKey` de
template, sem relação.

- [ ] **Step 3: Escrever os testes de zero-regressão (falhando)**

Em `tests/alert-payment-error.test.ts`, adicionar (sem mockar `@/lib/templates/resolve`/`render`)
1 teste pro WhatsApp de `notifyPaymentError` e 1 pro de `notifyOrderCancelledWithoutPayment`,
afirmando o texto exato:
`` `Sua inscrição em "${eventTitle}" foi cancelada porque não identificamos o pagamento. Não fique de fora — faça agora mesmo uma nova inscrição e venha participar conosco: ${eventUrl}` ``
(`eventUrl` = `${baseUrl}/eventos/${eventSlug}`, mesma fórmula de hoje).

- [ ] **Step 4: Rodar e confirmar que falham**

- [ ] **Step 5: Migrar `sendPaymentErrorEmail` em `lib/email.ts`**

```ts
export async function sendPaymentErrorEmail(params: {
  to: string;
  name: string;
  eventTitle: string;
  eventSlug: string;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const values = {
    nome_atleta: params.name,
    nome_evento: params.eventTitle,
    link_evento: `${baseUrl}/eventos/${params.eventSlug}`,
  };
  const template = await getEffectiveTemplate("PAYMENT_ERROR", "EMAIL", "BUYER");
  const subject = renderTemplateSubject(template.subject ?? "", values);
  const body = renderTemplate(template.body, values, "EMAIL");
  await sendMail({ to: params.to, subject, html: layout(appName, body) });
}
```

(Nota: `sendPaymentErrorEmail` sempre resolve `alertKey: "PAYMENT_ERROR"` mesmo quando chamada
pelo fluxo de `notifyOrderCancelledWithoutPayment` — o EMAIL não tem uma versão
`PAYMENT_ERROR_ORDER_CANCELLED` separada porque a função não recebe esse contexto hoje. Se quiser
paridade completa com o WhatsApp, adicione um parâmetro `alertKey` opcional aqui também — decisão
de escopo: fazer isso SE o tempo permitir, senão registrar como pendência menor no relatório final,
já que o texto de fábrica é idêntico de qualquer forma.)

- [ ] **Step 6: Migrar `sendCancellationInviteNotification` (WhatsApp) em `lib/alerts/payment-error.ts`**

```ts
      try {
        const template = await getEffectiveTemplate(params.alertKey, "WHATSAPP", "BUYER");
        const text = renderTemplate(template.body, {
          nome_evento: params.event.title,
          link_evento: eventUrl,
        }, "WHATSAPP");
        await sendWhatsAppMessage(params.buyer.athleteProfile.phone, text);
        if (params.bypassDedupe) await recordAlert(ALERT_TYPE, params.entityType, params.entityId, "WHATSAPP");
      } catch (err) {
```

- [ ] **Step 7: Rodar e confirmar que passa; Step 8: `tsc --noEmit`; Step 9: Commit**

```bash
git add lib/email.ts lib/alerts/payment-error.ts tests/alert-payment-error.test.ts
git commit -m "feat: PAYMENT_ERROR e PAYMENT_ERROR_ORDER_CANCELLED passam a ler template do banco (7º alerta migrado)"
```

---

### Task 18: Migrar `ORDER_CONFIRMED` + `ORDER_CONFIRMED_PROXY_BUYER` + `ORDER_CONFIRMED_PROXY_ATHLETE`

**O mais sensível dos 6** — `lib/notifications.ts` já teve 2 rodadas de correção nesta sessão por
bugs reais de mensagem duplicada em inscrição por procuração (ver
`.superpowers/audits/proxy-registration-duplicate-message-investigation-2026-07-28.md` se quiser o
histórico completo). Migrar com cuidado extra — preservar a lógica de dedupe por canal/destinatário
exatamente como está, só trocar a construção do texto.

**Files:**
- Modify: `lib/email.ts` (`sendRegistrationConfirmationEmail`)
- Modify: `lib/notifications.ts` (`notifyOrderConfirmed`, `sendWhatsAppIfActive`)
- Test: `tests/lib-email.test.ts`, `tests/notifications.test.ts` (já existe, extenso — ler os
  testes existentes primeiro pra não quebrar nenhuma asserção sobre dedupe/claim)

**Mapeamento alertKey × canal × cenário (já fechado no registry, só implementar):**

| Cenário | Canal | alertKey | recipientRole |
|---|---|---|---|
| Comprador confirma a própria inscrição | EMAIL | `ORDER_CONFIRMED` | `BUYER` |
| Comprador confirma a própria inscrição | WHATSAPP | `ORDER_CONFIRMED` | `BUYER` |
| Comprador inscreveu outra pessoa (procuração) | EMAIL | `ORDER_CONFIRMED` (**mesmo texto**, sem variante) | `BUYER` |
| Comprador inscreveu outra pessoa (procuração) | WHATSAPP | `ORDER_CONFIRMED_PROXY_BUYER` | `BUYER` |
| Atleta convidado por procuração | EMAIL | `ORDER_CONFIRMED_PROXY_ATHLETE` | `ATHLETE` |
| Atleta convidado por procuração | WHATSAPP | `ORDER_CONFIRMED_PROXY_ATHLETE` | `ATHLETE` |

(Confirmado contra `lib/notifications.ts` real: o EMAIL do comprador nunca varia com
`isProxyRegistration` — só o WHATSAPP do comprador varia. Não inventar uma variante de EMAIL pro
comprador-procuração que não existe hoje.)

- [ ] **Step 1: Ler `lib/notifications.ts` e `lib/email.ts::sendRegistrationConfirmationEmail` inteiros**

Confirmar contra o arquivo real antes de editar — este é o arquivo mais editado desta sessão,
números de linha certamente mudaram desde a última leitura registrada neste plano.

- [ ] **Step 2: Escrever os testes de zero-regressão (falhando)**

Em `tests/notifications.test.ts`, adicionar (sem mockar `@/lib/templates/resolve`/`render`) 3
testes cobrindo o WhatsApp dos 3 cenários da tabela acima (comprador não-procuração, comprador
procuração, atleta procuração), afirmando o texto exato hoje hardcoded, usando o `orderFixture` já
existente no arquivo. Em `tests/lib-email.test.ts`, 1 teste pra `sendRegistrationConfirmationEmail`
com o `alertKey`/`recipientRole` corretos.

- [ ] **Step 3: Rodar e confirmar que falham**

- [ ] **Step 4: Migrar `sendRegistrationConfirmationEmail` em `lib/email.ts`**

Adicionar `alertKey: "ORDER_CONFIRMED" | "ORDER_CONFIRMED_PROXY_ATHLETE"` e
`recipientRole: "BUYER" | "ATHLETE"` aos parâmetros da função:

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
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const url = `${baseUrl}/dashboard/inscricoes/${params.registrationId}`;
  const values = {
    nome_atleta: params.name,
    nome_evento: params.eventTitle ?? "",
    codigo_confirmacao: params.orderId,
    link_evento: url,
  };
  const template = await getEffectiveTemplate(params.alertKey, "EMAIL", params.recipientRole);
  const subject = renderTemplateSubject(template.subject ?? "", values);
  const body = renderTemplate(template.body, values, "EMAIL");
  await sendMail({
    to: params.to,
    subject,
    html: layout(appName, body),
    ...(params.eventId ? { relatedEntityType: "Event", relatedEntityId: params.eventId } : {}),
  });
}
```

**Atenção**: o parâmetro `notes` deixa de ser usado no corpo renderizado (o registry já documenta
essa limitação conhecida — motor de renderização não suporta blocos condicionais). Mantenha o
parâmetro na assinatura (não quebrar os call sites que ainda passam `notes`), mas não o use na
montagem do `body` — é uma limitação já aceita e documentada, não um bug novo a introduzir
silenciosamente (já está declarado assim na `description` do `ORDER_CONFIRMED` no registry).

- [ ] **Step 5: Atualizar os 2 call sites de `sendRegistrationConfirmationEmail` em `lib/notifications.ts`**

Comprador (sempre `alertKey: "ORDER_CONFIRMED"`, `recipientRole: "BUYER"`, independente de
`isProxyRegistration`):

```ts
          await sendRegistrationConfirmationEmail({
            to: order.buyer.email,
            name: order.buyer.name,
            registrationId: registration.id,
            orderId,
            eventTitle: order.event?.title,
            eventId: order.event?.id,
            notes: registration.notes ?? undefined,
            alertKey: "ORDER_CONFIRMED",
            recipientRole: "BUYER",
          });
```

Atleta (só quando `isProxyRegistration`, `alertKey: "ORDER_CONFIRMED_PROXY_ATHLETE"`,
`recipientRole: "ATHLETE"`):

```ts
            await sendRegistrationConfirmationEmail({
              to: registration.athlete.email,
              name: registration.athlete.name,
              registrationId: registration.id,
              orderId,
              eventTitle: order.event?.title,
              eventId: order.event?.id,
              notes: registration.notes ?? undefined,
              alertKey: "ORDER_CONFIRMED_PROXY_ATHLETE",
              recipientRole: "ATHLETE",
            });
```

- [ ] **Step 6: Migrar o WhatsApp — `sendWhatsAppIfActive` ganha `alertKey`/`recipientRole`**

`sendWhatsAppIfActive` hoje recebe `text` já pronto; passa a receber `alertKey`+`recipientRole`+
`values` e montar o texto internamente:

```ts
async function sendWhatsAppIfActive(
  phone: string | null | undefined,
  alertKey: "ORDER_CONFIRMED" | "ORDER_CONFIRMED_PROXY_BUYER" | "ORDER_CONFIRMED_PROXY_ATHLETE",
  values: Record<string, string | undefined>,
  eventId: string | undefined,
  claimEntityId: string,
  bypassDedupe: boolean,
): Promise<void> {
  if (!phone) return;
  let claimed = false;
  try {
    if (!(await isWhatsAppConnectionActive())) return;
    claimed = bypassDedupe ? true : await claimAlert(ALERT_TYPE, "Order", claimEntityId, "WHATSAPP");
    if (!claimed) return;
    const template = await getEffectiveTemplate(alertKey, "WHATSAPP", "BUYER");
    const text = renderTemplate(template.body, values, "WHATSAPP");
    await sendWhatsAppMessage(
      phone,
      text,
      eventId ? { relatedEntityType: "Event", relatedEntityId: eventId } : undefined,
    );
    if (bypassDedupe) await recordAlert(ALERT_TYPE, "Order", claimEntityId, "WHATSAPP");
  } catch (err) {
    if (claimed && !bypassDedupe) await unclaimAlert(ALERT_TYPE, claimEntityId, "WHATSAPP");
    console.error("[notifyOrderConfirmed] whatsapp failed:", err);
  }
}
```

(nota: `recipientRole` passado fixo como `"BUYER"` na chamada de `getEffectiveTemplate` dentro da
função é **errado** pro caso do atleta — ajuste pra receber `recipientRole` como parâmetro também,
já que a função é reusada pros 2 casos (comprador e atleta). Adicione `recipientRole: "BUYER" |
"ATHLETE"` como mais um parâmetro da função e repasse pro `getEffectiveTemplate`.)

Os 2 call sites em `notifyOrderConfirmed` passam a montar `values` em vez de `text`:

```ts
    const buyerWhatsappAlertKey = isProxyRegistration ? "ORDER_CONFIRMED_PROXY_BUYER" : "ORDER_CONFIRMED";
    const buyerWhatsappPhone = isProxyRegistration
      ? order.buyer.athleteProfile?.phone
      : registration.athlete.athleteProfile?.phone;
    await sendWhatsAppIfActive(buyerWhatsappPhone, buyerWhatsappAlertKey, "BUYER", {
      nome_atleta: registration.proxyAthleteDisplayName ?? registration.athlete.name,
      nome_evento: order.event?.title ?? "",
      codigo_confirmacao: orderId,
      link_evento: detailsUrl,
    }, order.event?.id, `${orderId}:buyer`, bypassDedupe);
```

(ajuste a ordem dos parâmetros posicionais conforme a assinatura final decidida no Step 6 acima —
mantenha consistente entre definição e as 2 chamadas.)

```ts
    await sendWhatsAppIfActive(
      registration.athlete.athleteProfile?.phone,
      "ORDER_CONFIRMED_PROXY_ATHLETE",
      "ATHLETE",
      {
        nome_comprador: order.buyer.name,
        nome_evento: order.event?.title ?? "",
        codigo_confirmacao: orderId,
        link_evento: detailsUrl,
      },
      order.event?.id,
      `${orderId}:athlete`,
      bypassDedupe,
    );
```

- [ ] **Step 7: Rodar e confirmar que passa**

Run: `npx vitest run tests/notifications.test.ts tests/lib-email.test.ts`
Expected: PASS — **preste atenção especial** aos testes já existentes de dedupe/claim/procuração
nesse arquivo, que não podem quebrar (a lógica de claim/unclaim/recordAlert não muda, só o texto).

- [ ] **Step 8: `tsc --noEmit`**

- [ ] **Step 9: Rodar a suite completa** (não só os arquivos deste alerta — este é o mais arriscado
  dos 6, vale confirmar que nada mais quebrou)

Run: `npx vitest run`
Expected: 100% verde.

- [ ] **Step 10: Commit**

```bash
git add lib/email.ts lib/notifications.ts tests/notifications.test.ts tests/lib-email.test.ts
git commit -m "feat: ORDER_CONFIRMED (+ variantes de procuração) passa a ler template do banco (8º e último alerta migrado)"
```

---

### Task 19: Verificação final + atualizar `IMPLEMENTATION_PLAN.md`

**Files:**
- Modify: `IMPLEMENTATION_PLAN.md`

- [ ] **Step 1: Suite completa, tsc, build**

Run: `npx vitest run` — 100% verde.
Run: `npx tsc --noEmit` — limpo.
Run: `npm run build` — limpo.

- [ ] **Step 2: Seed contra produção — NÃO rodar automaticamente**

Os 6 novos `alertKey`s (mais precisamente, as novas combinações de `variables` do `DAILY_SUMMARY`)
não mudam a CONTAGEM de linhas seedadas (o `alertKey` já existia no registry desde a leva
anterior, só o conteúdo de `factoryDefault` mudou) — então não há linha nova pra seedar. Não é
necessário rodar `seedMessageTemplatesFromRegistry()` de novo, só confirmar isso explicitamente no
relatório (Step 3).

- [ ] **Step 3: Atualizar `IMPLEMENTATION_PLAN.md`**

Marcar a Etapa 2 como **100% concluída** (todos os 8 fluxos de alerta migrados), listar os commits
desta leva, registrar qualquer pendência menor que tenha sobrado (ex.: `sendPaymentErrorEmail` sem
distinção de `alertKey` — ver nota no Step 5 da Task 17).

- [ ] **Step 4: Commit**

```bash
git add IMPLEMENTATION_PLAN.md
git commit -m "docs: marca Etapa 2 100% concluída — todos os 8 alertas migrados"
```
