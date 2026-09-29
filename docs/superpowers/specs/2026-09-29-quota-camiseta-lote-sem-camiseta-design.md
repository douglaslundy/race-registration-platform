# Quota de camiseta por tamanho + lote sem camiseta — Design

## Contexto

Hoje o tamanho de camiseta é sempre obrigatório na inscrição (correção recente) e os 6
tamanhos (`PP, P, M, G, GG, XGG`) ficam sempre disponíveis, exceto pela restrição por data já
existente (`shirtSizeRestrictionDate`/`shirtSizeRestrictionSizes`, ver
`docs/superpowers/specs/2026-08-12-restricao-tamanho-camiseta-por-data-design.md`). Dois
pedidos novos do organizador:

1. Definir quantas camisetas existem de cada tamanho; ao atingir o limite, aquele tamanho
   fica indisponível para novas inscrições. Tamanho sem quantidade informada = ilimitado.
2. Marcar, por lote, se ele inclui camiseta ou não. Lotes sem camiseta não exigem nem exibem
   o campo de tamanho no ato da inscrição.

## Objetivo

Permitir que o organizador configure um limite de unidades por tamanho de camiseta (por
evento) e que cada lote declare se inclui camiseta, com a inscrição respeitando os dois em
todos os pontos onde o tamanho de camiseta é definido ou alterado: inscrição nova, inscrição
por procuração, e edição de uma inscrição já existente pelo próprio atleta.

## Escopo

- Quota de camiseta por tamanho, configurada **por evento** (global, soma as inscrições de
  todos os lotes com camiseta daquele evento) — não por lote.
- Tamanho sem quota configurada = ilimitado (comportamento atual, sem mudança).
- Tamanho que atinge a quota **some** do `<select>` (não fica visível desabilitado) — mesmo
  padrão já usado pela restrição por data.
- Uma pequena tela pro organizador ver, por tamanho, quantas unidades já foram usadas e
  quantas foram configuradas (ou "ilimitado").
- `TicketBatch.hasShirt`: novo flag por lote, `default(true)` (nenhum lote existente muda de
  comportamento). Quando `false`: campo de camiseta não aparece nem é exigido na inscrição
  daquele lote.
- Reaplicar as duas regras (quota + `hasShirt`) na edição de uma inscrição já existente
  (`EditMyRegistrationButton.tsx` + `PATCH /api/athlete/registrations/[id]`), que hoje
  permite apagar o tamanho de uma inscrição sem nenhuma checagem.
- Enforcement de verdade sempre no servidor (dentro da mesma transação que já valida lote/
  percurso/categoria), nunca só no client.

## Fora de escopo

- Quota por lote (decidido: é por evento).
- Tela/indicador extra além do necessário para mostrar usado/limite (sem dashboard novo,
  sem gráfico — só uma lista simples na página de configurações do evento).
- Tratamento especial quando **todos** os tamanhos de um lote com camiseta esgotam a quota —
  o atleta vê um campo obrigatório sem opções; fica sob responsabilidade do organizador
  dimensionar a quota corretamente.
- Tela de admin separada — admin já reaproveita as páginas do organizador (`/lotes`,
  `/editar`) via `resolveActingScope`/`actingAsAdmin`, então os dois flags novos aparecem lá
  automaticamente.
- Relatórios existentes de camiseta (`lib/organizer/event-metrics.ts`,
  `GeneralReportTable.tsx`) — já tratam "sem tamanho" como um balde próprio; lotes sem
  camiseta caem nesse balde sem precisar de mudança nenhuma.
- Editar/organizar-editar o `shirtSize` de uma inscrição alheia (`AthleteDetailsModal.tsx`,
  rotas de admin/organizador) — hoje eles editam `preferredShirtSize` do perfil, não o
  `shirtSize` da inscrição; fora de escopo desta entrega.

## Dados

### Schema (`prisma/schema.prisma`)

```prisma
model TicketBatch {
  // ...campos existentes...
  hasShirt Boolean @default(true)
}

model EventShirtSizeQuota {
  id       String    @id @default(cuid())
  eventId  String
  size     ShirtSize
  quantity Int

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@unique([eventId, size])
  @@map("event_shirt_size_quotas")
}

model Event {
  // ...campos existentes...
  shirtSizeQuotas EventShirtSizeQuota[]
}
```

- `hasShirt` com `default(true)`: nenhum lote existente exige migração de dados, todos
  continuam pedindo camiseta como hoje.
- `EventShirtSizeQuota` é uma tabela nova e vazia — sem quota configurada, `quantity` nunca
  existe pra aquele `(eventId, size)`, e o tamanho é tratado como ilimitado (ausência de
  linha, não `quantity = 0`; `quantity = 0` é um valor válido e explícito pra "esgotar já").
- Requer migration Prisma nova.

### Por que quota "ao vivo" e não um contador denormalizado

`TicketBatch.soldCount` é incrementado na criação do checkout e **decrementado em ~5 lugares
diferentes** (`app/api/registrations/[id]/cancel/route.ts`,
`lib/payment/refund-service.ts`, `lib/registrations/cancellation-decision-service.ts`,
`lib/payment/sync-payment-status.ts`, `lib/payment/expire-payments.ts`). Replicar esse mesmo
padrão para quota por tamanho significaria tocar nos mesmos 5 fluxos, com risco real de um
decremento esquecido travar um tamanho permanentemente.

Em vez disso, a quota é sempre checada por **contagem ao vivo**:
`Registration.count({ eventId, shirtSize, status: { not: "CANCELLED" } })`. Correto
automaticamente em qualquer lugar que já muda o `status` de uma inscrição, sem lógica extra
pra manter sincronizada. Mesma janela de corrida (2 checkouts concorrentes passando a
checagem antes de qualquer commit) que a checagem de capacidade de lote já tem hoje e que o
projeto já aceita.

### Helper novo: `lib/shirt-size-quota.ts`

```ts
export function computeSoldOutShirtSizes(
  quotas: { size: string; quantity: number }[],
  usage: { size: string; count: number }[],
): string[]

export async function getSoldOutShirtSizes(eventId: string): Promise<string[]>
```

- `computeSoldOutShirtSizes` é pura (mesmo padrão de `getAllowedShirtSizes` em
  `lib/shirt-size-restriction.ts`) — recebe as quotas configuradas e o uso atual, devolve os
  tamanhos que atingiram o limite.
- `getSoldOutShirtSizes` busca `EventShirtSizeQuota` + `Registration.groupBy` (excluindo
  `CANCELLED`) e aplica a função pura. Usada pelas duas páginas que precisam saber "quais
  tamanhos sumem do select" (inscrição nova e edição de inscrição existente) — o checkout em
  si (`createCheckout`) faz sua própria checagem pontual dentro da transação (só o tamanho
  escolhido), não usa este helper.

## UI — lotes (`LotesClient.tsx` + APIs de lote)

- `app/api/events/[id]/batches/route.ts` (POST) e `.../[batchId]/route.ts` (PATCH): novo
  campo `hasShirt: z.boolean().optional()` nos dois schemas.
- Formulário "Novo lote" e modal "Editar lote": checkbox "Este lote inclui camiseta?",
  marcado por padrão.
- Card de cada lote na listagem: quando `hasShirt === false`, mostra um selo curto "Sem
  camiseta" ao lado do status, pra ficar visível sem precisar abrir o lote.

## UI — quota por tamanho (evento)

Novo endpoint `app/api/events/[id]/shirt-quotas/route.ts`:

- `GET`: devolve os 6 tamanhos com `{ size, quantity: number | null, usedCount: number }`
  (`quantity: null` = sem quota configurada = ilimitado). `usedCount` vem do mesmo
  `Registration.groupBy` usado em `getSoldOutShirtSizes`.
- `PUT`: recebe `{ quotas: { size, quantity: number | null }[] }` pros 6 tamanhos
  (`quantity: z.number().int().min(0).nullable()`). Salva substituindo tudo (`deleteMany` +
  `createMany` dentro de uma transação) — lista pequena e fixa, não precisa de diff
  incremental. `quantity: null` (ou ausente) não cria linha nenhuma para aquele tamanho.
- Permissão: `checkApiPermission("events.edit", { eventId })`, mesmo padrão de
  `app/api/events/[id]/route.ts`.

Novo componente `components/organizer/ShirtSizeQuotaManager.tsx` (client, autocontido — busca
e salva sozinho, mesmo padrão de `EventDailySummaryRecipientsManager.tsx`, não entra no
schema/submit gigante do `EditEventForm`). Renderizado em
`app/organizador/eventos/[id]/editar/page.tsx`, logo depois de `<EditEventForm>`:

- Uma linha por tamanho: rótulo do tamanho, input numérico (vazio = ilimitado), texto
  "usado: N" ao lado (read-only).
- Botão salvar único, chama o `PUT`. Erro inline (sem modal, não é uma ação destrutiva).

## UI — inscrição nova (`CheckoutForm.tsx` + `ProxyAthleteModal.tsx`)

- `Batch` (interface local) ganha `hasShirt: boolean`.
- `CheckoutForm` ganha prop `soldOutShirtSizes?: string[]` (default `[]`), calculada no
  server (`app/(public)/inscricao/[slug]/page.tsx`) via `getSoldOutShirtSizes(event.id)`.
- `allowedShirtSizes` passa a ser `getAllowedShirtSizes(event, new Date()).filter(s =>
  !soldOutShirtSizes.includes(s))` — combina restrição por data ∩ quota disponível.
- `showShirtSize = selectedBatch?.hasShirt !== false`. Quando `false`, o bloco inteiro do
  campo "Camiseta" desaparece do formulário (não fica só opcional — some).
- **Reverte parte da correção anterior**: como a obrigatoriedade agora depende do lote
  escolhido (não é mais incondicional), `shirtSize` volta a ser opcional no schema zod
  (`optionalEnumField`, que tinha virado `requiredEnumField` — volta ao helper original), e a
  obrigatoriedade passa a ser checada manualmente no `onSubmit`, no mesmo padrão já usado
  para `routeId`/`categoryId`:
  ```ts
  if (showShirtSize && !emptyStringToUndefined(data.shirtSize)) {
    setError("Selecione o tamanho de camiseta para concluir a inscrição.");
    return;
  }
  ```
- `ProxyAthleteModal` ganha prop `hasShirt: boolean` (repassada do `showShirtSize` do
  formulário principal); esconde o campo e pula a checagem de obrigatoriedade em
  `handleSave` quando `false`.

## UI — edição de inscrição existente

`app/dashboard/inscricoes/[id]/page.tsx`:

- Adiciona `hasShirt: true` ao `select` de `ticketBatch`, e
  `shirtSizeRestrictionDate/Sizes` ao `select` de `event`.
- Calcula `availableShirtSizes` = (tamanhos permitidos por data ∩ não esgotados) **∪** o
  tamanho atual da inscrição, se houver — grandfathering: um atleta que já escolheu um
  tamanho não perde a opção de mantê-lo só porque a quota fechou depois.
- Passa `hasShirt={registration.ticketBatch.hasShirt}` e `availableShirtSizes={...}` pro
  `EditMyRegistrationButton`.

`components/dashboard/EditMyRegistrationButton.tsx`:

- Novas props `hasShirt: boolean`, `availableShirtSizes: string[]`.
- Esconde o campo "Camiseta" inteiro quando `!hasShirt`.
- Opções do `<select>` passam a ser `availableShirtSizes` em vez da constante fixa
  `SHIRT_SIZES`.
- Antes de montar o `body` do PATCH, se `hasShirt` e o valor final ficar vazio: mesmo padrão
  do erro de nome em branco já existente (`setInlineError("Selecione o tamanho de
  camiseta."); return;`).

`app/api/athlete/registrations/[id]/route.ts`:

- `select` do `db.registration.findUnique` ganha `eventId: true`, `shirtSize: true`,
  `ticketBatch: { select: { hasShirt: true } }`, e o `event.select` ganha
  `shirtSizeRestrictionDate: true, shirtSizeRestrictionSizes: true`.
- Quando `b.shirtSize !== undefined` (campo enviado):
  - `!reg.ticketBatch.hasShirt` → ignora o valor enviado (não escreve `data.shirtSize`) —
    defesa em profundidade, já que a UI nem mostra o campo nesse caso.
  - `hasShirt` verdadeiro e `b.shirtSize === null` → `400` "Selecione o tamanho de
    camiseta." (não pode mais apagar).
  - `hasShirt` verdadeiro e um tamanho novo: valida contra `getAllowedShirtSizes(reg.event,
    new Date())` → `400` "Tamanho de camiseta indisponível para este evento" se não estiver
    na lista.
  - Se o tamanho realmente mudou (`b.shirtSize !== reg.shirtSize`): checa quota do tamanho
    novo (mesma lógica de `createCheckout`, ver abaixo) → `400` "Tamanho de camiseta esgotado
    para este evento" se cheio. Edição que mantém o mesmo tamanho nunca falha por quota,
    mesmo que o evento já tenha esgotado esse tamanho depois.

## Validação de verdade (`lib/checkout.ts`, dentro de `createCheckout`)

Substitui o bloco atual (que sempre exige `shirtSize`) por uma checagem condicionada ao
lote, que já foi buscado (`batch`) antes deste ponto:

```ts
if (batch.hasShirt) {
  if (!input.shirtSize) {
    throw new Error("Selecione o tamanho de camiseta para concluir a inscrição");
  }
  const allowedSizes = getAllowedShirtSizes(event, new Date());
  if (!allowedSizes.includes(input.shirtSize)) {
    throw new Error("Tamanho de camiseta indisponível para este evento");
  }
  const quota = await tx.eventShirtSizeQuota.findUnique({
    where: { eventId_size: { eventId: input.eventId, size: input.shirtSize } },
  });
  if (quota) {
    const usedCount = await tx.registration.count({
      where: { eventId: input.eventId, shirtSize: input.shirtSize, status: { not: "CANCELLED" } },
    });
    if (usedCount >= quota.quantity) {
      throw new Error("Tamanho de camiseta esgotado para este evento");
    }
  }
}
```

E na criação da `Registration`: `shirtSize: batch.hasShirt ? input.shirtSize : undefined`
(ignora qualquer valor recebido quando o lote não tem camiseta).

`CheckoutInput.shirtSize` volta a ser opcional (`shirtSize?: ShirtSize`) — deixa de ser
sempre obrigatório no tipo, já que agora depende do lote.

`app/api/checkout/route.ts`: `shirtSize` volta a `optionalEnumField(...)` no
`checkoutSchema` (a obrigatoriedade condicional já é garantida dentro de `createCheckout`,
mesmo padrão de `routeId`/`categoryId`, que também são sempre opcionais no schema da API).

## Testes

- `lib/shirt-size-quota.ts`: testes da função pura `computeSoldOutShirtSizes` (sem quota,
  abaixo do limite, no limite, acima do limite, múltiplos tamanhos).
- `lib/checkout.ts` / `tests/unit/checkout-shirt-size-restriction.test.ts`: novos casos —
  `hasShirt: false` não exige nem grava tamanho mesmo se enviado; quota esgotada rejeita;
  quota não configurada = ilimitado; quota configurada mas não esgotada aceita.
- **Retrabalho esperado nos testes existentes de `createCheckout`**: como `batch.hasShirt`
  passa a existir e gatilha toda a lógica de obrigatoriedade, os mocks de `ticketBatch` em
  `checkout-coupon.test.ts`, `checkout-pix-discount.test.ts`, `checkout-notes.test.ts`,
  `checkout-participant-snapshot-wiring.test.ts`, `checkout-proxy-athlete.test.ts` e
  `checkout-shirt-size-restriction.test.ts` precisam ganhar `hasShirt: true` explícito, e o
  `tx` mockado em cada um desses arquivos precisa de
  `eventShirtSizeQuota: { findUnique: vi.fn().mockResolvedValue(null) }`. Sem isso, `batch
  .hasShirt` viria `undefined` (falsy) nesses mocks e a validação de camiseta seria pulada
  silenciosamente, quebrando o que esses testes já verificam hoje.
- `tests/checkout-route.test.ts` / `tests/checkout-payment-account.test.ts`: sem mudança
  necessária (`createCheckout` é mockado nesses arquivos; só o schema da API muda, e
  `shirtSize` volta a ser opcional — os testes que já mandam `shirtSize: "M"` continuam
  passando).
- Novo `tests/api-events-shirt-quotas-route.test.ts` (GET/PUT).
- Novo teste pro schema/handler de `app/api/athlete/registrations/[id]/route.ts`: não deixa
  apagar quando `hasShirt`, valida quota só quando o tamanho muda, ignora o campo quando
  `!hasShirt`.
- `checkout-validation.test.ts`: volta a testar `optionalEnumField` (desfaz o teste de
  `requiredEnumField` da entrega anterior).
