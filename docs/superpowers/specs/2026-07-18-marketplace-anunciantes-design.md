# Marketplace de anunciantes privados

## Contexto

Quarto e último sub-projeto pedido pelo usuário nesta sessão (ordem: filtros de eventos ✅
deployado → caixa de entrada de mensagens ✅ implementado → anúncios/Google AdSense ✅
implementado → **marketplace de anunciantes privados**, depende da infraestrutura de posições do
sub-projeto anterior).

Empresas privadas se cadastram como anunciantes, compram um plano, e cadastram anúncios que
ocupam (com exclusividade) uma das 5 posições já construídas no sub-projeto 3. Reaproveita a
mesma tabela de métricas (`AdMetricsSnapshot`) e o mesmo `AdSlotRenderer`, sem tocar no que já
está aprovado e em produção.

## Decisões de arquitetura

- **Conta completa**: novo `UserRole.ADVERTISER`, com login/painel próprio — mesmo padrão de
  `ATHLETE`/`ORGANIZER`/`ASSISTANT`.
- **Pagamento real**: reaproveita `Payment` + `getPaymentProvider()` (já 100% genéricos,
  confirmado por investigação de código). `Order` **não é tocado** — tem `eventId` obrigatório
  usado em relatórios/repasses/conciliação por todo o sistema; mexer nele seria alto risco.
  Em vez disso, novo modelo `AdPurchase` com sua própria relação com `Payment`.
- **Moderação manual**: todo anúncio nasce `PENDING_APPROVAL`, admin aprova ou rejeita (com
  motivo). Sem aprovação automática nesta versão.
- **Exclusividade por posição**: uma posição só pode ter um `PrivateAd` `APPROVED` por vez. Sem
  fila de espera — se todas as posições desejadas estão ocupadas, o anunciante não consegue
  cadastrar até uma vaga abrir.
- **Rejeição não gera reembolso automático**: anunciante mantém a posição alocada (dentro do
  prazo já pago) e reenvia uma arte diferente.

## 1. Modelo de dados

```prisma
enum UserRole {
  ATHLETE
  ORGANIZER
  ADMIN
  ASSISTANT
  ADVERTISER
}

model AdvertiserProfile {
  id           String   @id @default(cuid())
  userId       String   @unique
  companyName  String
  contactEmail String
  contactPhone String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  user      User         @relation(fields: [userId], references: [id])
  purchases AdPurchase[]

  @@map("advertiser_profiles")
}

model AdPlan {
  id                   String   @id @default(cuid())
  name                 String
  priceAmount          Int
  durationDays         Int
  maxSimultaneousSlots Int
  active               Boolean  @default(true)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  purchases AdPurchase[]

  @@map("ad_plans")
}

model AdPurchase {
  id           String    @id @default(cuid())
  advertiserId String
  adPlanId     String
  status       String    // "PENDING" | "PAID" | "EXPIRED" | "CANCELLED"
  startAt      DateTime?
  endAt        DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  advertiser AdvertiserProfile @relation(fields: [advertiserId], references: [id])
  adPlan     AdPlan            @relation(fields: [adPlanId], references: [id])
  payment    Payment?
  ads        PrivateAd[]

  @@map("ad_purchases")
}

model PrivateAd {
  id              String   @id @default(cuid())
  adPurchaseId    String
  adSlotId        String
  imageUrl        String
  targetUrl       String
  status          String   // "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXPIRED"
  rejectionReason String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  adPurchase AdPurchase @relation(fields: [adPurchaseId], references: [id])
  adSlot     AdSlot     @relation(fields: [adSlotId], references: [id])

  @@map("private_ads")
}
```

`Payment` ganha `adPurchaseId String?` (nova relação 1:1 opcional) e `orderId` vira opcional
(`String?`) — exatamente um dos dois preenchido por linha, nunca os dois, nunca nenhum. `AdSlot`
ganha a relação inversa `privateAds PrivateAd[]`.

`PlatformSetting` ganha a chave `ads_marketplace_enabled` ("true"/"false", padrão desligado) —
controla se `/auth/cadastro-anunciante` e `/anunciante/*` ficam acessíveis.

## 2. Cadastro + compra do plano

- `/auth/cadastro-anunciante` — cria `User(role=ADVERTISER)` + `AdvertiserProfile` numa
  transação, mesmo padrão do cadastro de atleta/organizador. Bloqueado (404 ou mensagem) quando
  `ads_marketplace_enabled` está desligado.
- `/anunciante/planos` — lista `AdPlan` com `active=true`. 3 planos pré-cadastrados via seed de
  migração (mesmo padrão dos 5 `AdSlot` do sub-projeto 3):

| Nome | Preço | Duração | Posições simultâneas |
|---|---|---|---|
| Básico | R$99,00 | 30 dias | 1 |
| Intermediário | R$249,00 | 30 dias | 3 |
| Premium | R$499,00 | 60 dias | 5 |

- `lib/checkout-ads.ts` — `createAdPlanCheckout(advertiserId, adPlanId)`: cria `AdPurchase`
  (`status=PENDING`) + `Payment` (via `getPaymentProvider()`) numa transação. Arquivo próprio,
  não reaproveita `lib/checkout.ts` (lógica de lote/rota/categoria não se aplica aqui).
- `app/api/webhooks/payment/route.ts` — novo branch: quando `payment.adPurchaseId` está
  preenchido (em vez de `payment.orderId`), na confirmação marca `AdPurchase.status=PAID`,
  `startAt=now()`, `endAt=startAt+adPlan.durationDays`, e dispara um e-mail de confirmação
  específico (`sendAdPurchaseConfirmationEmail`, novo em `lib/email.ts`) — não usa
  `notifyOrderConfirmed`, que já ignora pedidos sem inscrição.

## 3. Criação do anúncio, atribuição de posição e moderação

- `/anunciante/anuncios/novo` — só acessível com uma `AdPurchase(status=PAID, endAt > now())`
  com vagas livres (`count(PrivateAd status IN (PENDING_APPROVAL, APPROVED) dessa compra) <
  adPlan.maxSimultaneousSlots`).
- Lista de posições disponíveis: as 5 `AdSlot` que **não têm** nenhum `PrivateAd` com
  `status=APPROVED` no momento (independente de qual `source` a posição está configurada pra
  mostrar quando não há anúncio privado).
- Upload de imagem: dimensão exigida = `adSlot.width`×`adSlot.height` da posição escolhida,
  validada no servidor lendo as dimensões reais do arquivo (não confia em metadata do cliente).
  Reaproveita `/api/upload`/`FileAsset`.
- `PrivateAd` nasce `PENDING_APPROVAL`.
- `/admin/anuncios/moderacao` — lista pendentes, aprovar (`APPROVED`) ou rejeitar
  (`REJECTED` + `rejectionReason` obrigatório, via `ConfirmModal` com `showNoteField` — regra do
  `CLAUDE.md`, nunca `prompt()`/`confirm()` nativos).
- Novo cron `expire-private-ads`: quando `AdPurchase.endAt` passa, marca os `PrivateAd`
  daquela compra como `EXPIRED` (libera a posição).
- `AdSlotRenderer` (sub-projeto 3) ganha um terceiro branch: `source === "PRIVATE"` → busca o
  `PrivateAd` `APPROVED` daquela posição e renderiza `<a href="/api/ads/click/{id}"><img
  src={imageUrl}></a>` em vez do script do Google.

## 4. Métricas (reaproveitando `AdMetricsSnapshot` do sub-projeto 3)

- Impressão: `AdSlotRenderer`, ao renderizar um `PrivateAd`, faz `upsert` com `{increment: 1}`
  na linha do dia (`adSlotId` + data de hoje) — escrita síncrona, sem cron.
- Clique: `GET /api/ads/click/[privateAdId]` incrementa `clicks` na mesma linha e faz
  redirect 302 pro `targetUrl` real.
- `estimatedRevenueMicros` fica em `0` pra anúncios privados — a receita já foi capturada na
  compra do plano (`AdPurchase`/`Payment`), não faz sentido atribuir valor por clique.
- `/admin/anuncios/metricas` (sub-projeto 3) ganha uma coluna "Fonte" (Google/Privado) — a
  agregação em si (`listAdMetricsSummary`) já soma tudo que estiver na tabela, sem mudança de
  lógica.

## 5. Relatório em PDF + envio por e-mail/WhatsApp

- Nova dependência: `@react-pdf/renderer` (gera PDF em Node sem navegador headless — mais leve
  que Puppeteer pro Docker da VPS). Primeira geração de PDF real do sistema (hoje "PDF" é só
  `window.print()` do navegador).
- `/admin/anuncios/privados/[id]` — tela de detalhe de um `PrivateAd`: métricas do período,
  botão "Baixar PDF" e botão "Enviar por e-mail/WhatsApp" (usa `contactEmail`/`contactPhone` do
  `AdvertiserProfile` — um contato por empresa, capturado no cadastro, não por anúncio).
- `sendMail()` (`lib/email.ts`, já instrumentado no sub-projeto 2) ganha um parâmetro opcional
  `attachments` (nodemailer já suporta nativamente) — o log de e-mail continua funcionando sem
  mudança.
- Nova função `sendWhatsAppDocument(phone, base64Pdf, filename, caption)` em `lib/whatsapp.ts` +
  `lib/whatsapp/evolution-client.ts`, chamando o endpoint de envio de mídia da Evolution API.
  **Ressalva idêntica à do webhook de leitura (sub-projeto 2)**: o formato exato do payload de
  mídia da Evolution API não foi validado contra uma instância real nesta sessão — segue o
  formato documentado publicamente, registrado como risco conhecido.

## 6. Telas do admin

- `/admin/anuncios/planos` — CRUD de `AdPlan` (criar/editar/desativar — nunca apagar um plano já
  comprado por alguém).
- `/admin/anuncios/moderacao` — fila de aprovação.
- `/admin/anuncios/privados/[id]` — detalhe + PDF + envio.
- Toggle `ads_marketplace_enabled` — em `/admin/configuracoes` (reaproveita a rota genérica
  `POST /api/admin/settings` já usada por outras configurações da plataforma).

## Casos de borda

- Posição desejada ocupada no momento do cadastro do anúncio: simplesmente não aparece na lista
  de posições disponíveis — sem fila, sem erro, só não é uma opção.
- `AdPurchase` paga mas todas as posições do plano já usadas: bloqueia novo cadastro de anúncio
  até uma vaga abrir (expiração ou rejeição definitiva não libera vaga — rejeição permite reenvio
  na mesma vaga, não libera a vaga em si).
- Dimensão de imagem errada: rejeitada no upload, antes de gravar `PrivateAd`.
- Anunciante sem `AdPurchase` paga tentando acessar `/anunciante/anuncios/novo`: redireciona pra
  `/anunciante/planos`.

## Fora de escopo (explicitamente)

- Renovação automática de plano.
- Fila de espera por posição.
- Editar a arte de um anúncio já aprovado (precisa cadastrar um novo, se houver vaga).
- Múltiplos anúncios/rotação na mesma posição.
- Repasse de receita pro anunciante.
- Regras de aprovação automática.
- Reembolso automático em caso de rejeição.
