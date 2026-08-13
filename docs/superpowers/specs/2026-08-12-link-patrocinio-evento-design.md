# Link de patrocínio por evento — Design

## Contexto

O organizador quer cadastrar um link por evento (ex.: rota no Strava, página de um
patrocinador) que seja incluído na mensagem de confirmação de inscrição daquele evento
específico. O sistema já tem um mecanismo de templates editáveis por evento, com
variáveis (`{{nome_atleta}}`, `{{link_evento}}` etc.) resolvidas em
`lib/templates/render.ts` e uma lista de variáveis permitidas por alerta em
`lib/templates/registry.ts` (`ALERT_REGISTRY[alertKey].variables`).

## Objetivo

Um campo novo no evento pra esse link, disponível como variável `{{link_patrocinio}}`
nos templates de confirmação de inscrição (`ORDER_CONFIRMED`,
`ORDER_CONFIRMED_PROXY_BUYER`, `ORDER_CONFIRMED_PROXY_ATHLETE`) — o organizador decide se
e como usar essa variável no texto do template, do mesmo jeito que já faz com
`{{link_evento}}`.

## Escopo

- Um campo só (`sponsorLink`), texto livre (URL), opcional, por evento.
- Disponível só nos 3 alertas de confirmação de inscrição (é isso que "enviado na
  confirmação de inscrição" pede) — não em carrinho abandonado nem erro de pagamento.
- Configurável na edição do evento (`EditEventForm.tsx`), junto dos outros campos do
  evento.
- Se o campo estiver vazio, `{{link_patrocinio}}` resolve pra string vazia (mesmo padrão
  de `renderTemplate`, que já faz isso pra qualquer variável ausente) — sem quebrar
  templates que não usam a variável.

## Fora de escopo

- Redes sociais com limite de envio (item B do pedido original) — spec e plano
  separados, depois deste.
- Validação de formato de URL (o campo é texto livre, mesmo padrão de
  `organizerContact`/outros campos de texto livre do evento).

## Dados

### Schema

`prisma/schema.prisma`, model `Event` — um campo novo, nullable, ao lado dos outros
campos de texto opcionais do evento (ex.: `organizerContact`):

```prisma
sponsorLink String?
```

Migration escrita à mão (mesmo padrão já usado nas últimas features — banco local aponta
pra produção, nenhum comando de CLI/banco roda nesta sessão):

```sql
ALTER TABLE "events" ADD COLUMN "sponsorLink" TEXT;
```

### Variável de template

Em `lib/templates/registry.ts`, acrescentar `"link_patrocinio"` ao array `variables` de
`ORDER_CONFIRMED`, `ORDER_CONFIRMED_PROXY_BUYER` e `ORDER_CONFIRMED_PROXY_ATHLETE` (só
esses 3 — `ABANDONED_CART`/`PAYMENT_ERROR*` continuam sem essa variável).

### Preenchimento do valor

- `lib/email.ts`, `sendRegistrationConfirmationEmail`: acrescentar `sponsorLink` aos
  `params`, e `link_patrocinio: params.sponsorLink ?? ""` ao objeto `values` passado pra
  `renderTemplate`.
- `lib/notifications.ts`, `notifyOrderConfirmed`: buscar `event.sponsorLink` na mesma
  query que já busca `event: { select: { id: true, title: true } }` (acrescentar
  `sponsorLink: true` ao `select`), passar pra `sendRegistrationConfirmationEmail` (novo
  param) e acrescentar `link_patrocinio: order.event?.sponsorLink ?? ""` aos dois objetos
  `values` já passados pra `sendWhatsAppIfActive` (comprador e atleta).

## UI

### Edição do evento

`components/organizer/EditEventForm.tsx` + `app/api/events/[id]/route.ts`
(`updateEventSchema` + `db.event.update`) + `app/organizador/eventos/[id]/editar/page.tsx`
(`select` do `db.event.findFirst`): um campo de texto novo, "Link de patrocínio (Strava,
página do patrocinador etc.)", mesmo padrão dos outros campos opcionais de texto do
formulário (ex.: `organizerContact`).

## Testes

- Nenhum teste de unidade novo necessário além dos já cobertos por
  `renderTemplate`/`getEffectiveTemplate` (a resolução da variável é só mais uma chave no
  objeto `values`, já coberta pelo comportamento genérico existente). Cobertura de
  regressão via `tests/lib-email.test.ts` (se precisar de um caso novo pra
  `sendRegistrationConfirmationEmail` com `sponsorLink` preenchido) — decidido no plano.
