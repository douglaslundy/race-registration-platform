# Redes sociais com limite de envio, por evento — Design

## Contexto

Este é o item B da lista original de tarefas (o A, link de patrocínio, já está em
produção). O organizador quer cadastrar redes sociais por evento — cada uma com link e
uma mensagem própria — que sejam incluídas nas mensagens que a plataforma já manda pro
comprador/atleta sobre aquele evento, mas só até um número limitado de vezes por pessoa
(ex.: configurar 2, e a rede social só aparece nas 2 primeiras mensagens que essa pessoa
receber sobre o evento, mesmo que ela receba mais mensagens depois).

O sistema já tem um mecanismo de templates editáveis por evento com variáveis (
`{{nome_atleta}}`, `{{link_evento}}`, `{{link_patrocinio}}` — este último implementado na
etapa anterior), resolvidas em `lib/templates/render.ts`, com uma lista de variáveis
permitidas por alerta (`lib/templates/registry.ts`) e um catálogo geral pra exibição na
UI de edição de templates (`lib/templates/variables.ts`).

## Objetivo

Organizador cadastra, por evento, uma ou mais redes sociais (rede + link + mensagem +
quantas vezes incluir por pessoa + ativa/inativa). O sistema disponibiliza isso como uma
variável de template, `{{redes_sociais}}`, nas 3 mensagens que a plataforma já manda pro
comprador/atleta sobre um evento — confirmação de inscrição, carrinho abandonado e erro
de pagamento — resolvendo dinamicamente a cada envio se inclui ou não a promoção de cada
rede, respeitando o limite configurado.

## Escopo

- Cadastro de redes sociais por evento (não por organizador — cada evento tem o seu).
- Campo "rede" é texto livre (o organizador digita o nome — sem lista fixa de opções).
- Limite = "primeiras N mensagens recebem a promoção" (não uma distribuição espalhada
  nem baseada num total conhecido de antemão — decidido na etapa de brainstorm anterior).
- A contagem é por **pessoa que recebe a mensagem** daquele evento — na confirmação de
  inscrição, isso é o atleta (`athleteUserId`); no carrinho abandonado e no erro de
  pagamento, ainda não existe uma inscrição confirmada nesse ponto do fluxo, só o
  comprador (`buyerUserId`) — a contagem usa esse id nesses dois casos. No caso comum
  (autoinscrição), atleta e comprador são a mesma pessoa; em inscrição por procuração,
  cada um conta separado — simplificação aceita dado os dados disponíveis em cada fluxo.
- Se o organizador não colocar `{{redes_sociais}}` no texto do template, nada muda —
  mecanismo passivo, mesmo padrão de `{{link_patrocinio}}`.
- UI de cadastro: tela nova por evento, no estilo já usado por `/cupons` (lista +
  formulário de adicionar/editar, client component + API REST).

## Fora de escopo

- Redes sociais em nível de organizador (valendo pra todos os eventos dele).
- Qualquer outro alerta além de `ORDER_CONFIRMED`(+variantes)/`ABANDONED_CART`/
  `PAYMENT_ERROR`(+variante) — os únicos 3 que o comprador/atleta recebe sobre um evento
  hoje.
- Distribuição "espalhada" do limite (ex.: 2 de 5 espalhadas) — só "primeiras N".
- Página pública do evento.

## Dados

### Schema

Dois models novos em `prisma/schema.prisma`, seguindo o padrão já usado por `Coupon`
(campo de "tipo" como `String` com comentário das opções, não enum nativo — mas aqui é
texto livre então nem isso se aplica):

```prisma
model EventSocialLink {
  id        String   @id @default(cuid())
  eventId   String
  platform  String                          // texto livre digitado pelo organizador (ex.: "Instagram", "Strava")
  url       String
  message   String   @db.Text
  active    Boolean  @default(true)
  maxSends  Int      @default(1)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  event Event            @relation(fields: [eventId], references: [id], onDelete: Cascade)
  sends SocialLinkSend[]

  @@index([eventId])
  @@map("event_social_links")
}

model SocialLinkSend {
  id                String   @id @default(cuid())
  eventSocialLinkId String
  userId            String
  count             Int      @default(0)
  updatedAt         DateTime @updatedAt

  eventSocialLink EventSocialLink @relation(fields: [eventSocialLinkId], references: [id], onDelete: Cascade)

  @@unique([eventSocialLinkId, userId])
  @@map("social_link_sends")
}
```

`Event` ganha a relação `socialLinks EventSocialLink[]`, ao lado de `coupons`.

Migration escrita à mão (mesmo padrão já usado nas últimas features — banco local aponta
pra produção, nenhum comando de CLI/banco roda nesta sessão; commit exige `git add -f`
por causa do `.gitignore` de `prisma/migrations/`).

### Helper

Novo arquivo `lib/social-links.ts`:

```ts
export async function getSocialPromoText(eventId: string, userId: string): Promise<string>
```

- Busca `EventSocialLink` ativos do evento.
- Pra cada um: se a contagem daquele `userId` pra aquele link ainda não bateu
  `maxSends`, inclui `"{{message}} {{url}}"` no resultado e incrementa a contagem
  (`SocialLinkSend`, upsert atômico dentro de uma transação); senão, pula esse link.
- Concatena as promoções incluídas com `\n` entre elas; retorna `""` se não há nenhum
  link ativo ou nenhum link "passou" no limite.

### Variável de template

Em `lib/templates/registry.ts`, acrescentar `"redes_sociais"` ao array `variables` de:
`ORDER_CONFIRMED`, `ORDER_CONFIRMED_PROXY_BUYER`, `ORDER_CONFIRMED_PROXY_ATHLETE`,
`ABANDONED_CART`, `PAYMENT_ERROR`, `PAYMENT_ERROR_ORDER_CANCELLED`.

Em `lib/templates/variables.ts` (`ALL_VARIABLES`), acrescentar a entrada correspondente
— **passo obrigatório**, esquecido na etapa anterior (`link_patrocinio`) e pego só na
revisão final; incluir explicitamente no plano desta vez.

### Pontos de chamada do helper

- `lib/notifications.ts`, `notifyOrderConfirmed`: chamar `getSocialPromoText(eventId,
  athleteUserId)` pra cada um dos dois destinatários (comprador e, se por procuração,
  atleta), acrescentar `redes_sociais: <resultado>` aos objetos `values` já existentes
  (e-mail via `sendRegistrationConfirmationEmail`, WhatsApp via `sendWhatsAppIfActive`).
- `lib/alerts/abandoned-cart.ts`: chamar `getSocialPromoText(eventId, buyerUserId)`,
  acrescentar `redes_sociais` aos `values` do e-mail e do WhatsApp.
- `lib/alerts/payment-error.ts`: mesma coisa, nos dois alertKeys (`PAYMENT_ERROR` e
  `PAYMENT_ERROR_ORDER_CANCELLED`), usando `buyerUserId`.

## UI

### Cadastro (organizador)

Nova página `app/organizador/eventos/[id]/redes-sociais/page.tsx` — client component,
mesmo padrão de `app/organizador/eventos/[id]/cupons/page.tsx`: lista das redes
cadastradas (rede, link, mensagem resumida, limite, ativa/inativa), formulário de
adicionar (toggle show/hide), edição inline, exclusão com `ConfirmDialog` (nunca
`confirm()` nativo, por regra do projeto).

Link novo na página do evento (`app/organizador/eventos/[id]/page.tsx`), ao lado dos
outros links de gerenciamento (Lotes, Percursos, Categorias, Cupons).

### API

`app/api/events/[id]/social-links/route.ts` (GET lista, POST cria) e
`app/api/events/[id]/social-links/[linkId]/route.ts` (PATCH edita, DELETE remove) — 
espelhando exatamente o padrão de `app/api/events/[id]/coupons/route.ts` e
`.../coupons/[couponId]/route.ts` (mesma checagem de permissão via `checkApiPermission`
com chaves novas `social-links.view`/`social-links.create`/`social-links.edit`/
`social-links.delete`, mesmo padrão de escopo por `organizerId`/admin).

## Testes

- `lib/social-links.ts`: testes unitários do helper — nenhum link ativo (retorna vazio),
  um link dentro do limite (inclui e incrementa), um link que já bateu o limite (não
  inclui), múltiplos links (só os que ainda têm limite disponível aparecem).
- Testes de integração dos 3 pontos de chamada (notifications/abandoned-cart/
  payment-error), verificando que `redes_sociais` chega no objeto `values` — decidido em
  detalhe no plano.
