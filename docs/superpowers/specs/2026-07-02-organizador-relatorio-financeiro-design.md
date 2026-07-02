# Design: relatório financeiro para o ambiente do organizador

Sub-projeto 3 de um conjunto maior de pedidos. Cria uma página nova (`/organizador/relatorio`) — não modifica nenhuma página, rota ou lógica de negócio já existente, exceto a adição de um link de navegação.

## Contexto (o que já existe)

- `app/organizador/page.tsx` (dashboard) já mostra receita agregada (`orders: { where: { status: "PAID" } }` — já correto, exclui cancelados) e contagem de inscrições por status, mas é só um resumo dos últimos 10 eventos, sem filtro de período/evento e sem detalhamento financeiro.
- `app/organizador/eventos/[id]/page.tsx` mostra receita bruta por evento individual, sem quebra de taxa ou repasse.
- Existe um sistema de **repasses** (`TransferPayout`: `grossAmount`, `platformFee`, `netAmount`, `status`, relações diretas `eventId` e `organizerId`) já em produção, mas **hoje só é visível para o admin** em `/admin/repasses` (`lib/admin/payouts.ts` + `app/admin/repasses/page.tsx`). `PayoutStatus` tem 4 valores: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`. O organizador nunca vê isso, mesmo sendo o dinheiro que ele vai receber.
- `lib/admin/report.ts` (sub-projeto 2) já tem o padrão correto de "receita bruta exclui pedidos cancelados" — este sub-projeto replica o mesmo padrão desde o início, sem herdar o bug antigo.
- Navegação do organizador (`components/organizer/OrganizerNav.tsx`): hoje só tem Dashboard | Meus Eventos | Novo Evento | Perfil.

## Decisões (confirmadas com o usuário)

1. **Inclui repasses.** O organizador passa a ver, pela primeira vez, o líquido a receber por evento e o status de cada repasse.
2. **Filtros de período (De/Até) e evento**, iguais ao padrão do admin — mas o evento só lista os eventos do próprio organizador, e todo dado é automaticamente restrito a `organizerId` (nunca selecionável, nunca vaza dado de outro organizador).
3. **Exportação CSV + PDF**, seguindo o padrão já usado em todas as outras telas de relatório do sistema.

## Arquitetura

Novo módulo `lib/organizer/report.ts` (mesmo espírito de `lib/admin/report.ts`, mas com `organizerId` obrigatório em vez de opcional, já que aqui a restrição por organizador não é um filtro — é uma regra de segurança):

```ts
export interface OrganizerReportFilter {
  organizerId: string;
  from: Date;
  to: Date;
  eventId?: string;
}

buildOrganizerPaymentWhere(filter, orderStatus: "PAID" | "CANCELLED"): Prisma.PaymentWhereInput
// { status: "PAID", paidAt: {gte,lte}, order: { status: orderStatus, event: { organizerId }, ...(eventId ? {eventId} : {}) } }

buildOrganizerOrderWhere(filter, status?: "PAID"): Prisma.OrderWhereInput
// { event: { organizerId }, createdAt: {gte,lte}, ...(status ? {status} : {}), ...(eventId ? {eventId} : {}) }

buildOrganizerPayoutWhere(filter): Prisma.TransferPayoutWhereInput
// { organizerId, createdAt: {gte,lte}, ...(eventId ? {eventId} : {}) }
```

Essas três funções puras são a única fonte de where-clause do módulo — testadas isoladamente, sem tocar no banco, seguindo o mesmo padrão de `lib/admin/report.ts` e `lib/organizer/registrations.ts` (sub-projeto 1).

## Página `app/organizador/relatorio/page.tsx`

Server component, autenticado via `requireOrganizer()` + `db.organizerProfile.findUnique({ where: { userId } })` (mesmo padrão de `app/organizador/page.tsx`). Recebe `searchParams: { de?, ate?, eventId? }`.

**KPIs (grade no topo):**
- Receita bruta — `buildOrganizerPaymentWhere(filter, "PAID")`, soma `Payment.amount`.
- Pagamentos cancelados — `buildOrganizerPaymentWhere(filter, "CANCELLED")`, mesmo conceito do sub-projeto 2 (pago e depois cancelado).
- Estornos — `db.refund.aggregate` com `where: { payment: { order: { event: { organizerId }, ...(eventId?{eventId}:{}) } }, createdAt: {gte,lte} } }` (tabela vazia hoje, mesma ressalva do admin).
- Receita líquida = bruta − estornos.
- **Repasse líquido a receber** — soma de `TransferPayout.netAmount` via `buildOrganizerPayoutWhere(filter)`.

**Bloco de repasses:**
- 4 mini-cards com contagem+soma por `PayoutStatus` (Pendente/Processando/Concluído/Falhou), usando `PAYOUT_STATUS_LABEL` (novo, adicionado a `lib/admin/labels.ts` — já é o local centralizado de todo label de status no sistema, reaproveitado aqui como em outras páginas fora do admin já fazem com `formatCurrency`/`formatDate` de `lib/format.ts`).
- Tabela com os repasses do período/evento filtrado: Evento, Bruto, Taxa, Líquido, Status, Data.

**Filtros:** formulário GET com `de`, `ate`, `eventId` (dropdown só com eventos do organizador: `db.event.findMany({ where: { organizerId }, select: { id: true, title: true } })`).

**Exportação:** botão "Exportar CSV" apontando para nova rota `app/api/organizer/report/export/route.ts` (mesma autenticação, mesmos filtros via query string, gera CSV com as mesmas métricas da tela) e `<PrintButton />` já existente para PDF (impressão do navegador, sem rota nova).

## Navegação

`components/organizer/OrganizerNav.tsx`: novo link "Relatório" entre "Meus Eventos" e "Novo Evento", apontando para `/organizador/relatorio`, no menu desktop e mobile.

## Fora de escopo

- Nenhuma criação/edição de repasse (isso continua sendo função exclusiva do admin em `/admin/repasses`).
- Nenhuma mudança em `app/organizador/page.tsx` (dashboard) ou em qualquer página de evento individual.
- Nenhuma mudança em `/admin/repasses` ou `lib/admin/payouts.ts`.

## Testes

- Testes unitários para as três funções puras de `lib/organizer/report.ts`, seguindo o mesmo padrão de `tests/admin-report-helpers.test.ts` (sub-projeto 2): casos sem `eventId`, com `eventId`, e com cada valor de `orderStatus`/`status`.
- Página e rota de export não são testadas automaticamente (convenção já estabelecida — só os helpers puros o são); verificação manual no navegador cobre o resto.
