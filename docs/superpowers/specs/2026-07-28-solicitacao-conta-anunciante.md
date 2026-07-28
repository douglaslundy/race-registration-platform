# Solicitação de conta de anunciante (pagamento antes da aprovação) — Design

## Contexto e estado atual

Hoje existem dois jeitos de alguém virar `ADVERTISER`, nenhum deles com pagamento prévio:

1. **Autosserviço instantâneo** — `POST /api/auth/register-advertiser` (`app/api/auth/register-advertiser/route.ts`):
   cria `User(role=ADVERTISER)` + `AdvertiserProfile` na hora, sem aprovação, sem pagamento. Só
   pede razão social, e-mail de contato, telefone de contato.
2. **Promoção pelo admin** — `promoteToAdvertiser()` (`lib/advertisers/promote.ts`): admin promove
   um `ATHLETE` existente a `ADVERTISER` direto, sem pagamento (fluxo interno, mantém-se como está —
   fora do escopo desta spec).

Depois de virar `ADVERTISER` (por qualquer um dos dois caminhos), a pessoa acessa
`/anunciante/planos` (`requireAuth()` + `role==="ADVERTISER"`, redireciona quem não é anunciante)
pra comprar um plano (`AdPlan`) via `SubscribeButton` → `createAdPlanCheckout()`
(`lib/checkout-ads.ts`) → cria `AdPurchase(status="PENDING")` → checkout/pagamento (Pix/cartão/
boleto, mesma infra de pagamento de inscrição) → webhook confirma → `confirmAdPurchasePayment()`
(`lib/ads/ad-purchase-confirmation.ts`) sobe pra `AdPurchase(status="PAID")`, calcula
`startAt`/`endAt` a partir de `AdPlan.durationDays`. A partir daí, o anunciante pode criar
`PrivateAd`s até o limite de `AdPlan.maxSimultaneousSlots` simultâneos (`lib/ads/private-ads.ts`).

**Pedido do usuário**: inverter a ordem — a pessoa não vira `ADVERTISER` de graça pra depois
comprar um plano; ela **solicita** virar anunciante já escolhendo/pagando um plano, e só depois
que o **admin aprova** é que a conta realmente vira `ADVERTISER` e pode criar anúncios.

## Decisões já fechadas com o usuário

Fechadas em 2026-07-27 (brainstorm inicial):
1. **Papel durante a espera**: a pessoa continua com o papel que já tinha (atleta/organizador); se
   não tinha conta nenhuma, cria uma conta comum `ATHLETE` no ato da solicitação. **Não existe
   papel intermediário `ADVERTISER_PENDING`** — o papel só vira `ADVERTISER` quando o admin aprova.
2. **Visitante anônimo pode solicitar direto no formulário**, sem precisar logar antes — o próprio
   formulário de solicitação já coleta os dados de uma conta nova (nome/e-mail/senha) junto com o
   pedido, igual o `register-advertiser` de hoje já faz.
3. **Campos do formulário**: além dos 3 já usados hoje (razão social, e-mail de contato, telefone
   de contato), adiciona **CNPJ ou CPF, endereço, perfil do Instagram, perfil do Facebook**.

Fechadas em 2026-07-28 (retomada):
4. **"Créditos"**: reaproveita o `AdPlan.maxSimultaneousSlots` que já existe — cada anúncio
   aprovado ocupa uma vaga simultânea até cancelar/expirar. **Sem schema novo pra crédito.**
5. **Alerta ao admin**: notificação **imediata** (e-mail/WhatsApp) a cada solicitação nova — não
   entra só no resumo diário (`lib/alerts/daily-summary.ts`).
6. **Reembolso na rejeição**: reaproveita `lib/payment/refund-service.ts::refundPayment()`.
   **Achado importante durante esta spec**: `refundPayment()` hoje **exige** `payment.orderId`
   (`refund-service.ts:24`, `if (!payment.order || !payment.orderId) throw ...`) — só sabe
   estornar pagamento de inscrição, nunca de `AdPurchase` (que usa `Payment.adPurchaseId`, mutuamente
   exclusivo com `orderId` pela constraint já existente no banco). **"Reaproveitar" aqui significa
   estender `refundPayment()` pra aceitar o caso `adPurchaseId`** (ou criar um branch interno pro
   caso ad-purchase), não é já compatível como está — mas a lógica de conversar com o gateway de
   pagamento (`getPaymentProvider()`, `checkPaymentStatus`) é a mesma, só a parte de "o que atualizar
   depois do estorno confirmado" muda (`AdPurchase.status` em vez de `Registration.status`).

## Decisão de escopo (fechada em 2026-07-28)

`POST /api/auth/register-advertiser` é **removida** — a única forma de virar `ADVERTISER` por
autosserviço passa a ser solicitação+pagamento+aprovação. A promoção manual pelo admin
(`promoteToAdvertiser()`) continua existindo como está, fora do escopo desta spec.
`/anunciante/planos` (autenticada) continua existindo, mas só acessível a quem **já é**
`ADVERTISER` (comprar plano adicional/renovação) — não é mais o ponto de entrada pra virar
anunciante.

## Fluxo proposto

```
Visitante/atleta/organizador
        │
        ▼
/anunciante/solicitar (nova página pública)
  Mostra os AdPlan.active, com botão "Solicitar conta de anunciante" em vez de comprar direto.
  Formulário único: se não logado, pede nome/e-mail/senha da conta nova; sempre pede razão
  social, CNPJ/CPF, endereço, e-mail de contato, telefone de contato, Instagram, Facebook.
        │
        ▼
POST /api/auth/request-advertiser (nova rota, substitui register-advertiser)
  - Se não logado: cria User(role=ATHLETE) — mesma validação de e-mail/MX/senha já usada hoje.
  - Se já logado (ATHLETE/ORGANIZER): reaproveita a sessão, role NÃO muda.
  - Cria (ou reaproveita, se já existir) AdvertiserProfile com os 7 campos (3 antigos + 4 novos).
  - Cria AdPurchase(status="PENDING", advertiserId, adPlanId escolhido) — mesmo formato de hoje.
  - Retorna dados de checkout (reaproveita o checkout de plano de anúncio já existente).
        │
        ▼
Checkout/pagamento (Pix/cartão/boleto — infra já existente, sem mudança)
        │
        ▼
Webhook de pagamento confirma
  confirmAdPurchasePayment() (lib/ads/ad-purchase-confirmation.ts) precisa de um branch novo:
  - Se o User dono do AdvertiserProfile já é role=ADVERTISER (comprando plano adicional/renovação,
    fluxo de hoje) → comportamento atual, sobe direto pra "PAID".
  - Se o User AINDA NÃO é ADVERTISER (primeira solicitação) → sobe pra novo status
    "PENDING_APPROVAL" em vez de "PAID". Não mexe no role do usuário ainda.
  - Dispara alerta imediato (e-mail/WhatsApp) pro(s) admin(s) — decisão 5.
        │
        ▼
Admin → nova tela "Solicitações de anunciante pendentes"
  Lista AdPurchase.status="PENDING_APPROVAL" com o AdvertiserProfile e AdPlan associados.
  ├── Aprovar → AdPurchase.status="PAID" (calcula startAt/endAt como hoje) + User.role="ADVERTISER"
  │             + e-mail de aprovação (reaproveita sendAdvertiserPromotionEmail ou similar).
  └── Rejeitar (com motivo) → AdPurchase.status="REJECTED" (novo status terminal) +
                refundPayment() estende pro caso AdPurchase (decisão 6) + e-mail de rejeição com
                motivo + User.role permanece o que já era (nunca virou ADVERTISER).
```

## Mudanças de schema propostas

- `AdPurchase.status`: novos valores de string `"PENDING_APPROVAL"` e `"REJECTED"` (já é `String`
  solto no schema, sem enum — não precisa migração, só disciplina de código nos novos branches).
- `AdPurchase.rejectionReason String?` (novo campo — precisa migração; mesmo padrão já usado em
  `PrivateAd.rejectionReason`).
- `AdvertiserProfile` ganha 4 campos novos (precisa migração): `document String` (CNPJ ou CPF,
  obrigatório, sem máscara fixa — validar formato no Zod, não no banco), `address String`
  (obrigatório), `instagram String?` (opcional), `facebook String?` (opcional).

## Decisões finais (fechadas em 2026-07-28)

1. **Escopo do autosserviço**: substituído (ver seção acima).
2. **Campos obrigatórios**: CNPJ/CPF e endereço obrigatórios; Instagram e Facebook opcionais.
3. **Rejeição não apaga o `AdvertiserProfile`** — fica gravado (órfão, sem `AdPurchase` aprovado
   ativo) pra reaproveitar numa tentativa futura da mesma pessoa, sem precisar preencher tudo de
   novo.
4. **E-mails de aprovação/rejeição**: reaproveitar `sendAdvertiserPromotionEmail` (`lib/email.ts`)
   como base, adaptando o texto pro caso de aprovação/rejeição de solicitação em vez de promoção
   direta pelo admin.

Spec fechada, pronta pra virar plano de implementação (`superpowers:writing-plans` →
`superpowers:subagent-driven-development`, mesmo padrão já usado nas frentes anteriores).
