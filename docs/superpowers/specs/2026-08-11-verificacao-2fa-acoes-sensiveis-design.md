# Verificação em 2 etapas para ações sensíveis de pagamento — Design

## Contexto

Varredura de segurança pedida pelo usuário (2026-08-10/11) identificou que qualquer rotina que
efetivamente chama a API do gateway de pagamento pra estornar dinheiro passa por um único ponto:
`lib/payment/refund-service.ts::refundPayment()`. Hoje, uma sessão autenticada (de admin ou
organizador) é suficiente pra disparar um estorno real — sem nenhuma confirmação adicional além do
modal de "tem certeza?" já existente (`ConfirmModal`). O usuário pediu uma segunda camada: um
código de verificação de uso único, enviado por e-mail e WhatsApp pra quem está executando a ação,
que precisa ser digitado corretamente antes do estorno acontecer de fato — proteção contra sessão
comprometida (alguém com acesso indevido à conta não teria acesso ao e-mail/telefone do dono real).

Levantamento dos 4 pontos que levam a uma chamada real ao gateway (todos passam por
`refundPayment()`), confirmados com o usuário como escopo desta mudança:

1. `POST /api/admin/payments/[id]/refund` — admin estorna manualmente.
2. `POST /api/organizer/registrations/[id]/refund` — organizador estorna manualmente.
3. `POST /api/admin/anunciantes/[purchaseId]/reject` — rejeitar solicitação de anunciante paga
   estorna automaticamente como efeito colateral (`lib/email.ts::sendAdvertiserRequestRejectedEmail`
   é disparado depois, sem depender do resultado do estorno).
4. Aprovação de cancelamento de inscrição (`lib/registrations/cancellation-decision-service.ts`,
   usada por `app/api/admin/registrations/[id]/cancellation-decision/route.ts` e o equivalente em
   `app/api/organizer/...`) — quando a decisão é `APPROVE` **e** existe pagamento pago associado,
   chama `attemptAutoRefund` → `refundPayment` automaticamente.

Dois pontos relacionados a dinheiro, mas que **não** chamam a API de pagamento, foram identificados
e ficam de fora desta mudança (registrados pra estudo futuro, não fazem parte deste escopo):

- `lib/payment/manual-refund-resolution.ts::resolveRefundManually` — marca um estorno que falhou
  automaticamente como resolvido manualmente (o estorno de verdade foi feito fora do sistema, no
  painel do gateway). Não chama `provider.refundPayment()`.
- `lib/admin/update-payout-status.ts::updatePayoutStatus` — marca uma transferência bancária a
  organizador como concluída. Transferência é manual, fora da API do gateway.

## O que muda

### Schema — tabela nova, genérica

```prisma
model SensitiveActionCode {
  id         String    @id @default(cuid())
  userId     String
  actionType String    // "PAYMENT_REFUND" nesta leva; outros tipos no futuro sem mudar o schema
  targetId   String    // paymentId, purchaseId ou registrationId, dependendo do actionType
  codeHash   String    // sha256 do código de 6 dígitos — nunca o código em texto puro
  attempts   Int       @default(0)
  consumedAt DateTime?
  expiresAt  DateTime
  createdAt  DateTime  @default(now())

  @@index([userId, actionType, targetId])
  @@map("sensitive_action_codes")
}
```

Sem relação Prisma pra `User` (mesma decisão já usada em `AuditLog.userId` — string solta, sem FK
de relação, já que nunca precisamos navegar "todos os códigos de um usuário" a partir do model
`User`). Migração aditiva simples via `prisma db push`, tabela nova, nenhum dado existente a migrar.

`actionType` é uma string livre (não um enum do Prisma), mesmo padrão já adotado por `messageType`
em `MessageLog` — permite adicionar novos tipos de ação sensível no futuro sem migração de schema.

### Serviço central — `lib/security/sensitive-action-verification.ts`

Duas funções exportadas, mais as constantes de configuração:

```ts
const CODE_LENGTH = 6;
const EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const REQUEST_RATE_LIMIT = { requests: 3, windowMs: 5 * 60_000 }; // por userId+actionType+targetId

export type SensitiveActionType = "PAYMENT_REFUND";

export async function requestSensitiveActionCode(params: {
  userId: string;
  actionType: SensitiveActionType;
  targetId: string;
}): Promise<{ verificationId: string } | { error: string }>;

export async function verifySensitiveActionCode(params: {
  verificationId: string;
  userId: string;
  actionType: SensitiveActionType;
  targetId: string;
  code: string;
}): Promise<{ ok: true } | { ok: false; error: string; attemptsRemaining?: number }>;
```

**`requestSensitiveActionCode`**:
1. Aplica `checkRateLimit` (`lib/rate-limit.ts`, chave `sensitive-code:${userId}:${actionType}:${targetId}`, config `REQUEST_RATE_LIMIT`) — evita spam de e-mail/WhatsApp gerando código repetidamente. Se excedido, retorna `{ error }`.
2. Gera código numérico de 6 dígitos com `crypto.randomInt(100000, 999999)`.
3. Grava `SensitiveActionCode` com `codeHash = sha256(code)`, `expiresAt = now + 10min`.
4. Busca `db.user.findUnique({ where: { id: userId }, select: { name: true, email: true, phone: true } })`.
5. Envia e-mail (função nova `sendSensitiveActionCodeEmail` em `lib/email.ts`, `messageType: "SENSITIVE_ACTION_CODE"`) — **obrigatório**; se falhar, apaga o registro criado no passo 3 e retorna `{ error: "Não foi possível enviar o código por e-mail. Tente novamente." }` (sem canal nenhum, o código gerado seria inútil).
6. Se `user.phone` existir, tenta enviar WhatsApp (`sendWhatsAppMessage`, `messageType: "SENSITIVE_ACTION_CODE"`) — best-effort, erro é logado mas não impede o retorno de sucesso (e-mail já confirmado no passo 5).
7. Retorna `{ verificationId: row.id }` — o código em si nunca volta na resposta HTTP.

**`verifySensitiveActionCode`**:
1. Busca a linha por `verificationId`. Não encontrada, `userId`/`actionType`/`targetId` não batem, já consumida, ou `expiresAt` no passado → `{ ok: false, error: "Código expirado ou inválido, solicite um novo" }`.
2. `attempts >= MAX_ATTEMPTS` → mesma mensagem de expirado (não revela que o limite de tentativas é o motivo específico, mesmo espírito do rate limit de login não revelar detalhe).
3. Compara `sha256(code)` com `codeHash` usando `crypto.timingSafeEqual` (mesmo padrão já usado em `lib/payment/pagarme.ts`, consistência de comparação constant-time em qualquer verificação de segredo no projeto).
4. Errado → incrementa `attempts`, retorna `{ ok: false, error: "Código incorreto", attemptsRemaining: MAX_ATTEMPTS - attempts }`.
5. Certo → marca `consumedAt = now`, retorna `{ ok: true }`.

O código vai sempre para o e-mail/telefone do **usuário autenticado que está executando a ação**
(`session.user.id`) — inclusive quando quem age é um `ASSISTANT` atuando em nome de um organizador
(o assistente tem seu próprio `User.phone`/`email`; não usa os dados do organizador que ele
representa). É isso que sustenta a proteção contra sessão comprometida.

### Rotas — endpoint `.../request-code` novo + rota original passa a exigir o código

Cada uma das 4 rotas listadas no Contexto ganha uma rota irmã:

- `POST /api/admin/payments/[id]/refund/request-code`
- `POST /api/organizer/registrations/[id]/refund/request-code`
- `POST /api/admin/anunciantes/[purchaseId]/reject/request-code`
- `POST /api/admin/registrations/[id]/cancellation-decision/request-code`
- `POST /api/organizer/registrations/[id]/cancellation-decision/request-code`

Cada rota `request-code`: mesma checagem de permissão da rota original
(`checkApiPermission`/`checkAdminOnlyApiPermission`), mesma consulta somente-leitura que a rota
original já faz pra confirmar que existe um pagamento pago envolvido (sem side effects) — só então
chama `requestSensitiveActionCode` e devolve `{ verificationId }`. Se a consulta mostrar que não há
pagamento pago associado (ex: `decision === "REJECT"` no cancelamento, ou `APPROVE` sem pagamento
pago), a rota `request-code` não é chamada pelo frontend pra esse caso — a ação segue direto sem
pedir código, porque não vai mexer em dinheiro (ver seção de UI).

As 5 rotas originais passam a exigir `{ verificationId, code, ...corpo de sempre }`. Chamam
`verifySensitiveActionCode` primeiro; só seguem pra lógica atual (estornar, rejeitar+estornar,
aprovar cancelamento+estornar) se vier `{ ok: true }`. Erro de verificação retorna 400 com a
mensagem de `verifySensitiveActionCode` (mais `attemptsRemaining` quando aplicável, pro frontend
mostrar "restam N tentativas").

### E-mail e WhatsApp do código

Mensagem nova, fora do sistema de templates customizáveis (`lib/templates/registry.ts`) — mesmo
tratamento de `sendPasswordResetEmail` (segurança não deve ser editável por admin via
`/admin/mensagens`, evita risco de alguém remover o código do texto por engano). Texto simples:
nome da ação em português (ex: "Confirmação de estorno de pagamento"), o código de 6 dígitos em
destaque, validade de 10 minutos, aviso de "se você não solicitou esta ação, ignore esta mensagem".

`sendSensitiveActionCodeEmail(params: { to: string; name: string; code: string; actionLabel: string })`
em `lib/email.ts`, chamando `sendMail({ ..., messageType: "SENSITIVE_ACTION_CODE" })` — campo hoje
obrigatório em `sendMail`/`sendWhatsAppMessage` (trabalho em andamento de outra frente desta sessão,
já commitado no schema). `MESSAGE_TYPE_LABEL` (`lib/message-logs.ts`) ganha a entrada
`SENSITIVE_ACTION_CODE: "Código de verificação"`.

### UI — hook compartilhado + modal novo

**`components/ui/CodeVerificationModal.tsx`** — componente novo (não uma extensão de
`ConfirmModal`, a interação é outra: campo de código, cronômetro, reenviar). Props: `open`,
`title`, `maskedDestination` (ex: "e-mail e WhatsApp cadastrados"), `expiresAt`, `error`,
`attemptsRemaining`, `loading`, `onSubmit(code)`, `onResend()`, `onCancel()`.

**`lib/hooks/use-sensitive-action-verification.ts`** — hook compartilhado pelos 4 componentes.
Decisão tomada com o usuário: a máquina de estados (pedir código → cronômetro → reenviar com rate
limit → validar → tentativas restantes → sucesso) é complexa o bastante pra justificar centralizar,
ao contrário do padrão simples de "confirma → chama uma API" que o resto do projeto duplica entre
componentes parecidos.

```ts
function useSensitiveActionVerification(params: {
  requestCodeEndpoint: string; // já com o :id resolvido
  confirmEndpoint: string;     // rota original, já com o :id resolvido
}): {
  step: "idle" | "requesting" | "code" | "submitting";
  error: string | null;
  attemptsRemaining: number | null;
  expiresAt: Date | null;
  start: () => Promise<void>;           // chama request-code, abre o modal de código
  submitCode: (code: string, extraBody?: Record<string, unknown>) => Promise<{ ok: boolean; response?: Response }>;
  resend: () => Promise<void>;
  cancel: () => void;
};
```

Fluxo em cada um dos 4 componentes (exemplo `RefundPaymentButton.tsx`): `ConfirmModal` de sempre
(com motivo) continua igual; no `onConfirm`, em vez de chamar `/refund` direto, guarda o motivo em
estado local e chama `verification.start()`. Isso fecha o `ConfirmModal` e abre o
`CodeVerificationModal` (controlado por `verification.step === "code"`). Ao confirmar o código,
`verification.submitCode(code, { reason })` chama a rota original com `{ verificationId, code,
reason }`; sucesso segue o fluxo que já existe hoje (ex: `router.refresh()`).

Para `CancellationDecisionButtons`, o hook só é acionado quando a decisão é `APPROVE` — o botão de
`REJECT` continua chamando a rota direto, sem passar pelo hook (não há pagamento em jogo).

### Testes

Backend, TDD:

- `tests/lib-sensitive-action-verification.test.ts` — geração de código (hash nunca é o texto
  puro), expiração em 10min, bloqueio após 5 tentativas erradas, código consumido não pode ser
  reusado, rate limit no pedido de código novo, `verifySensitiveActionCode` usa comparação
  constant-time.
- Um teste novo por rota `request-code` (permissão, consulta somente-leitura confirma pagamento
  antes de gerar código, resposta nunca inclui o código).
- Testes já existentes das 5 rotas protegidas atualizados: sem `{verificationId, code}` → 400;
  código errado → 400 com `attemptsRemaining`; código certo → segue o comportamento de sempre
  (mockando `verifySensitiveActionCode` como `{ ok: true }`).
- `decideRegistrationCancellation` com `decision: "REJECT"` e com `APPROVE` sem pagamento pago:
  confirma que a rota `request-code` correspondente nunca é necessária pra esses casos (a
  responsabilidade de decidir se pede código é do frontend, mas o backend das rotas originais
  também não deve exigir `verificationId`/`code` nesses dois casos — ver nota de implementação
  abaixo).

**Decisão sobre quando exigir o código**: tanto a rota `request-code` quanto a rota original já
fazem, hoje, a mesma consulta pra saber se há um pagamento pago em jogo (é assim que decidem se vão
chamar `attemptAutoRefund`/`refundPayment` ou não). Não é lógica nova a duplicar — é a lógica que já
existe nas duas rotas. A regra fica: a rota original só passa a exigir `{ verificationId, code }`
quando essa consulta (que ela já faz) mostra que a ação vai gerar uma chamada real a
`refundPayment`; quando não gera (`REJECT` da solicitação de cancelamento, ou `APPROVE`/rejeição
sem pagamento pago associado), a rota segue exatamente como hoje, sem exigir nada. O frontend, por
sua vez, só chama `verification.start()` (e portanto `request-code`) nos casos em que sabe de
antemão que vai precisar do código — para `CancellationDecisionButtons`, isso é quando o botão é
"Aprovar" e a inscrição tem um pagamento pago (informação que a página já carrega pra exibir os
dados da inscrição).

Frontend: sem teste automatizado (convenção já estabelecida no projeto pra client components) —
verificação manual no navegador após implementado.

## Fora do escopo desta leva

- `resolveRefundManually` (resolução manual de estorno) e `updatePayoutStatus` (status de repasse)
  — não chamam a API do gateway, ficam de fora por decisão do usuário nesta rodada. Candidatos a
  uma leva futura se o usuário quiser estender a mesma verificação pra eles.
- Qualquer alteração ao sistema de templates customizáveis (`/admin/mensagens`) — a mensagem do
  código é fixa, não editável, por design de segurança.
