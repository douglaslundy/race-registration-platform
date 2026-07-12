# Fluxo completo de repasse ao organizador (gerar + marcar status)

## Contexto

Quinto de seis sub-projetos pedidos pelo usuário nesta sessão (carrinhos abandonados ✅ → filtros/
resumo no evento ✅ → resultados/import CSV ✅ → expiração de pagamentos ✅ → **este** → dashboards).
O pedido original era "verificar sistema de repasse ao organizador" — investigação encontrou que a
página `/admin/repasses` (filtros, ordenação, paginação, export CSV) e o resumo no relatório do
organizador já existem e funcionam, mas são **somente leitura**: não existe nenhuma rota
POST/PATCH que crie ou altere um `TransferPayout` em lugar nenhum do app — a única forma de um
registro entrar nessa tabela hoje é restaurando um backup completo do banco. Os campos
`processedAt`/`notes` do schema nunca são lidos/escritos. Usuário confirmou que quer o fluxo
completo: gerar repasse automaticamente a partir dos pedidos pagos do evento, e marcar
status/data/observação.

## 1. Schema — `Order.payoutId`

Pra permitir gerar repasses incrementais (só os pedidos ainda não cobertos por um repasse anterior)
sem depender de comparação de datas (frágil quando um pedido é pago bem depois de criado), `Order`
ganha uma FK opcional pra `TransferPayout`:

```prisma
model Order {
  // ...campos existentes inalterados...
  payoutId String?

  // ...relações existentes...
  payout TransferPayout? @relation(fields: [payoutId], references: [id])

  @@index([payoutId])
}

model TransferPayout {
  // ...campos existentes inalterados (processedAt e notes já existem, passam a ser usados)...
  orders Order[]
}
```

Nova migração Prisma (`prisma migrate dev` local pra gerar o arquivo; aplicação em produção via
`prisma db push` no próximo deploy, mesmo padrão das migrações anteriores desta sessão — ver
[[deploy_vps_process]]).

**Confirmado que não quebra backup/restore:** `transferPayout` já é criado (linha 415 de
`app/api/admin/backup/import/route.ts`) antes de `order` (linha 417), e `order` já é apagado
(linha 392) antes de `transferPayout` (linha 395) — a ordem atual já é FK-safe pra essa nova
relação, sem precisar reordenar nada. Só falta adicionar `payoutId: sn(row.payoutId)` em
`toOrderRow` (`route.ts:175-191`, mesmo padrão já usado pra `couponId`). O export não precisa de
nenhuma mudança — não faz mapeamento campo a campo, exporta todos os campos escalares do Prisma
automaticamente (`app/api/admin/backup/route.ts:44-48`).

## 2. Cálculo do repasse — `lib/admin/generate-payout.ts` (novo)

Decisão confirmada com o usuário: `grossAmount` = tudo que o comprador pagou (inclui as taxas),
`platformFee` = o que a plataforma retém, `netAmount` = o que sobra pro organizador — bate
matematicamente com "bruto − taxa = líquido":

```ts
grossAmount = soma(Order.totalAmount)       // tudo que o comprador pagou
platformFee = soma(Order.platformFeeAmount) + soma(Order.paymentFeeAmount)
netAmount   = grossAmount - platformFee      // == soma(Order.subtotalAmount), o preço do ingresso
```

Só sobre pedidos do evento com `status: "PAID"` e `payoutId: null` (ainda não cobertos por nenhum
repasse anterior — permite gerar repasses incrementais conforme mais inscrições vão sendo pagas,
sem contar nenhum pedido duas vezes, sem depender de comparar datas de criação/pagamento).

```ts
export async function computeEligiblePayoutTotals(eventId: string) {
  const agg = await db.order.aggregate({
    where: { eventId, status: "PAID", payoutId: null },
    _count: { id: true },
    _sum: { totalAmount: true, platformFeeAmount: true, paymentFeeAmount: true },
  });
  const grossAmount = agg._sum.totalAmount ?? 0;
  const platformFee = (agg._sum.platformFeeAmount ?? 0) + (agg._sum.paymentFeeAmount ?? 0);
  return { orderCount: agg._count.id, grossAmount, platformFee, netAmount: grossAmount - platformFee };
}

export async function generatePayout(eventId: string) {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { organizerId: true } });
  if (!event) return { error: "Evento não encontrado" as const };

  const orders = await db.order.findMany({
    where: { eventId, status: "PAID", payoutId: null },
    select: { id: true, totalAmount: true, platformFeeAmount: true, paymentFeeAmount: true },
  });
  if (orders.length === 0) return { error: "Nenhum pedido pago pendente de repasse para este evento." as const };

  const grossAmount = orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const platformFee = orders.reduce((sum, o) => sum + o.platformFeeAmount + o.paymentFeeAmount, 0);

  const payout = await db.$transaction(async (tx) => {
    const created = await tx.transferPayout.create({
      data: { eventId, organizerId: event.organizerId, grossAmount, platformFee, netAmount: grossAmount - platformFee },
    });
    await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { payoutId: created.id } });
    await tx.auditLog.create({
      data: {
        action: "PAYOUT_GENERATED",
        entityType: "TransferPayout",
        entityId: created.id,
        metadata: { eventId, orderCount: orders.length, grossAmount, netAmount: created.netAmount },
      },
    });
    return created;
  });

  return { payout };
}
```

## 3. Rotas — gerar repasse

- `GET /api/admin/events/[id]/payouts/preview` — admin-only. Chama `computeEligibleTotals`, retorna
  `{ orderCount, grossAmount, platformFee, netAmount }`. Só leitura, sem efeito colateral — usado
  pra popular o modal de confirmação antes de criar de verdade.
- `POST /api/admin/events/[id]/payouts` — admin-only. Chama `generatePayout(eventId)`. Recalcula do
  zero (não confia no preview, evita corrida entre preview e criação) — 400 com a mensagem de erro
  se não houver pedido elegível, 404 se o evento não existir, 201 com o repasse criado em caso de
  sucesso.

## 4. Rota — atualizar status

- `PATCH /api/admin/payouts/[id]` — admin-only. Body `{ status, note? }`.

Máquina de estado (`PayoutStatus`): `PENDING → PROCESSING | COMPLETED | FAILED`;
`PROCESSING → COMPLETED | FAILED`; `COMPLETED`/`FAILED` são terminais — qualquer tentativa de sair
deles retorna 400 ("Repasse já está em estado final").

`processedAt` é gravado (data atual) só ao entrar em `COMPLETED` ou `FAILED` — não em `PROCESSING`.
`notes`, se enviado, substitui o valor atual (concatenar histórico de notas está fora de escopo).

**Decisão de design (não veio de pergunta ao usuário, é consequência direta do resto do fluxo):**
ao transicionar pra `FAILED`, os pedidos vinculados a esse repasse (`Order.payoutId = este id`)
têm o `payoutId` zerado de volta (`updateMany({ data: { payoutId: null } })`), liberando-os pra
entrar em um repasse corrigido gerado depois. Sem isso, um repasse que falhou (ex.: transferência
bancária rejeitada) deixaria aqueles pedidos permanentemente impossíveis de repassar pelo fluxo
normal — exatamente o mesmo padrão de "dinheiro preso pra sempre" que a tarefa anterior desta sessão
corrigiu pros pagamentos de cartão.

Grava `AuditLog` `PAYOUT_STATUS_UPDATED` com `{ previousStatus, newStatus, note }`.

## 5. Aviso de estorno pós-repasse

Um pedido pode ser estornado depois que o repasse que o cobre já foi marcado `COMPLETED`
(`lib/payment/refund-service.ts:55-58` grava `Order.status = "REFUNDED"` diretamente, sem tocar em
`payoutId`). A lista `/admin/repasses` passa a sinalizar isso: a query de listagem inclui
`orders: { where: { status: "REFUNDED" }, select: { id: true }, take: 1 }`, e a linha da tabela
mostra um badge de aviso quando `payout.orders.length > 0` (ex.: "⚠ tem pedido estornado"). Não
mexe automaticamente no valor do repasse já registrado — é só um sinal visual pra alguém acertar
manualmente com o organizador. Extrai a checagem pra uma função pura testável em
`lib/admin/payouts.ts`: `hasPostPayoutRefund(orders: { status: string }[]): boolean`.

## 6. UI

- **`components/admin/GeneratePayoutButton.tsx`** (client) — botão "Gerar repasse" na página de
  evento do admin (`app/admin/eventos/[id]/page.tsx`, próximo aos cards financeiros já existentes
  — posição exata definida na hora do plano, lendo o arquivo atual). Ao clicar, busca o preview
  (`GET .../preview`), abre `ConfirmModal` (tone `"success"`) mostrando "X pedidos pagos — R$ Y
  bruto, R$ Z líquido a repassar", confirma → `POST`, `router.refresh()` em caso de sucesso,
  `ErrorModal` em caso de falha (zero pedidos elegíveis, erro de rede). Segue a convenção do
  CLAUDE.md — sem `confirm()`/`alert()` nativos.
- **`components/admin/UpdatePayoutStatusButton.tsx`** (client) — na lista `/admin/repasses`, nova
  coluna "Ações" com botões contextuais conforme o status atual (`PENDING` → 3 botões; `PROCESSING`
  → 2 botões; terminal → nenhum). Cada botão abre um `ConfirmModal` com `showNoteField` (nota
  opcional) específico daquela transição, `PATCH` ao confirmar, `router.refresh()`/`ErrorModal`
  igual ao botão de gerar.

## Testes

- `lib/admin/generate-payout.ts`: `computeEligiblePayoutTotals` (zero pedidos, soma correta) e
  `generatePayout` (evento não encontrado, zero pedidos elegíveis, sucesso — verifica
  `transferPayout.create` com os valores certos, `order.updateMany` com os ids certos, `auditLog`).
- `lib/admin/payouts.ts`: `hasPostPayoutRefund` (array vazio, sem estornados, com estornado).
- Novas rotas: `tests/admin-event-payouts-preview-route.test.ts`,
  `tests/admin-event-payouts-create-route.test.ts`, `tests/admin-payout-status-route.test.ts` — 403
  não-admin, 404, casos de erro (zero elegíveis / transição inválida), sucesso.
- `tests/backup-import-route.test.ts`: estender o payload de teste existente com um `orders` row
  contendo `payoutId`, verificar que `toOrderRow` propaga esse campo; adicionar as duas asserções
  de ordem que hoje não existem (`create:transferPayout` antes de `create:order`; `delete:order`
  antes de `delete:transferPayout`) — servem de proteção contra regressão futura na ordem FK-safe.

## Fora de escopo

- Reconciliação automática entre `TransferPayout.netAmount` e estornos ocorridos depois (só o
  aviso visual da seção 5, sem ajuste automático de valor).
- Concatenar histórico de notas — cada atualização de status substitui `notes`.
- Qualquer ação de repasse pelo organizador — o fluxo inteiro (gerar, marcar status) é admin-only;
  organizador continua só visualizando (`app/organizador/relatorio/page.tsx`), sem mudança de
  paridade aqui.
- Export CSV itemizado de repasses pro organizador (gap #3 do audit original) — não pedido.
- Mudar `app/organizador/relatorio/page.tsx` — o resumo lá já lê `TransferPayout` corretamente, só
  não tinha nenhuma linha entrando na tabela; passa a ter, sem mudança de código nessa página.
