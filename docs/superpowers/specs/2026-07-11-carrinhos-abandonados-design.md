# Página de carrinhos abandonados (admin + organizador)

## Contexto

Primeiro de uma leva de 6 sub-projetos pedidos pelo usuário nesta sessão (ordem: carrinhos
abandonados → filtros/resumo no evento → verificar resultados → corrigir expiração de pagamentos →
verificar repasses → dashboards). Hoje já existe disparo automático de alerta de carrinho
abandonado (`checkAbandonedCarts`, `lib/alerts/abandoned-cart.ts`, acionado por
`/api/cron/abandoned-carts`), configurável em `app/admin/alertas`, mas não existe nenhuma tela que
liste os pedidos `PENDING` individualmente nem permita disparo manual (individual ou em massa).

## Descoberta importante

`checkAbandonedCarts` usa deduplicação (`claimAlert`/`AlertLog`, `lib/alerts/dedupe.ts`) pra nunca
mandar o mesmo alerta duas vezes por pedido+canal — essencial pro disparo automático (evita duplicar
em cron overlapping), mas bloquearia um envio manual repetido. Mesma solução já usada no
sub-projeto de reenvio de notificação de pagamento (`docs/superpowers/specs/2026-07-04-reenvio-manual-notificacao-pagamento-design.md`):
extrair o envio de um pedido individual pra uma função com opção `bypassDedupe`.

## 1. `lib/alerts/abandoned-cart.ts` — extrair `sendAbandonedCartAlert`

```ts
export async function sendAbandonedCartAlert(
  orderId: string,
  options?: { bypassDedupe?: boolean },
): Promise<{ sent: boolean }>
```

Contém a lógica hoje inline no loop de `checkAbandonedCarts` (grava `AuditLog` `CART_ABANDONED`,
manda e-mail se `emailEnabled` e SMTP pronto, manda WhatsApp se `whatsappEnabled` e telefone
cadastrado). Com `bypassDedupe: true`, pula `claimAlert`/`unclaimAlert` e sempre tenta enviar.
`checkAbandonedCarts` passa a chamar essa função por pedido (sem a opção, comportamento automático
inalterado) e só incrementa `notified` quando `sent` é `true`.

## 2. Query compartilhada — `lib/alerts/abandoned-cart-query.ts`

Novo arquivo com `buildAbandonedCartWhere` e `listAbandonedCarts`, no mesmo padrão de
`lib/admin/payouts.ts`:

```ts
export interface AbandonedCartSearchParams {
  q?: string;        // nome/e-mail do comprador ou título do evento
  event?: string;
  dateFrom?: string;  // filtra por createdAt do pedido
  dateTo?: string;
  sort?: string;      // "createdAt" (tempo pendente) | "amount"
  dir?: string;
  page?: string;
}

export function buildAbandonedCartWhere(
  params: Pick<AbandonedCartSearchParams, "q" | "event" | "dateFrom" | "dateTo">,
  scope?: { organizerId: string },   // presente = escopo organizador; ausente = admin vê tudo
): Prisma.OrderWhereInput
```

Sempre filtra `status: "PENDING"`. Lista **todos** os pendentes (sem limiar de minutos — decisão já
tomada: o limiar configurado em Alertas continua valendo só pro disparo automático). Cada linha
retorna: `id`, `createdAt` (pra calcular tempo pendente), `subtotalAmount`, `event.title`,
`buyer.name`, `buyer.email`, `buyer.athleteProfile.phone` (pra saber se WhatsApp está disponível), e
o `AlertLog` mais recente do tipo `ABANDONED_CART` pra esse pedido (pra mostrar "último alerta
enviado em ...", se houver). Paginação de 20 por página, igual padrão de `repasses`.

## 3. Rotas de notificação

Espelhando `app/api/organizer/registrations/[id]/resend-payment-notification/route.ts`:

- `app/api/admin/abandoned-carts/notify/route.ts` — `requireAdmin`.
- `app/api/organizer/abandoned-carts/notify/route.ts` — `requireOrganizer`, só aceita pedidos de
  eventos do organizador autenticado (senão 404).

Corpo aceito por ambas: `{ orderId: string }` (individual) **ou** `{ all: true, ...filtros }`
(massa — reaplica os mesmos filtros da listagem no servidor, não apenas a página atual visível).
Ambas chamam `sendAbandonedCartAlert(orderId, { bypassDedupe: true })` pra cada pedido, e gravam
`AuditLog` (`action: "ABANDONED_CART_NOTIFICATION_RESENT"`, `entityType: "Order"`, `userId` de quem
disparou) por pedido notificado. Resposta: `{ notified: number, total: number }`.

## 4. Páginas

- `app/admin/carrinhos-abandonados/page.tsx` — sem escopo de organizador.
- `app/organizador/carrinhos-abandonados/page.tsx` — escopo `{ organizerId: session.organizerId }`.

Ambas server components com `searchParams` (mesmo padrão de `app/admin/repasses/page.tsx`): busca,
filtro por evento, período, ordenação, paginação. Tabela mostra comprador, evento, valor, tempo
pendente (ex: "2 dias 4h"), canais disponíveis (ícone e-mail / WhatsApp conforme telefone
cadastrado), último alerta enviado, e botão de ação por linha.

## 5. Componentes

- `components/alerts/AbandonedCartRow.tsx` (ou inline na tabela) — botão "Enviar alerta" por linha:
  ação direta, estado de carregamento, `router.refresh()` no sucesso, sem modal de confirmação
  (mesmo padrão de baixo risco do `ExpirePaymentsPanel` — ação sobre um único pedido).
- `components/alerts/SendAllAbandonedCartsButton.tsx` — botão "Enviar para todos" no topo da
  tabela, que abre `ConfirmModal` (`tone="default"`, mensagem explicando quantos pedidos serão
  notificados) antes de disparar `{ all: true, ...filtrosAtuais }`; usa `ErrorModal` em caso de
  falha. Recebe `endpoint` como prop pra servir as duas rotas (admin/organizador), igual padrão do
  `ReconciliationPanel`.

## 6. Navegação

Novo link "Carrinhos abandonados" em `components/admin/AdminNav.tsx` e
`components/organizer/OrganizerNav.tsx`, ao lado do já existente "Pedidos vencidos".

## Testes

- `tests/abandoned-cart-alert.test.ts` (ou extensão do existente `tests/alert-abandoned-cart.test.ts`)
  cobrindo `sendAbandonedCartAlert` com e sem `bypassDedupe`.
- `tests/admin-abandoned-carts-route.test.ts` e `tests/organizer-abandoned-carts-route.test.ts`
  cobrindo autenticação/escopo, envio individual e envio em massa respeitando filtros.
- `tests/abandoned-cart-query.test.ts` cobrindo `buildAbandonedCartWhere` (com e sem escopo de
  organizador).

## Fora de escopo

- Mudar o limiar/config do disparo automático (`app/admin/alertas` continua como está).
- Cancelar ou expirar o pedido a partir dessa tela — isso já é coberto pela tela de "Pedidos
  vencidos" existente; aqui é só notificação.
- Escolher canal (e-mail/WhatsApp) por disparo — sempre usa a mesma regra automática (e-mail sempre
  que SMTP pronto, WhatsApp se houver telefone).
