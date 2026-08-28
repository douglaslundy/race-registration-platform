# Design: WhatsApp oficial via Twilio (provider selecionável, Evolution mantida)

Data: 2026-08-28
Sub-projeto A de um pedido maior (ver "Contexto" abaixo). Sub-projetos B (múltiplas contas
Mercado Pago) e C (snapshot/override de dados da inscrição) ficam para specs próprios.

## Contexto

Pedido do usuário de 2026-08-28: adicionar integração oficial do WhatsApp via **Twilio**, mantendo
a Evolution API como alternativa, com o admin escolhendo qual usar. Análise do sistema em produção:

- **Camada de domínio:** `lib/whatsapp.ts` expõe `sendWhatsAppMessage(phone, text, messageType?, options?)`
  e `sendWhatsAppDocument(phone, base64, filename, caption, options?)`. Faz normalização de telefone
  (`normalizePhoneForWhatsApp` → só dígitos, DDI 55), grava `MessageLog` (SENT/FAILED) via
  `recordMessageLog`, e re-lança o erro pro chamador.
- **Camada de transporte:** `lib/whatsapp/evolution-client.ts` — HTTP cru contra a Evolution API
  (`sendTextMessage(config, phone, text)` → `{ providerMessageId: string | null }`;
  `sendMediaMessage(config, phone, base64, filename, caption, mediatype)` → `Promise<void>`).
- **Config:** `lib/whatsapp-settings.ts` — `getWhatsAppConfig()` lê 3 settings (`whatsapp_api_url`,
  `whatsapp_api_key`, `whatsapp_instance_name`) de `platform_settings`, com fallback pra env.
  `isWhatsAppConfigured(config)`.
- **UI admin:** `app/admin/whatsapp/page.tsx` → `WhatsAppCredentialsForm` (salva via
  `POST /api/admin/settings`, rota genérica key/value, só `role === "ADMIN"`) +
  `WhatsAppConnectionPanel` (pareamento por QR — conceito exclusivo da Evolution).
- **Rotas Evolution-only:** `/api/admin/whatsapp/{instance,status,disconnect,delete,test}`. `test`
  já chama `sendWhatsAppMessage` (camada de domínio), então fica provider-aware de graça.
- **Webhook de status (entrada):** `POST /api/webhooks/whatsapp` — recebe `MESSAGES_UPDATE` da
  Evolution (auth: `?secret=` comparado com `WHATSAPP_WEBHOOK_SECRET`), mapeia `DELIVERY_ACK`→
  DELIVERED / `READ`→READ e chama `updateMessageLogStatusByProviderMessageId` +
  `updateCampaignRecipientStatusByProviderMessageId`.
- **`MessageLog`** já tem os status `SENT | DELIVERED | READ | FAILED` + `deliveredAt`/`readAt` +
  `updateMessageLogStatusByProviderMessageId(providerMessageId, "DELIVERED"|"READ")` idempotente
  (`STATUS_RANK`, nunca regride).
- **`twilio` SDK não está instalado** (28 deps hoje).
- **2FA (`SensitiveActionCode`)** já existe e cobre estorno/aprovação de cancelamento. Decisão do
  usuário: config de WhatsApp **não** entra sob 2FA nesta leva — segue só permissão admin.

Restrição operacional confirmada: WhatsApp Business exige **template pré-aprovado** para toda
mensagem iniciada pela empresa (todos os nossos alertas são). A Evolution/Baileys ignora isso (é
não-oficial); o Twilio recusa texto livre fora da janela de 24h. Decisão do usuário: usar **um
template utilitário único** com uma variável de corpo `{{1}}`, onde o provider Twilio injeta o
texto que o sistema já renderiza hoje.

## Objetivo

Tornar o envio de WhatsApp agnóstico de provider: o resto do sistema chama
`sendWhatsAppMessage(...)` sem saber se o provider ativo é Evolution ou Twilio. Adicionar o provider
Twilio (envio + status de entrega + tratamento de erro), a config na tela de WhatsApp existente, e o
webhook de status do Twilio. **Não** remover nem alterar o comportamento da Evolution.

## Não-objetivos (fora do escopo desta leva)

- Anexo de mídia via Twilio (QR do kit, PDF de relatório) — Twilio exige `mediaUrl` HTTPS público,
  não base64. Ver "Pendências".
- Mapear cada `messageType` a um template Twilio próprio — usa-se um template utilitário único.
- 2FA na config de WhatsApp — decisão explícita do usuário.
- Backup/import e credencial Mercado Pago sob 2FA — vão no sub-projeto B.
- Templates de campanha/alerta editáveis (`/admin/mensagens`) — não mudam; o texto renderizado é o
  que entra em `{{1}}` do template Twilio.

---

## 1. Seleção de provider

### 1.1 Setting

Nova setting `whatsapp_provider`: `"evolution"` (default) ou `"twilio"`. Fallback env
`WHATSAPP_PROVIDER`. Sem migração de schema.

`lib/whatsapp-settings.ts`:

```ts
export type WhatsAppProvider = "evolution" | "twilio";

export async function getWhatsAppProvider(): Promise<WhatsAppProvider> {
  const v = (await getSetting("whatsapp_provider"))?.toLowerCase();
  if (v === "twilio" || v === "evolution") return v;
  const env = process.env.WHATSAPP_PROVIDER?.toLowerCase();
  return env === "twilio" ? "twilio" : "evolution";
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;   // número WhatsApp habilitado, formato E.164 sem "whatsapp:" (ex: "+5511999999999")
  contentSid: string;   // Content SID do template utilitário aprovado
}

export async function getTwilioConfig(): Promise<TwilioConfig> {
  const [accountSid, authToken, fromNumber, contentSid] = await Promise.all([
    getSetting("twilio_account_sid"),
    getSetting("twilio_auth_token"),
    getSetting("twilio_from_number"),
    getSetting("twilio_content_sid"),
  ]);
  return {
    accountSid: accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "",
    fromNumber: (fromNumber ?? process.env.TWILIO_FROM_NUMBER ?? "").trim(),
    contentSid: (contentSid ?? process.env.TWILIO_CONTENT_SID ?? "").trim(),
  };
}

export function isTwilioConfigured(c: TwilioConfig): boolean {
  return Boolean(c.accountSid && c.authToken && c.fromNumber && c.contentSid);
}
```

`getWhatsAppConfig()` (Evolution) e `isWhatsAppConfigured()` **não mudam** — continuam usados pelas
rotas de QR/instance.

### 1.2 Interface `WhatsAppSender`

Novo arquivo `lib/whatsapp/sender.ts`:

```ts
export interface WhatsAppSender {
  readonly provider: WhatsAppProvider;
  sendText(phone: string, text: string, ctx: SendContext): Promise<{ providerMessageId: string | null }>;
  sendMedia(
    phone: string, base64Media: string, filename: string, caption: string,
    mediatype: "document" | "image", ctx: SendContext,
  ): Promise<{ providerMessageId: string | null }>;
  isConfigured(): boolean;
}

/** Dados que o TwilioSender precisa pro statusCallback; o EvolutionSender ignora. */
export interface SendContext {
  messageType?: string;
}

export async function getWhatsAppSender(): Promise<WhatsAppSender> {
  const provider = await getWhatsAppProvider();
  if (provider === "twilio") return new TwilioSender(await getTwilioConfig());
  return new EvolutionSender(await getWhatsAppConfig());
}
```

`phone` chega **já normalizado** (a camada de domínio em `lib/whatsapp.ts` normaliza antes de
chamar o sender — comportamento atual preservado).

### 1.3 `EvolutionSender`

`lib/whatsapp/evolution-client.ts` ganha uma classe wrapper (ou `lib/whatsapp/evolution-sender.ts`
importando as funções atuais). Reusa `sendTextMessage` / `sendMediaMessage` sem alterá-las, exceto:
`sendMediaMessage` passa a devolver `{ providerMessageId: null }` em vez de `void` (a Evolution não
retorna id de mídia) — mudança de tipo interna, nenhum chamador externo depende do retorno de
`sendWhatsAppDocument` (hoje `Promise<void>`).

`EvolutionSender.isConfigured()` = `isWhatsAppConfigured(this.config)`.

Os erros lançados hoje pelo `evolution-client` (`throw new Error("Evolution API 4xx ...")`) passam a
ser normalizados para `WhatsAppSendError` — ver §3.

### 1.4 `lib/whatsapp.ts` — trocar a chamada direta

`sendWhatsAppMessage`:

```ts
export async function sendWhatsAppMessage(phone, text, messageType?, options?) {
  const sender = await getWhatsAppSender();
  if (!sender.isConfigured()) {
    throw new Error("WhatsApp não configurado. Configure em Admin → WhatsApp.");
  }
  const finalText = options?.appendPreferencesFooter ? `${text}${buildPreferencesFooterText()}` : text;
  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  const subject = options?.logSubject ?? truncateForSubject(finalText);
  const relatedEntity = /* ...igual hoje... */;

  try {
    const { providerMessageId } = await sender.sendText(normalizedPhone, finalText, { messageType });
    await recordMessageLog({ channel: "WHATSAPP", messageType, subject, recipientAddress: normalizedPhone, status: "SENT", ...(providerMessageId ? { providerMessageId } : {}), ...relatedEntity });
    return { providerMessageId: providerMessageId ?? undefined };
  } catch (err) {
    await recordMessageLog({ channel: "WHATSAPP", messageType, subject, recipientAddress: normalizedPhone, status: "FAILED", errorMessage: safeErrorMessage(err), ...relatedEntity });
    throw err;
  }
}
```

`sendWhatsAppDocument`: mesma troca, chamando `sender.sendMedia(...)`. **`recordMessageLog` continua
inteiramente na camada de domínio** — os dois providers passam pelo mesmo caminho de auditoria.

`safeErrorMessage(err)`: se `err instanceof WhatsAppSendError`, retorna `"${err.kind}: ${label}"`
(label genérico em pt-BR por kind); senão, `err.message` truncado. Nunca inclui corpo cru do
provider, token, ou SID.

Nenhum `if (provider === "twilio")` fora de `sender.ts` / `getWhatsAppSender`.

---

## 2. `TwilioSender` (`lib/whatsapp/twilio-client.ts`)

### 2.1 Dependência

`npm install twilio` (SDK oficial). Adiciona ~1 dep + transitivas.

### 2.2 Envio de texto

```ts
import twilio from "twilio";

export class TwilioSender implements WhatsAppSender {
  readonly provider = "twilio" as const;
  private client;
  constructor(private config: TwilioConfig) {
    this.client = twilio(config.accountSid, config.authToken, { timeout: 10_000 });
  }
  isConfigured() { return isTwilioConfigured(this.config); }

  async sendText(phone: string, text: string, ctx: SendContext) {
    try {
      const msg = await this.client.messages.create({
        from: `whatsapp:${this.config.fromNumber}`,
        to: `whatsapp:+${phone}`,               // phone chega como "55XXXXXXXXXXX" (só dígitos, DDI 55)
        contentSid: this.config.contentSid,
        contentVariables: JSON.stringify({ "1": text }),
        statusCallback: twilioStatusCallbackUrl(),
      });
      return { providerMessageId: msg.sid };
    } catch (err) {
      throw classifyTwilioError(err);
    }
  }

  async sendMedia(phone, base64, filename, caption, mediatype, ctx) {
    // Twilio exige mediaUrl HTTPS público — não suportamos base64 nesta leva.
    // Envia só a legenda como texto (mensagem chega, sem o anexo) e loga a limitação.
    console.warn("[twilio] sendMedia sem suporte a base64 — enviando só a legenda. filename=%s", filename);
    return this.sendText(phone, caption, ctx);
  }
}
```

`twilioStatusCallbackUrl()`: função exportada de `lib/whatsapp/twilio-client.ts`, retorna
`${NEXT_PUBLIC_APP_URL ?? NEXTAUTH_URL}/api/webhooks/whatsapp/twilio` (mesma base já usada em
`buildPreferencesFooterText`). Usada tanto no `messages.create` quanto na rota do webhook (a URL
passada a `twilio.validateRequest` tem que ser byte-a-byte a mesma registrada em `statusCallback`).
Se a base não estiver setada, o `TwilioSender` omite `statusCallback` (envio funciona, só não
recebe ACK) e o webhook responde 403 (URL vazia nunca valida).

### 2.3 Template utilitário

O template `contentSid` é criado e aprovado pelo admin no console Twilio/Meta: **1 variável de
corpo** (`{{1}}`), categoria "utility". O sistema não cria template — só referencia o SID.
Documentar no README/config helper: "o template deve ter exatamente uma variável `{{1}}` que
recebe o texto completo da notificação". Se o texto violar as regras de template utilitário da Meta
(ex: conteúdo claramente promocional), o Twilio recusa com `63016`/`63018` → `INVALID_TEMPLATE`
(ver §3), logado, e a mensagem conta como FAILED — o e-mail (quando há fallback, ex: código 2FA)
segue independente.

---

## 3. Taxonomia de erro (`lib/whatsapp/errors.ts`)

```ts
export type WhatsAppErrorKind =
  | "AUTH" | "INVALID_NUMBER" | "INVALID_TEMPLATE"
  | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "TIMEOUT" | "UNKNOWN";

export class WhatsAppSendError extends Error {
  constructor(readonly kind: WhatsAppErrorKind, message: string, readonly providerCode?: string) {
    super(message);
    this.name = "WhatsAppSendError";
  }
}

const KIND_LABEL: Record<WhatsAppErrorKind, string> = {
  AUTH: "credenciais do provedor de WhatsApp inválidas",
  INVALID_NUMBER: "número de WhatsApp inválido ou inexistente",
  INVALID_TEMPLATE: "template do WhatsApp inválido ou não aprovado",
  RATE_LIMITED: "limite de envio do provedor atingido, tente mais tarde",
  PROVIDER_UNAVAILABLE: "provedor de WhatsApp temporariamente indisponível",
  TIMEOUT: "tempo de resposta do provedor esgotado",
  UNKNOWN: "falha ao enviar WhatsApp",
};
export function whatsAppErrorLabel(kind: WhatsAppErrorKind): string { return KIND_LABEL[kind]; }
```

### 3.1 `classifyTwilioError(err)`

Twilio SDK lança um erro com `.code` (número), `.status` (HTTP), `.message`:

| code / status | kind |
|---|---|
| `20003` | AUTH |
| `21211`, `21214`, `21614`, `63003` | INVALID_NUMBER |
| `63016`, `63018`, `63005` | INVALID_TEMPLATE |
| `20429`, HTTP `429` | RATE_LIMITED |
| HTTP `5xx`, `20500` | PROVIDER_UNAVAILABLE |
| SDK timeout (`err.code === "ETIMEDOUT"` / message contém "timeout") | TIMEOUT |
| resto | UNKNOWN |

Guarda `providerCode = String(err.code ?? err.status)`. `message` = `KIND_LABEL[kind]` (nunca o
`err.message` cru do Twilio).

### 3.2 `classifyEvolutionError(err)`

O `evolution-client` hoje lança `Error("Evolution API <status> ao <ação>: <corpo truncado>")`.
Passo a extrair o status: helper `evolutionFetch` já tem `status` — os wrappers passam a lançar
`WhatsAppSendError` direto em vez de `Error`:

| status | kind |
|---|---|
| `401`, `403` | AUTH |
| `400` (corpo menciona número/jid) | INVALID_NUMBER; senão UNKNOWN |
| `404` (instância) | PROVIDER_UNAVAILABLE |
| `429` | RATE_LIMITED |
| `5xx` | PROVIDER_UNAVAILABLE |
| `fetch` lança (rede) | PROVIDER_UNAVAILABLE (ou TIMEOUT se `err.name === "TimeoutError"` / `AbortError`) |

O `evolution-client` **não** passa a incluir o corpo cru na mensagem do `WhatsAppSendError` (hoje
inclui — `JSON.stringify(body).slice(0,300)`). O corpo cru vai só pro `console.error` de
diagnóstico, nunca pro `MessageLog.errorMessage` nem pra resposta HTTP.

### 3.3 Consumidores

- `lib/whatsapp.ts` grava `MessageLog.errorMessage = safeErrorMessage(err)` (kind + label).
- Chamadores de alerta (`notifyOrderConfirmed`, `sendAbandonedCartAlert`, etc.) já fazem
  `try/catch` + `console.error` — sem mudança; o erro que capturam agora é `WhatsAppSendError`,
  cujo `.message` já é seguro pra logar.
- `/api/admin/whatsapp/test/route.ts`: hoje retorna `err.message` cru no 502. Passa a retornar
  `whatsAppErrorLabel(err.kind)` quando `err instanceof WhatsAppSendError` (senão "Falha ao enviar
  WhatsApp de teste"). Melhoria de vazamento incluída nesta leva.
- **Fallback do §5 (código 2FA)**: `requestSensitiveActionCode` chama `sendWhatsAppMessage` dentro
  de `try/catch` best-effort — o e-mail já foi confirmado antes. Comportamento **idêntico**: se o
  WhatsApp (agora via Twilio) falhar, loga e segue. Se o e-mail falhar, aborta. Nenhuma mudança
  nesse arquivo.

---

## 4. Webhook de status do Twilio

### 4.1 Rota `POST /api/webhooks/whatsapp/twilio`

- Body: `application/x-www-form-urlencoded` (Twilio manda form, não JSON). Ler com
  `await req.formData()`.
- **Validação de assinatura (fail closed):**
  ```ts
  import twilio from "twilio";
  const authToken = (await getTwilioConfig()).authToken;
  const signature = req.headers.get("x-twilio-signature") ?? "";
  const url = twilioStatusCallbackUrl(); // a MESMA URL registrada em statusCallback
  const params = Object.fromEntries(formData.entries());
  if (!authToken || !twilio.validateRequest(authToken, signature, url, params)) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 403 });
  }
  ```
  Se `authToken` vazio (provider ainda é evolution / não configurado) → 403.
- Campos: `MessageSid`, `MessageStatus` (`queued|sending|sent|delivered|read|failed|undelivered`),
  `ErrorCode` (quando falha).
- Mapeamento:
  - `delivered` → `updateMessageLogStatusByProviderMessageId(sid, "DELIVERED")`
  - `read` → `updateMessageLogStatusByProviderMessageId(sid, "READ")`
  - `failed` / `undelivered` → `updateMessageLogStatusByProviderMessageId(sid, "FAILED")` (ver §4.2)
  - `queued|sending|sent` → no-op (já registramos SENT no envio)
  - Também chama `updateCampaignRecipientStatusByProviderMessageId(sid, <status>)` para `delivered`/
    `read`/`failed`, igual ao webhook Evolution (verificar assinatura dessa função — pode precisar
    aceitar `"FAILED"`; se hoje só aceitar DELIVERED/READ, estender igual §4.2).
- `MessageSid` desconhecido no `MessageLog` → `updateMessageLogStatusByProviderMessageId` já faz
  no-op (`if (!existing) return`). Responder `200 { ok: true }` sempre (mesmo padrão do webhook
  Evolution — nunca 4xx/5xx pra Twilio não ficar reenviando).
- **Idempotência:** garantida por `updateMessageLogStatusByProviderMessageId` (STATUS_RANK, nunca
  regride). Um `delivered` duplicado é no-op.

### 4.2 Estender `updateMessageLogStatusByProviderMessageId` para `FAILED`

`lib/message-logs.ts`. Hoje a assinatura é `(providerMessageId, status: "DELIVERED" | "READ")`.
Passa a aceitar `"FAILED"`:

```ts
const STATUS_RANK: Record<MessageLogStatus, number> = { SENT: 0, FAILED: 0, DELIVERED: 1, READ: 2 };

export async function updateMessageLogStatusByProviderMessageId(
  providerMessageId: string,
  status: "DELIVERED" | "READ" | "FAILED",
  errorMessage?: string,
): Promise<void> {
  const existing = await db.messageLog.findFirst({ where: { providerMessageId } });
  if (!existing) return;
  const current = existing.status as MessageLogStatus;
  if (status === "FAILED") {
    // só marca FAILED se ainda estava em SENT — não reverte um DELIVERED/READ já confirmado
    if (current !== "SENT") return;
    await db.messageLog.update({ where: { id: existing.id }, data: { status: "FAILED", errorMessage: errorMessage ?? existing.errorMessage } });
    return;
  }
  if (STATUS_RANK[status] <= STATUS_RANK[current]) return;
  await db.messageLog.update({ where: { id: existing.id }, data: { status, ...(status === "DELIVERED" ? { deliveredAt: new Date() } : {}), ...(status === "READ" ? { readAt: new Date() } : {}) } });
}
```

O webhook Evolution existente (`/api/webhooks/whatsapp`) não passa `errorMessage` — a nova
assinatura é retrocompatível (parâmetro opcional). O `ErrorCode` do Twilio vira
`errorMessage = "Twilio ${ErrorCode}"` (código, não texto — sem PII/secret).

### 4.3 Registro do webhook

`statusCallback` é passado em cada `messages.create` (§2.2) — não precisa configurar nada global no
console Twilio. O admin só precisa garantir que `NEXT_PUBLIC_APP_URL` está setado (já está, em prod).

---

## 5. UI admin (`app/admin/whatsapp`)

### 5.1 Página

`app/admin/whatsapp/page.tsx`:
- Busca `getWhatsAppProvider()` além de `getWhatsAppConfig()` / (novo) `getTwilioConfig()`.
- Título muda de "WhatsApp (Evolution API)" para "WhatsApp".
- Seletor de provider no topo (server component passa o valor atual; um client component
  `WhatsAppProviderSelector` salva `whatsapp_provider` via `/api/admin/settings` e dá `router.refresh()`).
- Card "Credenciais": renderiza `WhatsAppCredentialsForm` (Evolution) **ou** um novo
  `TwilioCredentialsForm` conforme o provider.
- Card "Conexão": `WhatsAppConnectionPanel` (QR) **só** com Evolution. Com Twilio, um card
  "Teste de envio" com input de telefone + botão (chama `/api/admin/whatsapp/test`, que já é
  provider-aware). O painel de teste também serve pra Evolution (é útil nos dois).

### 5.2 `TwilioCredentialsForm.tsx` (novo)

Segue o padrão de `WhatsAppCredentialsForm`: campos Account SID, Auth Token (`type="password"`,
placeholder "Deixe em branco para manter o atual", **nunca** pré-preenchido com o valor real),
From number (E.164), Content SID. Salva via `POST /api/admin/settings` (keys `twilio_account_sid`,
`twilio_auth_token`, `twilio_from_number`, `twilio_content_sid`). Auth Token só é enviado se o
campo não estiver vazio (igual ao `apiKey` da Evolution hoje). Indicadores "Configurado / Não
configurado" por campo (server component passa `Boolean(config.x)`, nunca o valor).

### 5.3 Rotas Evolution-only

`/api/admin/whatsapp/{instance,status,disconnect,delete}`: no início, se `getWhatsAppProvider() ===
"twilio"`, retornar `400 { error: "Ação disponível apenas com o provedor Evolution API" }`. O
frontend já não mostra o painel de QR com Twilio, mas o guard no backend evita chamada manual.

### 5.4 Sem 2FA

Salvar credenciais (Evolution ou Twilio) e trocar de provider continuam só com `role === "ADMIN"`
+ auditoria `SETTING_UPDATED`.

**Mascaramento de secrets no audit log (incluído nesta leva):** hoje `/api/admin/settings` grava
`oldValue`/`newValue` crus no metadata do `SETTING_UPDATED` — para `twilio_auth_token` (e já para
`mp_access_token`, `pagarme_api_key`, `whatsapp_api_key`, etc.) isso coloca o secret no `AuditLog`.
Corrigir: uma lista `SECRET_SETTING_KEYS` (ou match por sufixo `_token`/`_key`/`_secret`/
`_password`) → quando a key bater, o metadata grava `oldValue`/`newValue` como `"***"` (mantendo
só `key` e um booleano `hadValue`/`hasValue` pra rastreabilidade). Corrige um vazamento
pré-existente de baixo risco (só admin lê o audit log) de graça.

---

## 6. Compatibilidade

- **Sem migração de schema.** Tudo via `platform_settings`. `whatsapp_provider` default
  `"evolution"` → comportamento 100% idêntico ao atual para quem não mudar nada.
- **Evolution intacta:** `evolution-client.ts` só ganha normalização de erro (`WhatsAppSendError`)
  e `sendMediaMessage` devolve `{ providerMessageId: null }`. Nenhum endpoint/fluxo Evolution muda
  de comportamento observável.
- **Nova dependência:** `twilio`. `npm ci` no build da imagem já cobre. Sem `db push`.
- **Todos os consumidores de `sendWhatsAppMessage`** (alertas, campanhas, 2FA, resumo diário,
  teste) continuam chamando a mesma função com a mesma assinatura.
- Deploy: `git pull` → `docker build` → restart. Sem passo de banco.

---

## 7. Testes

Vitest, `db` auto-mockado. `twilio` mockado via `vi.mock("twilio")`.

### 7.1 `tests/whatsapp-twilio-client.test.ts` (novo)

- `sendText` ok: chama `client.messages.create` com `from: "whatsapp:+55..."`, `to: "whatsapp:+55..."`,
  `contentSid`, `contentVariables === JSON.stringify({ "1": text })`, `statusCallback` presente;
  retorna `{ providerMessageId: <sid> }`.
- `classifyTwilioError`: `{ code: 20003 }` → AUTH; `{ code: 21211 }` → INVALID_NUMBER;
  `{ code: 63016 }` → INVALID_TEMPLATE; `{ status: 429 }` → RATE_LIMITED; `{ status: 503 }` →
  PROVIDER_UNAVAILABLE; `{ code: "ETIMEDOUT" }` → TIMEOUT; erro genérico → UNKNOWN. Mensagem do
  `WhatsAppSendError` nunca contém o `err.message` cru.
- `sendMedia`: cai no fallback (envia legenda como texto), retorna id, loga warn.
- `isConfigured`: false com qualquer campo vazio.

### 7.2 `tests/whatsapp-sender.test.ts` (novo)

- `getWhatsAppSender()` com `whatsapp_provider = "evolution"` → instância de `EvolutionSender`;
  `"twilio"` → `TwilioSender`; ausente → `EvolutionSender`.
- `EvolutionSender` normaliza erro do `evolution-client` para `WhatsAppSendError` com o kind certo
  por status HTTP (401→AUTH, 429→RATE_LIMITED, 503→PROVIDER_UNAVAILABLE).

### 7.3 `tests/whatsapp.test.ts` (estender ou novo)

- `sendWhatsAppMessage` com provider twilio: grava `MessageLog` SENT com `providerMessageId` do
  Twilio; erro → `MessageLog` FAILED com `errorMessage` = kind+label (não o erro cru); re-lança.
- Comportamento com provider evolution **inalterado** (testes existentes seguem verdes).
- `sender.isConfigured() === false` → lança "WhatsApp não configurado" (igual hoje) e **não**
  grava MessageLog de tentativa.

### 7.4 `tests/whatsapp-twilio-webhook-route.test.ts` (novo)

- Assinatura ausente/ inválida → 403; `authToken` vazio → 403.
- Assinatura válida (`twilio.validateRequest` mockado `true`): `MessageStatus = "delivered"` →
  chama `updateMessageLogStatusByProviderMessageId(sid, "DELIVERED")`; `"read"` → READ;
  `"failed"` com `ErrorCode = "63016"` → `updateMessageLogStatusByProviderMessageId(sid, "FAILED",
  "Twilio 63016")`; `"sent"` → no-op.
- `MessageSid` desconhecido → 200, nenhuma exceção.
- Idempotência: 2× `delivered` → a 2ª é no-op (garantido pela função, testado no unit dela).

### 7.5 `tests/message-logs.test.ts` (estender)

- `updateMessageLogStatusByProviderMessageId(sid, "FAILED")` só marca FAILED se status atual for
  SENT; se já for DELIVERED/READ → no-op.
- `"DELIVERED"`/`"READ"` seguem exatamente o comportamento atual (nunca regride).

### 7.6 `tests/admin-settings-route.test.ts` (estender — mascaramento §5.4)

- Salvar `twilio_auth_token` → `AuditLog` `SETTING_UPDATED` metadata com `newValue: "***"`, não o
  token. Salvar uma key não-secreta (ex: `whatsapp_provider`) → metadata continua com o valor real.

### 7.7 Validação final

`npx vitest run` (suíte toda verde), `npx tsc --noEmit`, `npm run build` — todos limpos.

---

## 8. Arquivos

**Criados:**
- `lib/whatsapp/sender.ts` — interface `WhatsAppSender`, `SendContext`, `getWhatsAppSender()`.
- `lib/whatsapp/twilio-client.ts` — `TwilioSender`, `classifyTwilioError`.
- `lib/whatsapp/evolution-sender.ts` — `EvolutionSender` (wrapper das funções atuais).
- `lib/whatsapp/errors.ts` — `WhatsAppSendError`, `WhatsAppErrorKind`, `whatsAppErrorLabel`.
- `components/admin/TwilioCredentialsForm.tsx`, `components/admin/WhatsAppProviderSelector.tsx`.
- `app/api/webhooks/whatsapp/twilio/route.ts`.
- Testes listados no §7.

**Modificados:**
- `lib/whatsapp-settings.ts` — `getWhatsAppProvider`, `getTwilioConfig`, `isTwilioConfigured`, tipos.
- `lib/whatsapp.ts` — `sendWhatsAppMessage`/`sendWhatsAppDocument` usam `getWhatsAppSender()`;
  `safeErrorMessage`.
- `lib/whatsapp/evolution-client.ts` — wrappers lançam `WhatsAppSendError`; `sendMediaMessage`
  retorna `{ providerMessageId: null }`.
- `lib/message-logs.ts` — `updateMessageLogStatusByProviderMessageId` aceita `"FAILED"` + `errorMessage`.
- `app/admin/whatsapp/page.tsx` — seletor de provider + render condicional.
- `app/api/admin/whatsapp/{instance,status,disconnect,delete}/route.ts` — guard "só Evolution".
- `app/api/admin/whatsapp/test/route.ts` — resposta de erro por `kind` (sem vazar `err.message`).
- `app/api/admin/settings/route.ts` — (se §5.4) mascarar secrets no metadata do audit log.
- `package.json` — dep `twilio`.
- `lib/campaigns/delivery-status.ts` — `updateCampaignRecipientStatusByProviderMessageId` aceitar
  `"FAILED"` se hoje não aceitar (verificar na implementação).

---

## 9. Critérios de aceite

- [x] `whatsapp_provider` default `evolution` → envio idêntico ao atual (Evolution).
- [x] Admin troca para `twilio` na tela de WhatsApp e passa a enviar via Twilio.
- [x] `sendWhatsAppMessage` / `sendWhatsAppDocument` não têm `if provider` — só `getWhatsAppSender`.
- [x] Alerta, campanha, código 2FA e resumo diário funcionam com os dois providers.
- [x] Twilio envia via template utilitário (`contentSid` + `{{1}}` = texto renderizado).
- [x] Auth Token / secrets do Twilio nunca voltam pro frontend; mascarados na UI e no audit log.
- [x] Webhook `/api/webhooks/whatsapp/twilio` valida assinatura (fail closed), atualiza
      `MessageLog` (delivered/read/failed) idempotentemente, 200 pra SID desconhecido.
- [x] Erros classificados (AUTH / INVALID_NUMBER / INVALID_TEMPLATE / RATE_LIMITED /
      PROVIDER_UNAVAILABLE / TIMEOUT / UNKNOWN); `MessageLog.errorMessage` e respostas HTTP nunca
      contêm corpo cru do provider, token ou SID.
- [x] Evolution: QR, status, disconnect, delete, envio — tudo inalterado.
- [x] Fallback do §5: e-mail obrigatório, WhatsApp best-effort — comportamento inalterado.
- [x] `vitest` verde, `tsc` limpo, `build` limpo.

---

## 10. Pendências / decisões documentadas

- **Anexo de mídia via Twilio:** não implementado nesta leva (Twilio exige `mediaUrl` HTTPS
  público; nossos envios de mídia são base64 — QR do kit e PDF de relatório de anúncio). Com o
  provider Twilio ativo, esses 2 casos enviam só o texto/legenda, sem o anexo, e logam a limitação.
  **Impacto:** o QR de retirada de kit não vai anexado no WhatsApp quando o provider é Twilio (o
  atleta ainda tem o QR no e-mail de confirmação e na página da inscrição). **Solução futura:**
  subir o base64 pro storage (Supabase, já integrado) e passar a URL pública ao Twilio.
- **Templates por `messageType`:** não implementado — usa-se 1 template utilitário. Se a Meta
  recusar algum conteúdo específico como "não utilitário", esse `messageType` falha (logado) até
  o admin criar um template dedicado; o mapeamento `messageType → contentSid` fica como extensão
  natural (`getTwilioConfig` ganharia um mapa opcional).
- **2FA na config de WhatsApp:** fora de escopo por decisão do usuário. Candidato a revisão junto
  com backup/import e credencial Mercado Pago (sub-projeto B).
- **`resolveRefundManually` / `updatePayoutStatus`:** seguem sem 2FA (deferidos desde 2026-08-11).
