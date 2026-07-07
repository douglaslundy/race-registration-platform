# Design: Taxas no resumo financeiro do comprovante do atleta

## Contexto

A página de detalhe da inscrição do atleta (`app/dashboard/inscricoes/[id]/page.tsx`), seção "Resumo
financeiro", mostra hoje Subtotal, Desconto e Total pago — mas não mostra a taxa da plataforma nem a
taxa de serviço, mesmo essas duas já existindo no `Order` (`platformFeeAmount`, `paymentFeeAmount`) e
já sendo exibidas com esses nomes na tela de checkout (`components/checkout/CheckoutForm.tsx:558,563`:
"Taxa da plataforma" / "Taxa de serviço").

## Decisão

Adicionar, entre "Desconto" e "Total pago" no mesmo card, duas linhas condicionais (só aparecem
quando o valor é maior que zero), reaproveitando os rótulos já usados no checkout:

- `+ Taxa da plataforma` — `order.platformFeeAmount`
- `+ Taxa de serviço` — `order.paymentFeeAmount`

## Arquitetura

Em `app/dashboard/inscricoes/[id]/page.tsx`:

1. Adicionar `paymentFeeAmount: true` ao `select` do `order` (linha 43), que hoje só busca
   `id, status, totalAmount, discountAmount, platformFeeAmount`.
2. No card "Resumo financeiro" (linhas 160-178), adicionar as duas novas linhas entre o bloco de
   `discountAmount` e o bloco de `totalAmount`, seguindo o mesmo padrão visual das linhas existentes
   (`flex justify-between`) e a mesma condicional de exibição do checkout (`> 0`).

## Fora de escopo

- Qualquer mudança no cálculo das taxas (`lib/checkout.ts`) — só exibição do valor já calculado.
- Qualquer mudança na tela de checkout, que já exibe essas taxas corretamente.
- Exportação/CSV/relatórios — fora do pedido, que é especificamente o comprovante do atleta.

## Testes

Sem testes de UI, seguindo a convenção já estabelecida no projeto. Verificação manual: abrir o
comprovante de uma inscrição com taxa de serviço > 0 e confirmar as duas linhas aparecendo com os
valores corretos; abrir uma com taxa de serviço = 0 e confirmar que só a linha de taxa da plataforma
aparece.
