# Design: KPIs e filtros — página do evento e página de inscritos (organizador)

Sub-projeto 1 de um conjunto maior de pedidos (ver histórico de conversa). Este spec cobre **apenas** ajustes de exibição/filtro/ordenação nas páginas `app/organizador/eventos/[id]/page.tsx` e `app/organizador/eventos/[id]/inscritos/page.tsx`. Não altera nenhuma lógica de negócio (pagamento, checkout, cancelamento, cálculo de `soldCount`).

## Contexto atual

- `Event.maxParticipants` (`Int?`) é o único campo de "limite geral do evento"; `null` = ilimitado. Hoje não é exibido em nenhum lugar da área do organizador.
- `TicketBatch.capacity`/`soldCount` são por lote, sempre obrigatórios (lote nunca é "ilimitado").
- O card "Vagas totais" na página do evento hoje soma `capacity` de todos os lotes, ignorando `maxParticipants`.
- O card "Inscrições" mostra `_count.registrations` (todas, qualquer status), sem quebra por status.
- O bloco "Uso de cupons" (cupons criados / pedidos com cupom / desconto concedido) já existe, mas fica depois da grade Lotes/Percursos/Categorias/Cupons.
- A página de inscritos é 100% server-side, sem `searchParams`, sem filtro, sem ordenação configurável (ordena fixo por `createdAt asc`). Colunas atuais: Atleta, Percurso, Categoria, Lote, Camiseta, Pagamento, Valor, Data pag. (só data, sem hora), Status.
- `Registration.createdAt` e `Payment.paidAt` já existem no schema com precisão de hora.
- `/admin/pagamentos` já estabelece o padrão de filtro/ordenação server-side via `searchParams` + `<form method="GET">` + links de ordenação com seta indicando direção — este spec segue o mesmo padrão.

## A) Página do evento

### A1. Quebra de status no card "Inscrições"
O card mantém o número total no topo. Abaixo, uma linha pequena com a contagem por status, obtida via `db.registration.groupBy({ by: ["status"], where: { eventId } })`:
- Pagas = `CONFIRMED`
- Pendentes = `PENDING_PAYMENT`
- Canceladas = `CANCELLED`

Estados `TRANSFERRED`/`WAITLISTED`, se existirem, não entram nessa linha (fora de escopo — o total do topo continua contando todas).

### A2. Card "Vagas totais" com vagas restantes
- Se `event.maxParticipants` não for `null`: mostra `maxParticipants` como total, e uma linha "restantes: N", onde N = `maxParticipants - (registrations com status CONFIRMED ou PENDING_PAYMENT)`, com piso em 0.
- Se `event.maxParticipants` for `null`: mantém o comportamento atual (soma de `capacity` dos lotes) e adiciona "restantes: N", onde N = `soma(capacity) - soma(soldCount)` dos lotes, com piso em 0.

### A3. Reposicionar bloco "Uso de cupons"
Move o bloco (já implementado, sem mudança de conteúdo) para logo após a grade de 3 KPIs do topo (A1/A2 + Receita) e antes da grade Lotes/Percursos/Categorias/Cupons. Continua condicional a `event.coupons.length > 0`.

## B) Página de inscritos

Passa a receber `searchParams: Promise<{ status?: string; sort?: string; dir?: string }>`, seguindo o padrão de `/admin/pagamentos`.

### B1. Filtro por status
`<form method="GET">` com um `<select name="status">` usando as chaves de `REGISTRATION_STATUS` já definidas na página (`PENDING_PAYMENT`, `CONFIRMED`, `CANCELLED`, `TRANSFERRED`, `WAITLISTED`) + opção "Todos" (vazio). Aplica `where: { eventId: id, ...(status ? { status } : {}) }` na query de `registration.findMany`. O contador "N inscrições" no cabeçalho reflete o resultado filtrado.

### B2. Ordenação
Dois links/botões acima da tabela (mesmo padrão visual do `SortLink` de `/admin/pagamentos`, com seta indicando direção ativa):
- **Ordem alfabética** — ordena por `athlete.name`.
- **Ordem cronológica** — ordena por `createdAt` (padrão da página quando não há parâmetro, `asc`, igual ao comportamento atual).

Clicar no botão já ativo inverte a direção (`asc`↔`desc`); clicar no outro botão troca a coluna de ordenação mantendo `asc` como direção inicial. Implementado via query params `sort=name|date` e `dir=asc|desc`, resolvidos para o `orderBy` do Prisma (`athlete: { name: dir }` ou `{ createdAt: dir }`).

### B3. Novas/ajustadas colunas de data
- Nova coluna **"Data inscrição"**: `formatDate(r.createdAt, "dd/MM/yyyy HH:mm")`.
- Coluna **"Data pag."** existente passa a incluir hora: `formatDate(payment.paidAt, "dd/MM/yyyy HH:mm")` (mantém "—" quando não há pagamento).

### B4. Exportação
`ExportCsvButton` e `PrintButton` continuam funcionando como hoje; não é necessário propagar filtro/ordenação para o CSV/PDF neste sub-projeto (fora de escopo — eles já exportam a lista completa do evento).

## Fora de escopo (não mexer)
- Qualquer lógica de cálculo de `soldCount`, checkout, pagamento ou cancelamento.
- Exportação CSV/PDF respeitando filtro (pode virar pedido futuro).
- Os demais 6 sub-projetos (relatório financeiro, estorno, alertas, auditoria estendida, config. de cancelamento por evento, relatório financeiro do organizador).

## Testes
- Atualizar/criar testes cobrindo: cálculo de "restantes" nos dois cenários (`maxParticipants` definido vs. `null`), filtro por status na query de inscritos, e resolução de `sort`/`dir` para `orderBy`.
