# Filtros de status (ativa/encerrada) e estado na página pública de eventos

## Contexto

Primeiro de 4 sub-projetos independentes pedidos pelo usuário nesta sessão (ordem definida:
**filtros de eventos** → caixa de entrada de alertas → anúncios/Google-Meta Ads → marketplace de
anunciantes privados — os 2 últimos com dependência entre si).

Hoje `app/(public)/eventos/page.tsx` só filtra por cidade, modalidade e intervalo de data. A query
em `lib/events.ts:listPublicEvents` restringe a listagem a `status IN (PUBLISHED,
REGISTRATIONS_OPEN, SOLD_OUT)` — eventos com inscrições encerradas (`REGISTRATIONS_CLOSED`) ou já
realizados (`COMPLETED`) não aparecem em lugar nenhum da página pública hoje. Não existe filtro de
estado (UF); o campo `Event.state` é uma string livre de 2 letras preenchida pelo organizador no
cadastro (`components/organizer/EventForm.tsx`), sem normalização garantida de caixa.

## Decisões confirmadas com o usuário

- **Ativa vs encerrada**: Ativa = `PUBLISHED`, `REGISTRATIONS_OPEN`, `SOLD_OUT` (igual a hoje).
  Encerrada = `REGISTRATIONS_CLOSED`, `COMPLETED` (passam a ser listáveis publicamente pela
  primeira vez, só sob esse filtro). `DRAFT`, `UNDER_REVIEW`, `CANCELLED` continuam nunca
  aparecendo no público — isso não muda.
- **Padrão sem filtro**: continua mostrando só "ativas", preservando o comportamento atual da
  página quando nenhum filtro é aplicado.
- **Lista de estados**: dinâmica (só UFs que têm pelo menos um evento listável), no mesmo padrão
  do filtro de cidade já existente — não uma lista fixa das 27 UFs.
- **Cidade x Estado**: em cascata. Selecionar um estado estreita as opções de cidade pra só
  aquele estado.

## 1. `lib/events.ts`

### `listPublicEvents`

```ts
export interface EventFilters {
  city?: string;
  state?: string;          // novo
  modality?: EventModality;
  from?: Date;
  to?: Date;
  status?: "ativa" | "encerrada"; // novo, default "ativa"
  page?: number;
  pageSize?: number;
}
```

- `status` mapeia para o `where.status.in`:
  - `"ativa"` (ou ausente) → `["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT"]` (igual ao array
    atual, hardcoded hoje).
  - `"encerrada"` → `["REGISTRATIONS_CLOSED", "COMPLETED"]`.
- `state`, quando presente, entra no `where` como `{ state: { equals: state, mode:
  "insensitive" } }` (comparação exata, não `contains` — diferente do filtro de cidade — já que
  UF é um valor curto e fechado, mesmo sem constraint de enum no banco).
- `orderBy`: `startAt: "asc"` quando `status !== "encerrada"` (comportamento atual, próxima
  corrida primeiro); `startAt: "desc"` quando `status === "encerrada"` (corrida mais recente
  primeiro — faz mais sentido pra eventos já realizados do que mostrar o mais antigo).

### `listDistinctCities` → renomear para `listDistinctLocations`

- Amplia o filtro de status de `["PUBLISHED", "REGISTRATIONS_OPEN"]` (incompleto até hoje — nem
  cobria `SOLD_OUT`) para o conjunto completo de status listáveis publicamente: `["PUBLISHED",
  "REGISTRATIONS_OPEN", "SOLD_OUT", "REGISTRATIONS_CLOSED", "COMPLETED"]`. Sem essa ampliação, o
  dropdown de cidade/estado ficaria incompleto quando o usuário filtrasse por "encerradas".
  Retorna `{ city, state }[]` como hoje — usado tanto pro dropdown de cidade quanto (derivado no
  componente) pro de estado, sem query adicional.
- Chamadores atualizados: `app/(public)/eventos/page.tsx`.

## 2. `components/events/EventFilters.tsx`

Props: `cities` renomeado para `locations: { city: string; state: string }[]`.

Novos controles, nesta ordem (do mais amplo pro mais específico, acima do filtro de cidade
existente):

1. **Select "Status"** — 2 opções: "Ativas" (padrão, sem parâmetro na URL) e "Encerradas"
   (`?status=encerradas`). Sem opção "todas" — não foi pedida.
2. **Select "Estado"** — opções derivadas de `Array.from(new Set(locations.map(l => l.state)))`,
   ordenadas alfabeticamente. Parâmetro de URL `estado`.

Cascata: o select de cidade filtra suas opções de `locations` pelo `estado` selecionado (client-
side, sem nova requisição). Ao trocar de estado, se a cidade selecionada atualmente não pertence
ao novo estado, o parâmetro `cidade` é removido da URL junto com a troca de `estado` (evita
combinação impossível estado+cidade sem resultados).

`updateFilter` (já existente) é reaproveitado para os 2 novos parâmetros — já reseta `pagina` a
cada mudança de filtro. O botão "Limpar filtros" (`router.push("/eventos")`) já limpa os novos
parâmetros junto, sem mudança necessária.

## 3. `components/events/EventCard.tsx`

Novo badge em `STATUS_BADGE`:

```ts
COMPLETED: { label: "Realizado", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
```

Necessário porque eventos `COMPLETED` passam a poder aparecer na listagem (sob o filtro
"encerradas") e hoje não têm badge nenhum — `REGISTRATIONS_CLOSED` já tem ("Encerrado", cinza).

## 4. `app/(public)/eventos/page.tsx`

- `SearchParams` ganha `estado?: string` e `status?: string`.
- Repassa ambos para `listPublicEvents` (`state: params.estado`, `status: params.status as
  "ativa" | "encerrada" | undefined` — qualquer valor diferente de `"encerrada"` é tratado como
  ausente/padrão, sem validação estrita necessária já que só o próprio `EventFilters` gera esse
  parâmetro).
- Troca `listDistinctCities()` por `listDistinctLocations()`, passa como `locations` para
  `EventFilters`.

## Casos de borda cobertos

- Estado sem cidades correspondentes: dropdown de cidade mostra só "Todas as cidades".
- Paginação resetada a cada mudança de filtro (reaproveita lógica existente).
- Evento com `state` em caixa diferente (ex.: organizador digitou "sp" em vez de "SP"): comparação
  `insensitive` evita que ele suma do filtro por estado; a exibição (`EventCard`, dropdown) mostra
  o valor como está salvo, sem normalizar — fora de escopo corrigir a entrada de dados aqui.

## Fora de escopo

- Normalizar/validar o campo `Event.state` no cadastro do organizador (constraint de enum ou
  uppercase automático) — não foi pedido, e mexe em outro fluxo (`EventForm.tsx`).
- Filtro "todas" combinando ativas + encerradas de uma vez.
- Qualquer mudança na listagem de eventos do admin/organizador (`/admin/eventos`,
  `/organizador/eventos`) — este spec cobre só a página pública `/eventos`.
