# Aprovação de cancelamento, estorno automático e fila de reembolsos pendentes

## Contexto e causa raiz

Um atleta cancelou a própria inscrição sem que o sistema exigisse justificativa,
sem notificar admin/organizador, sem gerar nenhum registro de estorno pendente e
sem refletir isso na listagem de inscritos do evento.

Investigação no código mostrou que o fluxo de cancelamento já é parcialmente
condicional: `Event.cancellationRequiresApproval` (por evento) combinado com o
toggle global `cancellation_policy_enabled` (`lib/settings.ts`,
`getCancellationPolicyEnabled`) decidem, via
`lib/registrations/cancellation-policy.ts::decideCancellationOutcome`, entre três
saídas: `cancel_immediately`, `requires_approval` e `blocked_deadline_passed`.

No caminho `requires_approval` o motivo já é obrigatório e já existe
`notifyCancellationRequested` (e-mail apenas, para `Event.cancellationContactEmail`,
se configurado). No caminho `cancel_immediately` (o padrão, e o caso do incidente
relatado) nada disso acontece: a inscrição e o pedido são cancelados na hora, sem
motivo, sem notificação e sem qualquer tentativa de estorno.

Além disso, mesmo no caminho `requires_approval`, aprovar o cancelamento hoje só
muda o status da inscrição — não dispara nenhum estorno (`refundPayment` só é
chamado manualmente pelo botão "Estornar", em ação separada). E a listagem de
inscritos deriva o badge "Estornado" apenas de `Payment.status`, sem distinguir
"cancelado, estorno pendente" de "cancelado, estornado".

## Decisão de escopo

- O fluxo condicional (`cancellationRequiresApproval` por evento +
  `cancellation_policy_enabled` global) **permanece exatamente como está** —
  não será removido nem simplificado. O prazo de cancelamento
  (`cancellationDeadline`) também permanece inalterado.
- A **única mudança** no caminho `cancel_immediately`: o motivo passa a ser
  **sempre obrigatório**, mesmo sem aprovação. É gravado em
  `Registration.cancellationReason` e no audit log, mas não dispara notificação,
  aprovação ou estorno automático — continua idêntico ao comportamento atual
  fora isso.
- No caminho `requires_approval`, o pacote completo de melhorias se aplica:
  notificação a admin/organizador (e-mail + WhatsApp), aprovação com estorno
  automático via gateway, fallback para estorno manual em caso de falha, e a
  nova fila de pendências.

## 1. Modelo de dados (Prisma)

```prisma
enum PaymentStatus {
  PENDING
  PAID
  EXPIRED
  CANCELLED
  REFUNDED
  CHARGEBACK
  REFUND_PENDING   // novo: estorno automático falhou ou aguarda resolução
}

enum RefundStatus {
  PROCESSED   // estornado com sucesso via gateway
  FAILED      // tentativa automática falhou, aguardando ação manual
  MANUAL      // confirmado manualmente pelo admin/organizador (fora da plataforma)
}

model Refund {
  id                String       @id @default(cuid())
  paymentId         String
  amount            Int
  reason            String?      // motivo original do cancelamento/estorno
  status            RefundStatus // novo — sempre setado explicitamente na criação, sem @default
  failureReason     String?      // novo: erro retornado pelo gateway, quando status = FAILED
  resolutionNote    String?      // novo: nota do admin/organizador ao confirmar estorno manual
  providerRefundId  String?
  initiatedByUserId String
  processedAt       DateTime?    // setado quando status = PROCESSED ou MANUAL; null quando FAILED
  createdAt         DateTime     @default(now())
  ...
}
```

Não existe estado `PENDING` no `RefundStatus`: todo `Refund` já nasce como
`PROCESSED` (estorno automático bem-sucedido) ou `FAILED` (estorno automático
falhou, ainda sem `Refund` "em andamento" — é criado direto como `FAILED` no
mesmo instante da falha), e é promovido a `MANUAL` na resolução manual. A
seção 5 lista pagamentos por `Payment.status = REFUND_PENDING`, não por
`Refund.status` — é esse campo em `Payment` que representa "aguardando
resolução".

`Event.cancellationRequiresApproval` e o setting `cancellation_policy_enabled`
não mudam.

## 2. Fluxo de cancelamento do atleta (`POST /api/registrations/[id]/cancel`)

- Motivo (`reason`) validado **antes** de ramificar por `decideCancellationOutcome`
  — retorna 400 se vazio, em qualquer outcome (hoje só valida dentro do branch
  `requires_approval`).
- Branch `cancel_immediately`: mantém exatamente a lógica atual (cancela
  registration + order, decrementa `soldCount`), passando a gravar também
  `cancellationReason` na atualização da `Registration` e incluindo `reason` no
  `AuditLog` de `REGISTRATION_CANCELLED`. Nenhuma notificação, aprovação ou
  estorno é disparado neste branch.
- Branch `requires_approval`: sem mudança de lógica de gravação; a notificação
  passa a usar o novo `lib/alerts/cancellation-requested.ts` (ver seção 4) no
  lugar de `notifyCancellationRequested`.
- `CancelRegistrationButton`: sempre exibe o campo de justificativa obrigatório
  (hoje só aparece quando `requiresApproval` é verdadeiro); botão de confirmar
  fica desabilitado até haver texto. A mensagem pós-envio continua diferenciada
  por `requiresApproval` ("cancelado" vs. "aguardando aprovação").

## 3. Aprovação com estorno automático (admin/organizador)

Rota `POST /api/organizer/registrations/[id]/cancellation-decision` (existente,
escopada ao organizador dono do evento) ganha uma equivalente nova
`POST /api/admin/registrations/[id]/cancellation-decision` (sem restrição de
dono, para uso na fila agregada de admin da seção 5), ambas com a mesma lógica
de decisão descrita abaixo:

- **REJECT**: sem mudança — volta para `CONFIRMED`, audit log.
- **APPROVE**:
  1. Marca `Registration.status = CANCELLED`, decrementa `soldCount` (como já
     ocorre), audit log `REGISTRATION_CANCELLATION_APPROVED`.
  2. Se o pedido tiver `Payment.status === "PAID"`, tenta o estorno automático
     reaproveitando `refundPayment` (`lib/payment/refund-service.ts`), adaptado
     para **não lançar exceção** em caso de falha do gateway:
     - Sucesso: cria `Refund{status: PROCESSED, processedAt: now, providerRefundId}`,
       `Payment.status = REFUNDED`, `Order.status = REFUNDED` (comportamento já
       existente, preservado).
     - Falha do gateway: cria `Refund{status: FAILED, failureReason: <mensagem>,
       reason: <motivo do cancelamento>}`, `Payment.status = REFUND_PENDING`.
       A inscrição permanece `CANCELLED` — a falha de estorno não bloqueia o
       cancelamento.
  3. Se não houver pagamento `PAID` (ex.: inscrição gratuita, ou já
     estornado/cancelado antes), pula a etapa de estorno — nada a fazer.

Novas rotas `POST /api/admin/refunds/[paymentId]/manual-resolve` e
`POST /api/organizer/refunds/[paymentId]/manual-resolve`: exigem
`resolutionNote` (obrigatório, texto livre — "o estorno foi feito fora da
plataforma"), atualizam o `Refund` mais recente daquele pagamento
(`status: FAILED`) para `status: MANUAL, processedAt: now, resolutionNote`, e
`Payment.status = REFUNDED`. Audit log `PAYMENT_REFUND_MANUAL`. Escopo: a rota
admin aceita qualquer `paymentId`; a rota organizador filtra a query por
`payment.order.event.organizer.userId === session.user.id` (mesmo padrão de
`app/api/organizer/registrations/[id]/refund/route.ts`) e retorna 404 se o
pagamento não pertencer a um evento do organizador logado.

## 4. Notificação a admin/organizador (e-mail + WhatsApp)

Novo `lib/alerts/cancellation-requested.ts`, seguindo o padrão exato de
`lib/alerts/reconciliation.ts` / `payment-error.ts`:

- Settings novos (`lib/alerts/alert-settings.ts` + tabela `Setting`):
  `alert_cancellation_email_enabled`, `alert_cancellation_whatsapp_enabled`
  (ambos com toggle na tela `app/admin/alertas`, mesmo componente/padrão dos
  demais alertas).
- Disparado apenas no branch `requires_approval` do cancelamento (seção 2), no
  lugar do atual `notifyCancellationRequested`.
- Destinatários: todos os usuários `role = ADMIN`, mais o usuário dono do
  `OrganizerProfile` do evento (`event.organizer.user`) — e-mail e telefone
  (`athleteProfile`/`OrganizerProfile.phone`, mesmo padrão dos outros alertas).
- Conteúdo: nome do atleta, evento, motivo do cancelamento, link para a nova
  página de pendências (seção 5).
- Dedupe via `claimAlert`/`unclaimAlert` (mesmo mecanismo dos demais alertas),
  chave por `Registration`.
- `notifyCancellationRequested` (`lib/notifications.ts`) e o e-mail baseado em
  `Event.cancellationContactEmail` são removidos — substituídos pelo novo
  alerta. (`Event.cancellationContactEmail`/`cancellationContactPhone`
  permanecem no schema sem uso neste fluxo, sem migração de remoção — fora de
  escopo.)

## 5. Página de cancelamentos e reembolsos pendentes

Novas rotas, seguindo o padrão de `app/organizador/pedidos-vencidos`:

- `app/admin/reembolsos-pendentes` (todas as inscrições/pagamentos da
  plataforma).
- `app/organizador/reembolsos-pendentes` (escopado às inscrições dos eventos do
  organizador logado, mesmo padrão de scoping das demais rotas de organizador).

Duas seções na mesma página:

1. **Solicitações de cancelamento** — `Registration.status =
   CANCELLATION_REQUESTED`, listadas com evento, atleta, data da solicitação e
   botão "Ver justificativa" + botões Aprovar/Rejeitar (via
   `CancellationDecisionButtons`, seção 6).
2. **Reembolsos pendentes** — `Payment.status = REFUND_PENDING`, listadas com
   evento, atleta, valor, motivo da falha (`Refund.failureReason`) e botão
   "Registrar estorno manual" (abre modal pedindo `resolutionNote` obrigatória
   antes de confirmar).

## 6. Visualizar justificativa e confirmar aprovação/rejeição

- `RegistrationsTable`: em qualquer linha com `cancellationReason` preenchido
  (cobre tanto `CANCELLATION_REQUESTED` quanto `CANCELLED` com motivo, incluindo
  os cancelamentos imediatos que agora sempre gravam motivo — seção 2), exibe
  botão "Ver justificativa" que abre um modal somente leitura (mesmo padrão
  visual de `components/registrations/AthleteDetailsModal.tsx`) com nome do
  atleta, data da solicitação/cancelamento e o texto do motivo.
- `CancellationDecisionButtons`: clicar em "Aprovar" ou "Rejeitar" não dispara
  mais a decisão direto — abre um modal mostrando a justificativa do atleta e
  pedindo confirmação explícita ("Confirmar aprovação" / "Confirmar rejeição" +
  "Cancelar"). O `fetch` para `cancellation-decision` só ocorre ao confirmar
  dentro do modal. Componente reaproveitado tanto na tabela de inscritos quanto
  na nova página de reembolsos pendentes (seção 5).

## 7. Exibição de status de reembolso na listagem de inscritos

`RegistrationsTable` — a lógica atual de badge (`isRefunded` derivado de
`Payment.status`) ganha um novo caso:

- `Payment.status === "REFUND_PENDING"` → badge "Cancelado — reembolso
  pendente" (cor de alerta, distinta de "Cancelamento solicitado" e de
  "Estornado").
- Casos existentes (`REFUNDED`/`CHARGEBACK` → "Estornado",
  `CANCELLATION_REQUESTED` → "Cancelamento solicitado") permanecem sem
  mudança.

## Fora de escopo

- Remoção/migração de `Event.cancellationContactEmail` /
  `cancellationContactPhone` (ficam órfãos, sem uso, fora de escopo desta
  mudança).
- Mudanças no toggle global `cancellation_policy_enabled` ou no checkbox por
  evento `cancellationRequiresApproval` — permanecem como estão.
- Estorno parcial (valor diferente do total pago) — todo estorno segue sendo do
  valor integral do pagamento, como já ocorre hoje.

## Testes

- `decideCancellationOutcome`: cobertura já existente, sem mudança de
  comportamento — não precisa de novos casos.
- Rota de cancelamento: novo teste garantindo 400 quando `reason` vazio no
  branch `cancel_immediately`; teste garantindo `cancellationReason` persistido
  nesse branch.
- `refundPayment` (ou wrapper): teste de falha do gateway resultando em
  `Refund{status: FAILED}` + `Payment.status = REFUND_PENDING`, sem exceção
  propagada.
- Rota `cancellation-decision` APPROVE: teste cobrindo estorno automático
  bem-sucedido e falho.
- Rota `manual-resolve`: teste exigindo `resolutionNote`, teste de escopo
  (organizador não pode resolver pagamento de evento alheio).
- `lib/alerts/cancellation-requested.ts`: teste seguindo o padrão dos testes
  existentes de `lib/alerts/*` (mock de settings, dedupe, destinatários).
- Testes de UI (RegistrationsTable, CancellationDecisionButtons, modal de
  justificativa): cobertura conforme padrão de testes de componente já usado
  no projeto.
