# Home pública lista eventos (Etapa 6) — Design

## Contexto

Etapa 6 do mega-prompt de 10 etapas. Auditoria da Etapa 1 (`IMPLEMENTATION_PLAN.md` §2.5) já
confirmou: `app/(public)/page.tsx` hoje é só um hero estático (título + 2 botões), não lista nenhum
evento. A listagem pública real já existe em `app/(public)/eventos/page.tsx`
(filtro/paginação/`EventCard`/`getBatchStatus`, via `listPublicEvents` em `lib/events.ts`).

## Decisão de formato

A home ganha uma **prévia de eventos** (não vira a listagem completa). `/eventos` continua existindo
exatamente como está hoje, com todos os seus filtros e paginação — a home só ganha uma seção nova
que convida a visitar `/eventos`.

## Estrutura da nova home (`app/(public)/page.tsx`)

1. Hero atual, mantido como está (nome da plataforma + botões "Ver Eventos"/"Criar Conta") — sem
   mudança.
2. `EventsBanner` (banner rotativo já existente em `components/events/EventsBanner.tsx`),
   reaproveitado sem alteração.
3. Novo slot de anúncio, posição `HOME_ABAIXO_BANNER` (via `AdSlotRenderer`, que já aceita qualquer
   string de posição — sem migração de schema).
4. Seção "Próximos eventos": título + grid de 6 `EventCard`s (mesmo componente de `/eventos`),
   vindos de `listPublicEvents({ pageSize: 6 })` — sem filtro nenhum. `listPublicEvents` já ordena
   por `startAt` ascendente para eventos não encerrados (comportamento padrão da função, ver
   `lib/events.ts:40`), então isso já entrega "os 6 próximos eventos por data" sem lógica nova.
   **Se a lista vier vazia, a seção inteira (título + grid) não renderiza** — diferente de
   `/eventos`, que é uma página de busca e mostra "Nenhum evento encontrado"; a home é uma página de
   entrada/marketing, então uma seção vazia simplesmente some.
5. Botão "Ver todos os eventos" → `/eventos`, abaixo do grid (só aparece junto com a seção, ou seja,
   também some se a lista vier vazia).
6. Novo slot de anúncio, posição `HOME_ENTRE_EVENTOS_CTA`.
7. `OrganizerCTA` (já existente em `components/events/OrganizerCTA.tsx`), reaproveitado sem
   alteração, no rodapé.

## O que não muda

- `/eventos` continua idêntico: mesmos filtros, paginação, banner, 3 posições de anúncio
  (`EVENTOS_ABAIXO_BANNER`, `EVENTOS_COLUNA_ESQUERDA`, `EVENTOS_ENTRE_RESULTADOS`), `OrganizerCTA`.
- Nenhuma migração de **schema** — a tabela `AdSlot` já existe com todas as colunas necessárias.
  **Correção após investigação (não havia flow de criação pelo admin como o design original
  supunha):** `AdSlot` não tem uma tela de "criar novo slot" — `/admin/anuncios` só lista e
  configura slots que já existem (`lib/ad-slots.ts::listAdSlots`/`updateAdSlot`, sem `create`). Os 5
  slots atuais (`EVENTOS_ABAIXO_BANNER` etc.) foram inseridos uma única vez via `INSERT INTO
  "ad_slots"` manual contra produção (mesmo padrão manual já usado pro seed de `MessageTemplate`
  nesta sessão). As 2 posições novas da home seguem o mesmo caminho: 2 linhas de `INSERT` a rodar
  manualmente contra produção depois do deploy — documentado no plano de implementação, não
  automático.
- Nenhum campo novo no `Event` — a seleção dos eventos da prévia é 100% derivada (próximos por
  data), sem curadoria manual, sem tela de admin nova.
- Sem JSON-LD novo para os eventos listados na home — a home já emite `Organization` JSON-LD hoje;
  adicionar `ItemList`/`Event` JSON-LD fica fora de escopo (nem `/eventos` tem isso hoje, então não
  é uma regressão, é simplesmente não pedido).

## Testes

Sem teste de componente dedicado para a página em si (convenção já estabelecida no projeto: páginas
Server Component / componentes `"use client"` não têm teste dedicado, salvo lógica de negócio
extraída pra função pura testável — ver `IMPLEMENTATION_PLAN.md` §2.6). Como a home passa a fazer
uma chamada real a `listPublicEvents`, o teste cobre:
- `listPublicEvents` é chamado com `{ pageSize: 6 }` (sem `city`/`state`/`modality`/`status`/`from`/
  `to`).
- Quando `listPublicEvents` retorna uma lista vazia, a seção "Próximos eventos" (e o botão "Ver
  todos") não aparece no HTML renderizado.
- Quando retorna eventos, os `EventCard`s aparecem (checagem simples de presença, não de conteúdo
  detalhado — isso já é coberto pelos testes existentes de `EventCard`/`/eventos`, se houver).

## Critérios de aceite

- Home (`/`) mostra hero + banner + até 6 próximos eventos (grid, mesmo `EventCard` de `/eventos`)
  + botão "Ver todos" + CTA de organizador.
- Seção de eventos some completamente quando não há eventos futuros publicados.
- `/eventos` permanece 100% inalterado em comportamento e visual.
- 2 novos slots de anúncio (`HOME_ABAIXO_BANNER`, `HOME_ENTRE_EVENTOS_CTA`) configuráveis em
  `/admin/anuncios`, independentes dos slots de `/eventos`.
- Suíte completa + `tsc --noEmit` + `npm run build` limpos, mesma exigência de sempre.
