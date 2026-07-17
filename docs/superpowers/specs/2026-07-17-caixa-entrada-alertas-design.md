# Caixa de entrada de mensagens (WhatsApp/E-mail) — admin e organizador

## Contexto

Segundo de 4 sub-projetos independentes pedidos pelo usuário nesta sessão (ordem: filtros de
eventos ✅ deployado → **caixa de entrada de mensagens** → anúncios/Google-Meta Ads → marketplace
de anunciantes privados).

Hoje o sistema envia e-mail e WhatsApp por dois pontos únicos e centralizados:
- `sendMail()` (`lib/email.ts:15`) — usado internamente por todas as ~10 funções de e-mail do
  arquivo (confirmação de inscrição, redefinição de senha, alertas, resumo diário etc.). A única
  exceção é `sendTestEmail()`, que chama o transporter do nodemailer diretamente, sem passar por
  `sendMail()`.
- `sendWhatsAppMessage()` (`lib/whatsapp.ts:5`) — usado por 6 arquivos de alerta
  (`lib/alerts/{abandoned-cart,cancellation-requested,daily-summary,low-stock,payment-error,
  reconciliation}.ts`) e pela rota de teste manual (`app/api/admin/whatsapp/test/route.ts`).
  Hoje não existe nenhum envio de WhatsApp fora do contexto de alertas (não há WhatsApp
  transacional, diferente do e-mail).

Existe uma tabela `AlertLog` (`id, alertType, entityType, entityId, channel, sentAt`, unique em
`[alertType, entityId, channel]`), mas seu propósito é dedupe (evitar reenviar o mesmo alerta pra
o mesmo evento/pedido no mesmo dia), não um histórico completo. Nenhum campo de leitura
(`readAt`/`viewedAt`) existe em lugar nenhum do schema hoje. A integração de WhatsApp (Evolution
API, `lib/whatsapp/evolution-client.ts`) é hoje inteiramente "fire-and-forget": não captura o ID
da mensagem enviada, não tem endpoint receptor de webhook, e o design original
(`docs/superpowers/specs/2026-07-02-evolution-whatsapp-design.md`, linha 95) deixou "webhooks de
status em tempo real" explicitamente fora de escopo na primeira versão.

## Decisões confirmadas com o usuário

- **Público**: admin vê tudo; organizador tem a mesma tela filtrada só pras mensagens endereçadas
  a ele mesmo (não inclui mensagens enviadas aos atletas dos eventos dele).
- **Escopo das mensagens**: todo e-mail e todo WhatsApp que o sistema envia, não só os 6 tipos de
  alerta já existentes — inclui transacionais (confirmação de inscrição, redefinição de senha
  etc.).
- **Confirmação de leitura**: WhatsApp usa confirmação de leitura real (ACK nativo, via webhook da
  Evolution API), condicionada a haver conexão válida no momento do envio/atualização. E-mail fica
  só com status de envio (aceito pelo SMTP) ou falha — sem pixel de rastreio de abertura (taxa de
  leitura por pixel é sabidamente subestimada e não vale o esforço adicional).
- Webhook de leitura do WhatsApp entra neste mesmo sub-projeto (não fica para uma fase futura).

## 1. Schema — novo modelo `MessageLog`

`prisma/schema.prisma` — nova migração aditiva, sem alterar `AlertLog` (continua existindo,
inalterada, só para dedupe):

```prisma
model MessageLog {
  id                 String    @id @default(cuid())
  channel            String    // "EMAIL" | "WHATSAPP"
  subject            String    // assunto do e-mail, ou preview do texto (WhatsApp, truncado)
  recipientAddress   String    // e-mail ou telefone efetivamente usado no envio
  recipientUserId    String?
  relatedEntityType  String?
  relatedEntityId    String?
  status             String    // "SENT" | "DELIVERED" | "READ" | "FAILED"
  providerMessageId  String?   // key.id retornado pela Evolution API (só WhatsApp)
  errorMessage       String?
  sentAt             DateTime?
  deliveredAt        DateTime?
  readAt             DateTime?
  createdAt          DateTime  @default(now())

  recipientUser      User?     @relation(fields: [recipientUserId], references: [id])

  @@index([channel, createdAt])
  @@index([recipientUserId, channel, createdAt])
  @@index([providerMessageId])
}
```

`User` ganha a relação inversa `messageLogs MessageLog[]`.

## 2. Instrumentação — captura centralizada, sem tocar nos ~15 chamadores

### `lib/email.ts`

`sendMail()` passa a, internamente, após tentar o envio via `transporter.sendMail(...)`:
1. Resolver `recipientUserId` via `db.user.findUnique({ where: { email: opts.to } })` (e-mail é
   `@unique` em `User` — lookup exato).
2. Gravar uma linha em `MessageLog` com `channel: "EMAIL"`, `subject: opts.subject`,
   `recipientAddress: opts.to`, `status: "SENT"`, `sentAt: now()` em caso de sucesso: ou
   `status: "FAILED"`, `errorMessage: <mensagem do erro>` em caso de exceção — e então
   **relança o erro original** (o comportamento de quem chama `sendMail()` hoje não muda; só
   passa a ficar registrado também).
3. A gravação do log nunca deve impedir o envio nem mascarar um erro de envio real — se a
   gravação do `MessageLog` falhar (ex. banco fora do ar), captura e ignora silenciosamente
   (best-effort logging, não pode derrubar um fluxo de e-mail que já funcionou).

`sendTestEmail()` continua fora do escopo, como decidido (não passa por `sendMail()`).

`relatedEntityType`/`relatedEntityId` **não são preenchidos nesta primeira versão** — nenhuma das
funções de `lib/email.ts` hoje repassa esse contexto pra `sendMail()`, e adicionar isso exigiria
mudar a assinatura de todas as ~10 funções (fora do princípio de "não tocar nos chamadores"
definido no desenho). Os dois campos ficam no schema para uso futuro, sempre `null` por enquanto.

### `lib/whatsapp.ts`

`sendWhatsAppMessage(phone, text)` passa a:
1. Truncar `text` pra um preview de ~80 caracteres pra usar como `subject` do log.
2. Chamar `sendTextMessage` (que agora retorna o `providerMessageId` — ver seção 3) dentro de um
   try/catch.
3. Resolver `recipientUserId` via `db.user.findFirst({ where: { phone } })` (best-effort, `phone`
   não é único).
4. Gravar a linha em `MessageLog` (`channel: "WHATSAPP"`, `status: "SENT"` + `providerMessageId`
   em caso de sucesso; `status: "FAILED"` + `errorMessage` em caso de exceção) e relançar o erro
   original, mesma lógica de resiliência do e-mail (log nunca mascara nem quebra o envio).

## 3. WhatsApp — webhook de confirmação de leitura

### `lib/whatsapp/evolution-client.ts`

`sendTextMessage` passa a retornar o `key.id` do corpo da resposta da Evolution API (hoje
descartado) — tipo de retorno muda de `Promise<void>` para `Promise<{ providerMessageId: string
}>`.

Nova função `setWebhook(config: WhatsAppConfig, url: string): Promise<void>` — chama
`POST /webhook/set/{instance}` da Evolution API, inscrevendo no evento `MESSAGES_UPDATE`.

### Registro automático do webhook

No polling de status já existente (`app/api/admin/whatsapp/status/route.ts`, consumido pelo
painel `/admin/whatsapp`): quando `getConnectionState` retorna o estado conectado pela primeira
vez numa sessão de polling (transição pra "open"), o backend chama `setWebhook` apontando pra
`${NEXT_PUBLIC_APP_URL}/api/webhooks/whatsapp?secret=<segredo>`. Idempotente — chamar de novo com
a instância já conectada não tem efeito colateral (Evolution API apenas atualiza a config do
webhook).

### Novo endpoint receptor: `POST /api/webhooks/whatsapp`

- Autenticação: query param `?secret=` comparado a uma env var (`WHATSAPP_WEBHOOK_SECRET`),
  mesmo padrão de segredo compartilhado — não é uma sessão de usuário, é a Evolution API chamando.
- Corpo: evento `MESSAGES_UPDATE` da Evolution API, contém `key.id` (o `providerMessageId`) e o
  status do ACK (1=sent, 2=delivered, 3=read — mapeado pra `DELIVERED`/`READ`; ACK 1 é ignorado,
  já setamos `SENT` no momento do envio).
- Localiza a linha por `providerMessageId`, atualiza `status` (nunca regride: `READ` não volta
  pra `DELIVERED` se chegar um ACK fora de ordem) e o timestamp correspondente
  (`deliveredAt`/`readAt`).
- Se `providerMessageId` não bater com nenhuma linha (mensagem enviada antes desta feature
  existir, ou de outra instância), ignora silenciosamente — não é erro.

## 4. UI — páginas de caixa de entrada

Duas rotas novas, mesmo padrão de pasta-por-seção do resto do admin/organizador:

- `app/admin/mensagens/page.tsx` — `listMessageLogs()` sem filtro de `recipientUserId`.
- `app/organizador/mensagens/page.tsx` — mesma função, com `recipientUserId` fixado no `userId`
  da sessão logada (resolução no servidor, nunca no cliente).

`lib/message-logs.ts` — função compartilhada `listMessageLogs(filters)`:
```ts
export interface MessageLogFilters {
  channel: "EMAIL" | "WHATSAPP";
  recipientUserId?: string; // presente = escopo do organizador; ausente = admin vê tudo
  status?: "SENT" | "DELIVERED" | "READ" | "FAILED";
  q?: string; // busca em recipientAddress + nome do recipientUser
  from?: Date;
  to?: Date;
  page?: number;
}
```

**Layout de cada página**: duas abas ("WhatsApp" / "E-mail", cada uma chama
`listMessageLogs` com o `channel` correspondente). Lista estilo inbox, uma linha por mensagem:
ícone de status, nome do destinatário (do `recipientUser`, com fallback pro `recipientAddress`
cru quando `recipientUserId` é `null`), assunto/preview, data/hora relativa.

Ícones de status:
- E-mail: ✓ cinza (`SENT`) / ✕ vermelho (`FAILED`).
- WhatsApp: ✓ cinza (`SENT`) / ✓✓ cinza (`DELIVERED`) / ✓✓ azul (`READ`) / ✕ vermelho (`FAILED`).

**Filtros**: select de status, intervalo de data (`de`/`ate`), busca por destinatário — mesmo
padrão visual dos outros filtros do sistema (`EventFilters`, filtros de inscritos). Paginação de
20 por página, mesmo padrão do resto do sistema.

Clicar numa linha abre um modal de detalhe (reaproveitando o padrão de modal já usado no projeto,
nunca `alert()`/`confirm()` nativos — regra do `CLAUDE.md`) com o corpo completo da mensagem e,
se `relatedEntityId` estiver preenchido (não é o caso nesta primeira versão, mas o campo existe),
um link pro registro relacionado.

## Casos de borda

- Destinatário sem conta no sistema (ex.: destinatário extra do resumo diário, cadastrado só por
  e-mail avulso) — `recipientUserId` fica `null`; a linha só aparece na caixa do admin.
- Falha no envio vira uma linha `FAILED` com `errorMessage`, em vez de um erro que hoje se perde
  sem nenhum log visível.
- Reenvio manual (botão "Reenviar confirmação" já existente) gera uma nova linha, não atualiza a
  anterior.
- `phone` não é único em `User` — lookup de `recipientUserId` pro WhatsApp é best-effort (primeira
  correspondência).
- Teste de WhatsApp (`/admin/whatsapp`) passa por `sendWhatsAppMessage`, então aparece no log
  naturalmente — sem tratamento especial.
- Se a instância WhatsApp desconectar depois de mensagens já enviadas, o último status conhecido
  é preservado (nunca regride); novos envios continuam sendo logados como `SENT`, sem
  `DELIVERED`/`READ` até a conexão (e o webhook) voltarem.
- ACK fora de ordem (ex. "read" chega antes de "delivered", que pode acontecer por race condition
  de rede) — o handler nunca regride o status, só avança.

## Fora de escopo (explicitamente)

- Pixel de rastreio de abertura de e-mail.
- Organizador ver mensagens enviadas aos atletas dos eventos dele.
- Política de retenção/expurgo do `MessageLog` — cresce indefinidamente, mesmo padrão do
  `AuditLog` já existente.
- Qualquer mudança em `AlertLog` — continua exatamente como está.
- "Marcar como lido" pelo admin/organizador que está vendo o painel (o "visualizou" é sobre o
  destinatário da mensagem, não sobre quem está olhando o log).
- Reenviar mensagens direto pela tela da caixa de entrada — só visualização.
- `sendTestEmail()` (e-mail de teste do SMTP) — não passa por `sendMail()`, fica fora do log.
- Preenchimento de `relatedEntityType`/`relatedEntityId` nesta primeira versão (campos existem no
  schema, mas ficam sempre `null` — preenchê-los exigiria mudar a assinatura das ~10 funções de
  `lib/email.ts`, fora do princípio de instrumentação centralizada sem tocar nos chamadores).
