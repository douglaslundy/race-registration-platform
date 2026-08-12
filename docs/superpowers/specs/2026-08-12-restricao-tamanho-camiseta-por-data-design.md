# Restrição de tamanho de camiseta por data — Design

## Contexto

Hoje o checkout (`components/checkout/CheckoutForm.tsx`) sempre oferece os 6 tamanhos de
camiseta (`PP, P, M, G, GG, XGG`) pra qualquer inscrição, em qualquer momento. O organizador
quer poder configurar, por evento, uma data a partir da qual só um subconjunto de tamanhos
continua disponível para novas inscrições — por exemplo: "a partir de 20/09, só G".

## Objetivo

Permitir que o organizador configure, por evento, uma data de corte + um conjunto de
tamanhos que continuam disponíveis a partir dela. Antes da data (ou sem restrição
configurada), todos os 6 tamanhos continuam disponíveis, como hoje. Inscrições já feitas
antes do corte não são afetadas retroativamente.

## Escopo

- Configuração por evento, feita pelo organizador (não é regra global do admin).
- Uma única regra por evento: uma data + um conjunto de tamanhos que sobra depois dela
  (não uma sequência de múltiplos cortes).
- Tamanhos fora do conjunto permitido somem do `<select>` do checkout depois da data (não
  ficam visíveis desabilitados).
- Um aviso curto aparece no checkout quando a lista de tamanhos foi reduzida.

## Fora de escopo

- Página pública do evento (`app/(public)/eventos/[slug]/page.tsx`).
- O card "Camisetas" do relatório do evento (`lib/organizer/event-metrics.ts` /
  `computeShirtSizeBreakdown`) — continua mostrando todos os 6 tamanhos + "sem tamanho
  informado", refletindo o que já foi escolhido historicamente; não precisa saber da
  restrição.
- Múltiplas datas de corte em sequência.
- Exibição da restrição no painel do admin.

## Dados

### Schema (`prisma/schema.prisma`, model `Event`)

Dois campos novos, seguindo o padrão de campo opcional já usado por `cancellationDeadline`:

```prisma
shirtSizeRestrictionDate  DateTime?
shirtSizeRestrictionSizes ShirtSize[]
```

- `shirtSizeRestrictionDate` null = restrição desligada (comportamento atual).
- `shirtSizeRestrictionSizes` é um array nativo do Postgres (suportado nativamente pelo
  Prisma neste schema, ainda que seja o primeiro campo de lista escalar usado aqui — os
  demais arrays no schema são todos relações one-to-many).
- Requer uma migration Prisma nova (`prisma migrate dev` local; `prisma migrate deploy` ou
  `db push` em produção, registrado em `PROGRESSO.md`/memória do processo de deploy).

### Helper compartilhado

Novo arquivo `lib/shirt-size-restriction.ts`, no mesmo padrão de `lib/batch-status.ts`
(função pura, importável tanto em Server Components quanto em Client Components):

```ts
export function getAllowedShirtSizes(
  event: { shirtSizeRestrictionDate: Date | null; shirtSizeRestrictionSizes: string[] },
  now: Date = new Date(),
): string[]
```

- Sem `shirtSizeRestrictionDate` (null), ou `now < shirtSizeRestrictionDate`: retorna os 6
  tamanhos (`["PP","P","M","G","GG","XGG"]`).
- `now >= shirtSizeRestrictionDate`: retorna `event.shirtSizeRestrictionSizes` (se por
  algum motivo vier vazio, cai de volta pros 6 — defensivo, já que a UI de edição exige
  pelo menos 1 tamanho quando a data é preenchida).

## UI — edição do evento

`components/organizer/EditEventForm.tsx` + `app/api/events/[id]/route.ts` (`updateEventSchema`
e o `PATCH`), seguindo exatamente o padrão já usado por `cancellationDeadline` /
`cancellationRequiresApproval`:

- Novo campo `datetime-local` opcional: "Restringir tamanhos de camiseta a partir de".
- 6 checkboxes (um por `ShirtSize`), habilitados/relevantes só quando a data está
  preenchida.
- Validação no form: se a data for preenchida, exige pelo menos 1 tamanho marcado (erro
  inline, mesmo padrão dos outros campos condicionalmente obrigatórios do formulário).
- Persistência: mesmo padrão condicional (`...(parsed.data.X !== undefined ? {...} : {})`)
  já usado pros outros campos do `PATCH`.

## UI — checkout

`components/checkout/CheckoutForm.tsx`:

- O `<select {...register("shirtSize")}>` passa a mapear `getAllowedShirtSizes(event,
  new Date())` em vez do array fixo `["PP","P","M","G","GG","XGG"]`.
- Quando o resultado do helper for menor que 6 tamanhos, um texto curto aparece abaixo do
  select, citando a data configurada (formatada), ex.: "Alguns tamanhos deixaram de estar
  disponíveis a partir de 20/09/2026."
- Esse filtro no client é só UX — não é o que garante a regra (ver validação de verdade
  abaixo).

## Validação de verdade (checkout)

`lib/checkout.ts`, dentro de `createCheckout`, logo após buscar `event` (linha ~58-59
atual, onde já existe a checagem `event.status !== "REGISTRATIONS_OPEN"`):

```ts
if (input.shirtSize) {
  const allowedSizes = getAllowedShirtSizes(event, new Date());
  if (!allowedSizes.includes(input.shirtSize)) {
    throw new Error("Tamanho de camiseta indisponível para este evento");
  }
}
```

Mesmo padrão de erro já usado ali pra percurso/categoria inválidos (`throw new Error(...)`,
capturado pela rota `/api/checkout` e devolvido como 400).

## Testes

- `tests/unit/shirt-size-restriction.test.ts`: testes do helper puro — sem restrição, antes
  da data, depois da data, array vazio (fallback pros 6).
- `tests/unit/checkout-shirt-size-restriction.test.ts`: segue o padrão de
  `tests/unit/checkout-notes.test.ts` (mock de `db.$transaction`) — confirma que
  `createCheckout` aceita um tamanho permitido e rejeita um tamanho fora da lista quando a
  data de corte já passou.
