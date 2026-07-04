# Ajustes de data/hora: admin/pagamentos e organizador/inscritos

## Contexto

Primeiro de três sub-projetos de uma leva de pedidos do usuário. Dois ajustes pequenos e
independentes entre si, sem lógica de negócio nova — só formatação e ordem de exibição.

## 1. Hora junto da data em `/admin/pagamentos`

`app/admin/pagamentos/page.tsx:249` exibe a data de criação do pagamento com
`p.createdAt.toLocaleDateString("pt-BR")` — só data, sem hora. Passa a usar `formatDate(p.createdAt,
"dd/MM/yyyy HH:mm")`, importado de `lib/format.ts` (o mesmo helper e padrão de formato já usados na
página de inscritos do organizador). É a única coluna de data da página (`Data`, ordenável por
`createdAt`).

## 2. Reordenar colunas em `/organizador/eventos/[id]/inscritos`

Ordem atual do cabeçalho (`app/organizador/eventos/[id]/inscritos/page.tsx:153-164`): `Atleta,
Percurso, Categoria, Lote, Camiseta, Pagamento, Valor, Data pag., Cód. transação, Data inscrição,
Status, Ações`.

Nova ordem: `Atleta, Percurso, Categoria, Lote, Camiseta, Pagamento, Valor, Data inscrição, Data
pag., Cód. transação, Status, Ações` — "Data inscrição" passa a vir imediatamente à esquerda de
"Data pag.", e "Cód. transação" continua colado a "Data pag." (mesmo agrupamento lógico de colunas
de pagamento).

A mudança é só de ordem: cabeçalho (`<th>`) e células de cada linha (`<td>`, linhas 184-195)
precisam mover na mesma posição relativa. Nenhuma formatação, dado ou lógica muda.

## Fora de escopo

Réplica da página de inscritos no admin, modal de dados do atleta, CSV enriquecido, e botão de
reenvio de notificação — sub-projetos 2 e 3 separados, ainda não desenhados.
