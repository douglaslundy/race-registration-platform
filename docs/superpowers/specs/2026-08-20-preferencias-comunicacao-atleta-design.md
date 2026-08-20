# Design: Preferências de comunicação (opt-out de mensagens promocionais/eventos)

## Contexto

Pedido do usuário (`taskwhatsapp.md`, na raiz do repo) descreve três frentes independentes:
campanhas de WhatsApp em massa, preferências de comunicação do atleta, e endereço obrigatório do
atleta. Foi decidido (brainstorming) tratar como três sub-projetos separados, cada um com seu
próprio spec/plano. Este documento cobre só o segundo: **preferências de comunicação** — é
fundação para as campanhas (que vão precisar filtrar por `receivePromotionalMessages`), por isso
vem primeiro.

## Descobertas da auditoria (que mudam o escopo)

- **Não existe nenhum mecanismo de aceite de Termos de Uso** (`terms_accepted_at`, versão, IP) no
  sistema. O documento original previa reaproveitar isso como origem do consentimento — como não
  existe, os dois campos simplesmente nascem `true` na criação da conta, sem vínculo com um
  "aceite" registrado em lugar nenhum.
- **O "modal obrigatório" citado no documento não existe como modal** — é a página de redirect
  `/completar-cadastro` (feature de CPF obrigatório, 2026-07-06), que bloqueia navegação até
  `birthDate`/`cpf`/`phone` estarem completos. Não é usado por este sub-projeto diretamente, mas
  seu padrão de rota top-level (fora do layout do dashboard) é reaproveitado para `/preferencias`.
- **Os únicos `AlertKey`s que hoje chegam a atleta/comprador** (`recipientRoles` incluindo `BUYER`
  ou `ATHLETE`) são exatamente 6: `ORDER_CONFIRMED`, `ORDER_CONFIRMED_PROXY_BUYER`,
  `ORDER_CONFIRMED_PROXY_ATHLETE`, `ABANDONED_CART`, `PAYMENT_ERROR`,
  `PAYMENT_ERROR_ORDER_CANCELLED` — os mesmos 3 arquivos já tocados pelas features de
  `redes_sociais`/`patrocinio` (`lib/notifications.ts`, `lib/alerts/abandoned-cart.ts`,
  `lib/alerts/payment-error.ts`). `CANCELLATION_REQUESTED` vai só para `ADMIN`/`ORGANIZER`, fora de
  escopo.
- **Bug pré-existente descoberto na auditoria**: `/inscricao/[slug]/page.tsx` já monta
  `redirect(\`/auth/login?callbackUrl=/inscricao/${slug}\`)` quando não autenticado, mas
  `LoginForm.tsx` ignora esse parâmetro e sempre faz `router.push("/dashboard")` após o login —
  perdendo o destino original. Este sub-projeto depende do mesmo mecanismo funcionar (o link de
  preferências precisa "voltar" pra página certa após login), então o fix faz parte do escopo.
- Não existe fila/worker/Redis no projeto — irrelevante para este sub-projeto (não há
  processamento assíncrono aqui), mas confirma o padrão do restante do ecossistema.

## Decisões confirmadas com o usuário

1. As duas preferências controlam **WhatsApp e e-mail juntos** (não só WhatsApp) — uma preferência
   por tipo de mensagem, independente do canal.
2. Os campos ficam em **`User`** (não em `AthleteProfile`) — cobre qualquer conta que possa
   comprar/receber mensagem, inclusive quem compra por procuração para outro atleta.
3. A tela fica em **rota dedicada `/preferencias`**, fora do layout do dashboard (mesmo padrão de
   `/completar-cadastro`) — facilita o link nas mensagens funcionar tanto autenticado quanto via
   redirect de login, sem depender do dashboard carregar.

## Arquitetura

### 1. Schema (`prisma/schema.prisma`)

```prisma
model User {
  ...
  receivePromotionalMessages Boolean @default(true)
  receiveEventMessages       Boolean @default(true)
  ...
}
```

Migration aditiva, escrita à mão seguindo o padrão já estabelecido no projeto (ver
`prisma/migrations/20260817010000_add_event_organizer_override/` como exemplo recente de migration
só-aditiva). Contas existentes recebem `true` automaticamente pelo `DEFAULT` da coluna — não há
nenhum estado de opt-out anterior a preservar (confirmado na auditoria, não existe mecanismo
equivalente hoje).

### 2. Guard central de preferência

Sem helper/query nova: os 3 arquivos de alerta já fazem uma query `db.order.findUnique`/
`db.payment.findUnique` carregando `buyer`/`athlete`. O campo `receiveEventMessages` é adicionado
ao `select` existente dessas queries (sem query extra, sem N+1), e o guard vira uma checagem
síncrona sobre o dado já carregado — mesmo padrão de `settings.emailEnabled`/
`athleteProfile?.phone` que já existe nesses arquivos.

**Pontos de integração exatos (8 call-sites em 3 arquivos):**

- `lib/notifications.ts` (`notifyOrderConfirmed`): guarda de `receiveEventMessages` do
  destinatário em cada um dos 4 pontos de envio (comprador e-mail, comprador WhatsApp, atleta
  e-mail, atleta WhatsApp) — mesmo lugar onde hoje já se checa `isSmtpReady`/
  `isWhatsAppConnectionActive`/telefone presente.
- `lib/alerts/abandoned-cart.ts` (`sendAbandonedCartAlert`): guarda em cada um dos 2 pontos
  (e-mail, WhatsApp) do comprador.
- `lib/alerts/payment-error.ts` (`sendCancellationInviteNotification`, compartilhada por
  `notifyPaymentError`/`notifyOrderCancelledWithoutPayment`): guarda nos 2 pontos (e-mail,
  WhatsApp) do comprador.

Em todos os casos, a checagem é **lida do banco a cada execução** (dentro da mesma query que já
busca `buyer`/`athlete`), então a "revalidação imediata antes do envio" do documento original é
satisfeita automaticamente — não há snapshot nem cache a invalidar.

`CANCELLATION_REQUESTED`, `LOW_STOCK`, `RECONCILIATION_MISMATCH`, `DAILY_SUMMARY*`,
`ADVERTISER_REQUEST_PENDING` — todos para `ORGANIZER`/`ADMIN`, não tocados.

### 3. Rodapé de opt-out (só WhatsApp)

`sendWhatsAppMessage` (`lib/whatsapp.ts`) ganha uma opção nova:

```ts
options?: {
  relatedEntityType?: string;
  relatedEntityId?: string;
  logSubject?: string;
  appendPreferencesFooter?: boolean; // novo
}
```

Quando `true`, o texto recebe um rodapé fixo antes do envio — texto centralizado em uma única
constante/função (não copiado em templates), aproximadamente:

> Para alterar ou cancelar o recebimento de mensagens, acesse suas preferências de comunicação:
> {baseUrl}/preferencias

O link é **estático** (sem token, sem id de usuário na URL) — quem acessa não-autenticado é
mandado pro login e volta autenticado, então não precisa de nada sensível na URL. Usado só nos 8
call-sites do item 2 (nunca em `SENSITIVE_ACTION_CODE`, `WHATSAPP_CONNECTION_TEST`, senha, convite
de assistente, QR de kit isolado, etc. — mensagens que não são "evento" nem "promocional" no
sentido do documento).

E-mail **não** recebe esse rodapé nesta entrega (o documento só pede pra WhatsApp).

### 4. Tela `/preferencias`

`app/preferencias/page.tsx` — página top-level, fora do layout do dashboard (mesmo padrão
estrutural de `app/completar-cadastro/page.tsx`): `requireAuth()`, sem nav completa, só cabeçalho
simples. Busca os 2 valores atuais de `session.user.id` direto (sem GET novo). Formulário
(`PreferenciasForm.tsx`, client component) com 2 toggles independentes:

- "Receber mensagens sobre minhas inscrições e eventos" (`receiveEventMessages`)
- "Receber mensagens promocionais" (`receivePromotionalMessages`)

Salva via `PATCH /api/me/preferences` (rota **existente**, estendida — hoje só aceita
`{ uiDensity }`, passa a aceitar também os 2 campos novos, todos opcionais no schema Zod). Efeito
imediato: como o guard do item 2 lê direto do banco, não há cache/invalidação a propagar.

Se o usuário não autenticado acessar o link: `requireAuth()` (via `auth()` + `redirect`) manda pro
login preservando o destino (ver item 5).

### 5. Fix do redirect de login com `callbackUrl`

`app/preferencias/page.tsx` redireciona como os outros pontos do sistema:
`redirect(\`/auth/login?callbackUrl=/preferencias\`)` quando não autenticado (mesmo padrão de
`/inscricao/[slug]`).

`LoginForm.tsx` passa a:
1. Ler `callbackUrl` da query string (`useSearchParams`).
2. Validar que é um path relativo seguro: começa com `/` e **não** começa com `//` nem contém
   `://` — rejeita qualquer tentativa de redirecionar para outro host (open redirect).
3. Se válido, `router.push(callbackUrl)` após login bem-sucedido; caso contrário (ausente ou
   inválido), mantém o comportamento atual (`/dashboard`).

Esse fix corrige de tabela o mesmo bug já existente em `/inscricao/[slug]` (que hoje monta o
parâmetro mas nunca era honrado) e em `/completar-cadastro` — ambos passam a voltar corretamente
para a página de origem depois do login.

## Fora de escopo

- Qualquer vínculo com aceite de Termos de Uso — não existe no sistema, não será criado aqui.
- Rodapé de opt-out em e-mail.
- Filtro de campanhas de WhatsApp em massa por `receivePromotionalMessages` — depende deste
  sub-projeto existir, mas é implementado no sub-projeto de campanhas.
- Endereço obrigatório do atleta — sub-projeto separado.
- Qualquer alteração de comportamento para `ORGANIZER`/`ADMIN`/`ASSISTANT` (as preferências só
  afetam recipientRoles `BUYER`/`ATHLETE`).

## Testes

- `lib/whatsapp.ts`: `sendWhatsAppMessage` com `appendPreferencesFooter: true` inclui o rodapé;
  sem a opção (ou `false`), não inclui — nenhuma regressão nos call-sites existentes que não
  passam a opção.
- `lib/notifications.ts`, `lib/alerts/abandoned-cart.ts`, `lib/alerts/payment-error.ts`:
  teste novo por arquivo garantindo que `receiveEventMessages: false` bloqueia **tanto** e-mail
  quanto WhatsApp (não só um canal), e que `true` (ou ausente/default) continua enviando como
  antes — nenhum teste existente deve quebrar.
- `PATCH /api/me/preferences`: aceita `receivePromotionalMessages`/`receiveEventMessages`
  isoladamente ou junto com `uiDensity`; rejeita valores não-booleanos.
- `LoginForm` (ou função extraída de validação de callback): unitário cobrindo aceito (`/dashboard`,
  `/preferencias`, `/inscricao/abc`), rejeitado (`//evil.com`, `https://evil.com`, `javascript:...`).
- Sem testes de UI (convenção já estabelecida no projeto) — verificação manual do fluxo completo
  (deslogar → clicar link de preferências → login → cair em `/preferencias` → alterar → confirmar
  que a próxima mensagem respeita a escolha) fica pendente de ambiente com acesso ao banco, mesma
  limitação já registrada em `PROGRESSO.md` para features anteriores.
