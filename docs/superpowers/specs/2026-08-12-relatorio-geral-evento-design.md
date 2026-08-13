# Relatório Geral por evento — Design

## Contexto

Hoje a única visão completa dos inscritos de um evento é `/inscritos` (organizador e
admin): mostra todos os status, tem botões de ação (cancelar, reembolsar, reenviar
e-mail), pagina de 50 em 50, e esconde alergias/contato de emergência dentro de um modal
por atleta. Não existe uma visão só-leitura, focada só nos confirmados, com os dados de
segurança visíveis direto na tabela — útil pro organizador consultar ou imprimir no dia
do evento.

## Objetivo

Uma tela nova, "Relatório Geral", por evento, com todas as inscrições **confirmadas**
numa lista só, mostrando nome, CPF, e-mail, telefone, percurso/categoria/lote, tamanho de
camiseta, contato de emergência, alergias/observações médicas, valor pago, forma de
pagamento e data de confirmação.

## Escopo

- Só inscrições com `status: "CONFIRMED"` — sem filtro de status (diferente de
  `/inscritos`, que mostra todos e permite filtrar).
- Sem paginação — lista completa numa página só.
- Sem botões de ação (cancelar, reembolsar, reenviar) — é relatório, não tela de gestão.
- Mesma extensão nas duas telas onde as outras páginas de evento já existem: organizador
  e admin.
- Impressão via o `PrintButton` padrão (`window.print()`) — a correção recente de
  impressão já deixa nav/filtros/chrome escondidos em qualquer página (`print:hidden`
  global), e como esta tela não pagina, não precisa do mecanismo `?print=1` criado pra
  `/inscritos`.
- Exportação CSV reaproveitando o endpoint existente
  `/api/events/[id]/registrations?format=csv`, estendido com um parâmetro `status`
  opcional e duas colunas que faltam nele hoje (Telefone, Valor Pago).

## Fora de escopo

- Filtros (percurso, categoria, lote, cupom, forma de pagamento, busca) — fica só no
  `/inscritos`, que já tem isso.
- Qualquer mudança de comportamento no `/inscritos` além da extensão do endpoint CSV
  (que também é usado por lá).
- Página pública do evento.

## Dados

### Query

Uma query nova (sem paginação, sem filtros de UI):

```ts
db.registration.findMany({
  where: { eventId: id, status: "CONFIRMED" },
  include: {
    athlete: {
      select: { name: true, email: true, athleteProfile: { select: { cpf: true, phone: true } } },
    },
    route: { select: { name: true } },
    category: { select: { name: true } },
    ticketBatch: { select: { name: true } },
    order: { select: { id: true, totalAmount: true } },
  },
  orderBy: { athlete: { name: "asc" } },
})
```

Forma de pagamento e data de confirmação vêm do último pagamento de cada pedido — mesmo
padrão de busca em lote (`db.payment.findMany({ where: { orderId: { in: orderIds } },
orderBy: { createdAt: "desc" } })`) já usado em `/inscritos`, pra evitar N+1.

### Endpoint CSV estendido

`app/api/events/[id]/registrations/route.ts`:

- Acrescenta `Telefone` (de `athleteProfile.phone`) e `Valor Pago` (de
  `order.totalAmount`, formatado como os outros valores monetários do sistema) às
  colunas do CSV.
- Passa a aceitar `?status=CONFIRMED` (opcional) no `where` — sem o parâmetro, comportamento
  idêntico ao de hoje (todos os status, usado pelo botão de exportar do `/inscritos`).

## UI

### Páginas novas

`app/organizador/eventos/[id]/relatorio-geral/page.tsx` e
`app/admin/eventos/[id]/relatorio-geral/page.tsx`: cabeçalho (título do evento + total de
confirmados), botões "Exportar CSV" (linkando pro endpoint com `&status=CONFIRMED`) e
"Imprimir PDF" (`PrintButton` padrão), e a tabela.

### Componente novo

`components/registrations/GeneralReportTable.tsx` — tabela só-leitura (sem
`renderActions`, sem modal), uma linha por inscrição confirmada, com as colunas listadas
no objetivo. Segue o mesmo estilo visual de `RegistrationsTable` (`card overflow-x-auto`,
`text-xs`, mesmas classes de impressão já adicionadas nela).

### Links de navegação

Acrescentar `<Link href={.../relatorio-geral}>Relatório Geral</Link>` na linha de Ações
de `app/organizador/eventos/[id]/page.tsx` (ao lado de "Ver inscritos" / "Importar
resultados") e de `app/admin/eventos/[id]/page.tsx` (ao lado de "Ver inscritos" /
"Exportar inscritos CSV" / "Ver página pública").
