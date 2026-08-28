# WhatsApp via Twilio (provider selecionável) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar o Twilio como provider oficial de WhatsApp, selecionável pelo admin, mantendo a Evolution API 100% funcional e sem migração de schema.

**Architecture:** Uma interface `WhatsAppSender` abstrai o canal. `lib/whatsapp.ts` (camada de domínio, que faz o `MessageLog`) para de chamar o `evolution-client` direto e passa a usar `getWhatsAppSender()`, que lê a setting `whatsapp_provider` e devolve `EvolutionSender` ou `TwilioSender`. Twilio envia por um template utilitário único (`contentVariables {"1": textoRenderizado}`). Erros dos dois providers são normalizados para `WhatsAppSendError` (7 kinds), sem vazar corpo cru/token. Webhook novo `/api/webhooks/whatsapp/twilio` para status de entrega.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Prisma 5, Vitest, `twilio` SDK (novo), Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-28-twilio-whatsapp-provider-design.md`

## Global Constraints

- **Evolution API não pode mudar de comportamento observável.** Default `whatsapp_provider = "evolution"` → tudo idêntico.
- **Nenhum `if (provider === "twilio")` fora de `lib/whatsapp/sender.ts` / `getWhatsAppSender`.**
- `MessageLog` (`recordMessageLog`) fica **inteiramente na camada de domínio** (`lib/whatsapp.ts`) — os dois providers passam pelo mesmo caminho de auditoria.
- **Secrets nunca voltam pro frontend nem entram em `MessageLog.errorMessage`, resposta HTTP, ou metadata de `AuditLog`.** `errorMessage` = `kind` + label genérico pt-BR.
- Webhook Twilio: valida `X-Twilio-Signature` com `twilio.validateRequest`, **fail closed** (token vazio ou assinatura inválida → 403). `MessageSid` desconhecido → `200 { ok: true }`.
- `updateMessageLogStatusByProviderMessageId` nunca regride status (`STATUS_RANK`); `"FAILED"` só a partir de `SENT`.
- Sem migração de schema. Config via `platform_settings` (rota genérica `/api/admin/settings`).
- Twilio media (base64): **não suportado nesta leva** — `TwilioSender.sendMedia` envia só a legenda como texto e loga a limitação. Documentado como pendência.
- `contentVariables` do Twilio = `JSON.stringify({ "1": text })` — o template utilitário tem exatamente uma variável `{{1}}`.
- Rótulos de erro em pt-BR, exatamente os do spec §3 (`KIND_LABEL`).
- Ao final: `npx vitest run` + `npx tsc --noEmit` + `npm run build`, todos limpos.
- `db` é auto-mockado em `tests/setup.ts`. `twilio` mockado via `vi.mock("twilio")`.

---

### Task 1: Taxonomia de erro + config de provider

**Files:**
- Create: `lib/whatsapp/errors.ts`
- Modify: `lib/whatsapp-settings.ts`
- Test: `tests/whatsapp-errors.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `lib/whatsapp/errors.ts`: `type WhatsAppErrorKind = "AUTH" | "INVALID_NUMBER" | "INVALID_TEMPLATE" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "TIMEOUT" | "UNKNOWN"`; `class WhatsAppSendError extends Error { readonly kind: WhatsAppErrorKind; readonly providerCode?: string }`; `function whatsAppErrorLabel(kind: WhatsAppErrorKind): string`
  - `lib/whatsapp-settings.ts`: `type WhatsAppProvider = "evolution" | "twilio"`; `getWhatsAppProvider(): Promise<WhatsAppProvider>`; `interface TwilioConfig { accountSid: string; authToken: string; fromNumber: string; contentSid: string }`; `getTwilioConfig(): Promise<TwilioConfig>`; `isTwilioConfigured(c: TwilioConfig): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/whatsapp-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WhatsAppSendError, whatsAppErrorLabel } from "@/lib/whatsapp/errors";

describe("WhatsAppSendError", () => {
  it("carrega kind e providerCode e é instanceof Error", () => {
    const e = new WhatsAppSendError("AUTH", "credenciais inválidas", "20003");
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe("AUTH");
    expect(e.providerCode).toBe("20003");
    expect(e.name).toBe("WhatsAppSendError");
  });

  it("whatsAppErrorLabel devolve um texto pt-BR por kind", () => {
    expect(whatsAppErrorLabel("INVALID_NUMBER")).toMatch(/número/i);
    expect(whatsAppErrorLabel("RATE_LIMITED")).toMatch(/limite/i);
    expect(whatsAppErrorLabel("PROVIDER_UNAVAILABLE")).toMatch(/indispon/i);
    expect(whatsAppErrorLabel("TIMEOUT")).toMatch(/tempo/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/whatsapp-errors.test.ts`
Expected: FAIL — `Cannot find module '@/lib/whatsapp/errors'`.

- [ ] **Step 3: Create `lib/whatsapp/errors.ts`**

```ts
export type WhatsAppErrorKind =
  | "AUTH"
  | "INVALID_NUMBER"
  | "INVALID_TEMPLATE"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "TIMEOUT"
  | "UNKNOWN";

export class WhatsAppSendError extends Error {
  constructor(
    readonly kind: WhatsAppErrorKind,
    message: string,
    readonly providerCode?: string,
  ) {
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

export function whatsAppErrorLabel(kind: WhatsAppErrorKind): string {
  return KIND_LABEL[kind];
}
```

- [ ] **Step 4: Extend `lib/whatsapp-settings.ts`**

Adicionar ao final do arquivo (mantendo `getWhatsAppConfig`/`isWhatsAppConfigured` intactos):

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
  /** número WhatsApp habilitado, E.164 sem o prefixo "whatsapp:" (ex: "+5511999999999") */
  fromNumber: string;
  /** Content SID do template utilitário aprovado (uma variável de corpo {{1}}) */
  contentSid: string;
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

- [ ] **Step 5: Run tests + tsc**

Run: `npx vitest run tests/whatsapp-errors.test.ts && npx tsc --noEmit`
Expected: PASS / limpo.

- [ ] **Step 6: Commit**

```bash
git add lib/whatsapp/errors.ts lib/whatsapp-settings.ts tests/whatsapp-errors.test.ts
git commit -m "feat: taxonomia de erro de WhatsApp + config de provider (evolution/twilio)"
```

---

### Task 2: Interface `WhatsAppSender` + `EvolutionSender`

**Files:**
- Create: `lib/whatsapp/sender.ts`, `lib/whatsapp/evolution-sender.ts`
- Modify: `lib/whatsapp/evolution-client.ts`
- Test: `tests/whatsapp-sender.test.ts`

**Interfaces:**
- Consumes: `WhatsAppSendError`, `WhatsAppErrorKind` (Task 1); `getWhatsAppProvider`, `getWhatsAppConfig`, `isWhatsAppConfigured`, `WhatsAppConfig` (existente + Task 1).
- Produces:
  - `lib/whatsapp/sender.ts`:
    - `interface SendContext { messageType?: string }`
    - `interface WhatsAppSender { readonly provider: WhatsAppProvider; sendText(phone: string, text: string, ctx: SendContext): Promise<{ providerMessageId: string | null }>; sendMedia(phone: string, base64Media: string, filename: string, caption: string, mediatype: "document" | "image", ctx: SendContext): Promise<{ providerMessageId: string | null }>; isConfigured(): boolean }`
    - `getWhatsAppSender(): Promise<WhatsAppSender>` — nesta task só devolve `EvolutionSender`; a Task 3 adiciona o branch twilio.
  - `lib/whatsapp/evolution-sender.ts`: `class EvolutionSender implements WhatsAppSender`
  - `lib/whatsapp/evolution-client.ts`: `sendTextMessage` e `sendMediaMessage` passam a lançar `WhatsAppSendError`; `sendMediaMessage` retorna `Promise<{ providerMessageId: null }>` em vez de `void`.

- [ ] **Step 1: Write the failing test**

Create `tests/whatsapp-sender.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp-settings", async (orig) => {
  const actual = await orig<typeof import("@/lib/whatsapp-settings")>();
  return {
    ...actual,
    getWhatsAppProvider: vi.fn(),
    getWhatsAppConfig: vi.fn(),
    getTwilioConfig: vi.fn(),
  };
});
vi.mock("@/lib/whatsapp/evolution-client", () => ({
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
}));

import { getWhatsAppSender } from "@/lib/whatsapp/sender";
import { getWhatsAppProvider, getWhatsAppConfig } from "@/lib/whatsapp-settings";
import { sendTextMessage } from "@/lib/whatsapp/evolution-client";

const providerMock = vi.mocked(getWhatsAppProvider);
const configMock = vi.mocked(getWhatsAppConfig);

describe("getWhatsAppSender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.mockResolvedValue({ apiUrl: "https://e", apiKey: "k", instanceName: "i" });
  });

  it("provider evolution → EvolutionSender que delega ao evolution-client", async () => {
    providerMock.mockResolvedValue("evolution");
    vi.mocked(sendTextMessage).mockResolvedValue({ providerMessageId: "evo-1" });

    const sender = await getWhatsAppSender();
    expect(sender.provider).toBe("evolution");
    const r = await sender.sendText("5511999999999", "oi", {});
    expect(sendTextMessage).toHaveBeenCalledWith(
      { apiUrl: "https://e", apiKey: "k", instanceName: "i" },
      "5511999999999",
      "oi",
    );
    expect(r).toEqual({ providerMessageId: "evo-1" });
  });

  it("provider ausente → evolution (default)", async () => {
    providerMock.mockResolvedValue("evolution");
    const sender = await getWhatsAppSender();
    expect(sender.provider).toBe("evolution");
  });

  it("EvolutionSender.isConfigured reflete a config", async () => {
    providerMock.mockResolvedValue("evolution");
    configMock.mockResolvedValue({ apiUrl: "", apiKey: "", instanceName: "" });
    const sender = await getWhatsAppSender();
    expect(sender.isConfigured()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/whatsapp-sender.test.ts`
Expected: FAIL — `Cannot find module '@/lib/whatsapp/sender'`.

- [ ] **Step 3: `lib/whatsapp/evolution-client.ts` — lançar `WhatsAppSendError`**

Adicionar no topo:

```ts
import { WhatsAppSendError, type WhatsAppErrorKind } from "./errors";

function kindFromEvolutionStatus(status: number, body: unknown): WhatsAppErrorKind {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 429) return "RATE_LIMITED";
  if (status === 404) return "PROVIDER_UNAVAILABLE";
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  if (status === 400) {
    const s = JSON.stringify(body ?? "").toLowerCase();
    if (s.includes("number") || s.includes("jid") || s.includes("exists")) return "INVALID_NUMBER";
  }
  return "UNKNOWN";
}
```

Em `sendTextMessage`, trocar:

```ts
  if (status >= 400) {
    throw new Error(`Evolution API ${status} ao enviar mensagem: ${JSON.stringify(body).slice(0, 300)}`);
  }
```

por:

```ts
  if (status >= 400) {
    console.error("[evolution] sendText %d: %s", status, JSON.stringify(body).slice(0, 300));
    throw new WhatsAppSendError(kindFromEvolutionStatus(status, body), "falha ao enviar WhatsApp (Evolution)", String(status));
  }
```

Fazer o mesmo em `sendMediaMessage` (`console.error` do corpo cru + `throw new WhatsAppSendError(...)`), e mudar a assinatura de retorno:

```ts
export async function sendMediaMessage(
  config: WhatsAppConfig, phone: string, base64Media: string, fileName: string,
  caption: string, mediatype: "document" | "image" = "document",
): Promise<{ providerMessageId: null }> {
  // ... corpo igual, mas ao final:
  return { providerMessageId: null };
}
```

As demais funções (`createInstance`, `getQrCode`, `getConnectionState`, `logoutInstance`, `deleteInstance`, `setWebhook`) **não mudam** — continuam lançando `Error` comum (não são caminho de envio de mensagem).

- [ ] **Step 4: `lib/whatsapp/evolution-sender.ts`**

```ts
import { getWhatsAppConfig, isWhatsAppConfigured, type WhatsAppConfig } from "@/lib/whatsapp-settings";
import { sendTextMessage, sendMediaMessage } from "./evolution-client";
import type { WhatsAppSender, SendContext } from "./sender";

export class EvolutionSender implements WhatsAppSender {
  readonly provider = "evolution" as const;
  constructor(private config: WhatsAppConfig) {}

  isConfigured() {
    return isWhatsAppConfigured(this.config);
  }

  async sendText(phone: string, text: string, _ctx: SendContext) {
    return sendTextMessage(this.config, phone, text);
  }

  async sendMedia(
    phone: string, base64Media: string, filename: string, caption: string,
    mediatype: "document" | "image", _ctx: SendContext,
  ) {
    return sendMediaMessage(this.config, phone, base64Media, filename, caption, mediatype);
  }
}

export async function buildEvolutionSender(): Promise<EvolutionSender> {
  return new EvolutionSender(await getWhatsAppConfig());
}
```

- [ ] **Step 5: `lib/whatsapp/sender.ts`**

```ts
import { getWhatsAppProvider, type WhatsAppProvider } from "@/lib/whatsapp-settings";
import { buildEvolutionSender } from "./evolution-sender";

export interface SendContext {
  messageType?: string;
}

export interface WhatsAppSender {
  readonly provider: WhatsAppProvider;
  sendText(phone: string, text: string, ctx: SendContext): Promise<{ providerMessageId: string | null }>;
  sendMedia(
    phone: string, base64Media: string, filename: string, caption: string,
    mediatype: "document" | "image", ctx: SendContext,
  ): Promise<{ providerMessageId: string | null }>;
  isConfigured(): boolean;
}

export async function getWhatsAppSender(): Promise<WhatsAppSender> {
  const provider = await getWhatsAppProvider();
  // Task 3 adiciona: if (provider === "twilio") return buildTwilioSender();
  void provider;
  return buildEvolutionSender();
}
```

- [ ] **Step 6: Run tests + tsc**

Run: `npx vitest run tests/whatsapp-sender.test.ts tests/whatsapp.test.ts && npx tsc --noEmit`
Expected: `whatsapp-sender` PASS; `whatsapp.test.ts` (se existir) ainda verde — `lib/whatsapp.ts` não foi tocado ainda, o `evolution-client` só mudou o tipo de erro/retorno de mídia. Se algum teste do evolution-client asserir a mensagem de erro `"Evolution API 4xx ..."`, atualizar pra esperar `WhatsAppSendError` com o `kind` certo.

- [ ] **Step 7: Commit**

```bash
git add lib/whatsapp/sender.ts lib/whatsapp/evolution-sender.ts lib/whatsapp/evolution-client.ts tests/whatsapp-sender.test.ts tests/
git commit -m "feat: interface WhatsAppSender + EvolutionSender (erros normalizados)"
```

---

### Task 3: Dependência `twilio` + `TwilioSender`

**Files:**
- Modify: `package.json` (+ `package-lock.json`)
- Create: `lib/whatsapp/twilio-client.ts`
- Modify: `lib/whatsapp/sender.ts` (adicionar branch twilio)
- Test: `tests/whatsapp-twilio-client.test.ts`

**Interfaces:**
- Consumes: `WhatsAppSender`, `SendContext` (Task 2); `TwilioConfig`, `getTwilioConfig`, `isTwilioConfigured` (Task 1); `WhatsAppSendError` (Task 1).
- Produces:
  - `lib/whatsapp/twilio-client.ts`: `class TwilioSender implements WhatsAppSender`; `function classifyTwilioError(err: unknown): WhatsAppSendError`; `function twilioStatusCallbackUrl(): string` (base + `/api/webhooks/whatsapp/twilio`); `async function buildTwilioSender(): Promise<TwilioSender>`

- [ ] **Step 1: Instalar o SDK**

Run: `npm install twilio`
Then: `npx tsc --noEmit` (só pra garantir que o types do pacote resolve).

- [ ] **Step 2: Write the failing test**

Create `tests/whatsapp-twilio-client.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const messagesCreate = vi.fn();
vi.mock("twilio", () => ({
  default: vi.fn(() => ({ messages: { create: messagesCreate } })),
}));
vi.mock("@/lib/whatsapp-settings", async (orig) => {
  const actual = await orig<typeof import("@/lib/whatsapp-settings")>();
  return { ...actual, getTwilioConfig: vi.fn() };
});

import { TwilioSender, classifyTwilioError } from "@/lib/whatsapp/twilio-client";
import { WhatsAppSendError } from "@/lib/whatsapp/errors";

const CFG = { accountSid: "AC1", authToken: "tok", fromNumber: "+5511999999999", contentSid: "HX1" };

describe("TwilioSender.sendText", () => {
  beforeEach(() => vi.clearAllMocks());

  it("chama messages.create com o template utilitário e o texto na variável 1", async () => {
    messagesCreate.mockResolvedValueOnce({ sid: "SM123" });
    const sender = new TwilioSender(CFG);
    const r = await sender.sendText("5511988887777", "Olá Maria", { messageType: "ORDER_CONFIRMED" });

    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "whatsapp:+5511999999999",
        to: "whatsapp:+5511988887777",
        contentSid: "HX1",
        contentVariables: JSON.stringify({ "1": "Olá Maria" }),
      }),
    );
    expect(r).toEqual({ providerMessageId: "SM123" });
  });

  it("erro de auth (code 20003) → WhatsAppSendError kind AUTH, sem vazar a mensagem crua", async () => {
    messagesCreate.mockRejectedValueOnce(Object.assign(new Error("Authenticate error blah"), { code: 20003, status: 401 }));
    const sender = new TwilioSender(CFG);
    await expect(sender.sendText("5511988887777", "x", {})).rejects.toMatchObject({
      name: "WhatsAppSendError",
      kind: "AUTH",
    });
  });

  it("sendMedia cai no fallback: envia a legenda como texto", async () => {
    messagesCreate.mockResolvedValueOnce({ sid: "SM999" });
    const sender = new TwilioSender(CFG);
    const r = await sender.sendMedia("5511988887777", "BASE64", "kit.png", "Seu QR", "image", {});
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ contentVariables: JSON.stringify({ "1": "Seu QR" }) }),
    );
    expect(r).toEqual({ providerMessageId: "SM999" });
  });

  it("isConfigured false com campo faltando", () => {
    expect(new TwilioSender({ ...CFG, contentSid: "" }).isConfigured()).toBe(false);
  });
});

describe("classifyTwilioError", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ code: 20003 }, "AUTH"],
    [{ code: 21211 }, "INVALID_NUMBER"],
    [{ code: 21614 }, "INVALID_NUMBER"],
    [{ code: 63016 }, "INVALID_TEMPLATE"],
    [{ code: 63018 }, "INVALID_TEMPLATE"],
    [{ code: 20429 }, "RATE_LIMITED"],
    [{ status: 429 }, "RATE_LIMITED"],
    [{ status: 503 }, "PROVIDER_UNAVAILABLE"],
    [{ code: "ETIMEDOUT" }, "TIMEOUT"],
    [{ code: 99999 }, "UNKNOWN"],
  ];
  it.each(cases)("%o → %s", (err, kind) => {
    const e = classifyTwilioError(Object.assign(new Error("raw twilio text"), err));
    expect(e).toBeInstanceOf(WhatsAppSendError);
    expect(e.kind).toBe(kind);
    expect(e.message).not.toContain("raw twilio text");
  });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `npx vitest run tests/whatsapp-twilio-client.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 4: `lib/whatsapp/twilio-client.ts`**

```ts
import twilio from "twilio";
import { getTwilioConfig, isTwilioConfigured, type TwilioConfig } from "@/lib/whatsapp-settings";
import { WhatsAppSendError, type WhatsAppErrorKind } from "./errors";
import type { WhatsAppSender, SendContext } from "./sender";

export function twilioStatusCallbackUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/+$/, "");
  return base ? `${base}/api/webhooks/whatsapp/twilio` : "";
}

const CODE_KIND: Record<string, WhatsAppErrorKind> = {
  "20003": "AUTH",
  "21211": "INVALID_NUMBER",
  "21214": "INVALID_NUMBER",
  "21614": "INVALID_NUMBER",
  "63003": "INVALID_NUMBER",
  "63016": "INVALID_TEMPLATE",
  "63018": "INVALID_TEMPLATE",
  "63005": "INVALID_TEMPLATE",
  "20429": "RATE_LIMITED",
  "20500": "PROVIDER_UNAVAILABLE",
  ETIMEDOUT: "TIMEOUT",
  ECONNABORTED: "TIMEOUT",
};

export function classifyTwilioError(err: unknown): WhatsAppSendError {
  const e = err as { code?: string | number; status?: number; message?: string } | undefined;
  const code = e?.code != null ? String(e.code) : undefined;
  const status = typeof e?.status === "number" ? e.status : undefined;
  const msg = String(e?.message ?? "").toLowerCase();

  let kind: WhatsAppErrorKind = "UNKNOWN";
  if (code && CODE_KIND[code]) kind = CODE_KIND[code];
  else if (status === 429) kind = "RATE_LIMITED";
  else if (status != null && status >= 500) kind = "PROVIDER_UNAVAILABLE";
  else if (msg.includes("timeout")) kind = "TIMEOUT";

  return new WhatsAppSendError(kind, `falha ao enviar WhatsApp (Twilio)`, code ?? (status != null ? String(status) : undefined));
}

export class TwilioSender implements WhatsAppSender {
  readonly provider = "twilio" as const;
  private client: ReturnType<typeof twilio>;

  constructor(private config: TwilioConfig) {
    this.client = twilio(config.accountSid, config.authToken, { timeout: 10_000 });
  }

  isConfigured() {
    return isTwilioConfigured(this.config);
  }

  async sendText(phone: string, text: string, _ctx: SendContext) {
    try {
      const cb = twilioStatusCallbackUrl();
      const msg = await this.client.messages.create({
        from: `whatsapp:${this.config.fromNumber}`,
        to: `whatsapp:+${phone}`,
        contentSid: this.config.contentSid,
        contentVariables: JSON.stringify({ "1": text }),
        ...(cb ? { statusCallback: cb } : {}),
      });
      return { providerMessageId: msg.sid ?? null };
    } catch (err) {
      throw classifyTwilioError(err);
    }
  }

  async sendMedia(
    phone: string, _base64Media: string, filename: string, caption: string,
    _mediatype: "document" | "image", ctx: SendContext,
  ) {
    // Twilio exige mediaUrl HTTPS público — base64 não é suportado nesta leva.
    console.warn("[twilio] sendMedia sem suporte a base64 — enviando só a legenda. filename=%s", filename);
    return this.sendText(phone, caption, ctx);
  }
}

export async function buildTwilioSender(): Promise<TwilioSender> {
  return new TwilioSender(await getTwilioConfig());
}
```

- [ ] **Step 5: Wire no `lib/whatsapp/sender.ts`**

```ts
import { buildTwilioSender } from "./twilio-client";

export async function getWhatsAppSender(): Promise<WhatsAppSender> {
  const provider = await getWhatsAppProvider();
  if (provider === "twilio") return buildTwilioSender();
  return buildEvolutionSender();
}
```

Atualizar `tests/whatsapp-sender.test.ts` (Task 2) com um caso: `provider = "twilio"` + `getTwilioConfig` mockado → `sender.provider === "twilio"`.

- [ ] **Step 6: Run tests + tsc**

Run: `npx vitest run tests/whatsapp-twilio-client.test.ts tests/whatsapp-sender.test.ts && npx tsc --noEmit`
Expected: PASS / limpo.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/whatsapp/twilio-client.ts lib/whatsapp/sender.ts tests/
git commit -m "feat: TwilioSender via template utilitário + classificação de erro do Twilio"
```

---

### Task 4: Camada de domínio `lib/whatsapp.ts` usa o sender

**Files:**
- Modify: `lib/whatsapp.ts`
- Test: `tests/whatsapp.test.ts` (estender ou criar)

**Interfaces:**
- Consumes: `getWhatsAppSender` (Tasks 2/3); `WhatsAppSendError`, `whatsAppErrorLabel` (Task 1).
- Produces: `safeErrorMessage(err: unknown): string` (interno, não exportado obrigatoriamente).

- [ ] **Step 1: Write the failing test**

Create/estender `tests/whatsapp.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/whatsapp/sender", () => ({ getWhatsAppSender: vi.fn() }));

import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getWhatsAppSender } from "@/lib/whatsapp/sender";
import { WhatsAppSendError } from "@/lib/whatsapp/errors";

const dbMock = db as any;
const senderMock = vi.mocked(getWhatsAppSender);

function fakeSender(over: Partial<{ sendText: any; isConfigured: any }> = {}) {
  return {
    provider: "twilio" as const,
    sendText: over.sendText ?? vi.fn().mockResolvedValue({ providerMessageId: "SM1" }),
    sendMedia: vi.fn(),
    isConfigured: over.isConfigured ?? (() => true),
  };
}

describe("sendWhatsAppMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.messageLog.create.mockResolvedValue({});
    dbMock.user.findFirst.mockResolvedValue(null);
  });

  it("envia pelo sender ativo e grava MessageLog SENT com providerMessageId", async () => {
    const sender = fakeSender();
    senderMock.mockResolvedValue(sender as any);

    const r = await sendWhatsAppMessage("11988887777", "oi", "ORDER_CONFIRMED");
    expect(sender.sendText).toHaveBeenCalledWith("5511988887777", "oi", { messageType: "ORDER_CONFIRMED" });
    expect(dbMock.messageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: "WHATSAPP", status: "SENT", providerMessageId: "SM1" }) }),
    );
    expect(r).toEqual({ providerMessageId: "SM1" });
  });

  it("erro do sender → MessageLog FAILED com errorMessage seguro (kind+label), e re-lança", async () => {
    const sender = fakeSender({ sendText: vi.fn().mockRejectedValue(new WhatsAppSendError("INVALID_NUMBER", "x", "21211")) });
    senderMock.mockResolvedValue(sender as any);

    await expect(sendWhatsAppMessage("11988887777", "oi", "ORDER_CONFIRMED")).rejects.toBeInstanceOf(WhatsAppSendError);
    const logged = dbMock.messageLog.create.mock.calls.at(-1)[0].data;
    expect(logged.status).toBe("FAILED");
    expect(logged.errorMessage).toMatch(/INVALID_NUMBER/);
    expect(logged.errorMessage).not.toContain("21211");
    expect(logged.errorMessage).not.toMatch(/token|sid/i);
  });

  it("sender não configurado → lança 'WhatsApp não configurado' e NÃO grava MessageLog", async () => {
    senderMock.mockResolvedValue(fakeSender({ isConfigured: () => false }) as any);
    await expect(sendWhatsAppMessage("11988887777", "oi")).rejects.toThrow(/não configurado/i);
    expect(dbMock.messageLog.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/whatsapp.test.ts`
Expected: FAIL — `lib/whatsapp.ts` ainda chama `sendTextMessage(config, ...)` direto.

- [ ] **Step 3: Modificar `lib/whatsapp.ts`**

Trocar os imports do topo:

```ts
import { getWhatsAppSender } from "./whatsapp/sender";
import { WhatsAppSendError, whatsAppErrorLabel } from "./whatsapp/errors";
```

(remover `import { getWhatsAppConfig, isWhatsAppConfigured } from "./whatsapp-settings";` e `import { sendTextMessage, sendMediaMessage } from "./whatsapp/evolution-client";`)

Adicionar helper:

```ts
function safeErrorMessage(err: unknown): string {
  if (err instanceof WhatsAppSendError) return `${err.kind}: ${whatsAppErrorLabel(err.kind)}`;
  const m = err instanceof Error ? err.message : String(err);
  return m.slice(0, 200);
}
```

Em `sendWhatsAppMessage`, trocar o bloco de config + envio:

```ts
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
    await recordMessageLog({
      channel: "WHATSAPP", messageType, subject, recipientAddress: normalizedPhone, status: "SENT",
      ...(providerMessageId ? { providerMessageId } : {}), ...relatedEntity,
    });
    return { providerMessageId: providerMessageId ?? undefined };
  } catch (err) {
    await recordMessageLog({
      channel: "WHATSAPP", messageType, subject, recipientAddress: normalizedPhone, status: "FAILED",
      errorMessage: safeErrorMessage(err), ...relatedEntity,
    });
    throw err;
  }
```

Fazer a troca equivalente em `sendWhatsAppDocument` (chama `sender.sendMedia(normalizedPhone, base64Pdf, filename, caption, options?.mediatype ?? "document", { messageType: options?.messageType })`).

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run tests/whatsapp.test.ts && npx tsc --noEmit`
Expected: PASS / limpo. Rodar também `npx vitest run` filtrado nos testes que exercitam envio de WhatsApp indireto (`tests/alert-*`, `tests/notifications*`, `tests/lib-email*`, `tests/campaigns-*`) e corrigir mocks que assumiam `sendTextMessage` direto.

- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp.ts tests/
git commit -m "feat: sendWhatsAppMessage/Document despacham pelo provider ativo"
```

---

### Task 5: `updateMessageLogStatusByProviderMessageId` aceita `FAILED`

**Files:**
- Modify: `lib/message-logs.ts`
- Modify: `lib/campaigns/delivery-status.ts` (só se `updateCampaignRecipientStatusByProviderMessageId` hoje não aceitar `"FAILED"` — verificar)
- Test: `tests/message-logs.test.ts` (estender ou criar)

**Interfaces:**
- Consumes: nada novo.
- Produces: `updateMessageLogStatusByProviderMessageId(providerMessageId: string, status: "DELIVERED" | "READ" | "FAILED", errorMessage?: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create/estender `tests/message-logs.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { updateMessageLogStatusByProviderMessageId } from "@/lib/message-logs";

const dbMock = db as any;

describe("updateMessageLogStatusByProviderMessageId — FAILED", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.messageLog.update.mockResolvedValue({});
  });

  it("marca FAILED quando o status atual é SENT", async () => {
    dbMock.messageLog.findFirst.mockResolvedValueOnce({ id: "m1", status: "SENT", errorMessage: null });
    await updateMessageLogStatusByProviderMessageId("SM1", "FAILED", "Twilio 63016");
    expect(dbMock.messageLog.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: "FAILED", errorMessage: "Twilio 63016" },
    });
  });

  it("NÃO reverte um DELIVERED para FAILED", async () => {
    dbMock.messageLog.findFirst.mockResolvedValueOnce({ id: "m1", status: "DELIVERED", errorMessage: null });
    await updateMessageLogStatusByProviderMessageId("SM1", "FAILED");
    expect(dbMock.messageLog.update).not.toHaveBeenCalled();
  });

  it("DELIVERED e READ seguem o comportamento atual (nunca regride)", async () => {
    dbMock.messageLog.findFirst.mockResolvedValueOnce({ id: "m1", status: "READ" });
    await updateMessageLogStatusByProviderMessageId("SM1", "DELIVERED");
    expect(dbMock.messageLog.update).not.toHaveBeenCalled();
  });

  it("providerMessageId desconhecido → no-op", async () => {
    dbMock.messageLog.findFirst.mockResolvedValueOnce(null);
    await updateMessageLogStatusByProviderMessageId("SM-x", "FAILED");
    expect(dbMock.messageLog.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/message-logs.test.ts`
Expected: FAIL — assinatura atual não aceita `"FAILED"` (tsc/runtime).

- [ ] **Step 3: Modificar `lib/message-logs.ts`**

```ts
export async function updateMessageLogStatusByProviderMessageId(
  providerMessageId: string,
  status: "DELIVERED" | "READ" | "FAILED",
  errorMessage?: string,
): Promise<void> {
  const existing = await db.messageLog.findFirst({ where: { providerMessageId } });
  if (!existing) return;
  const current = existing.status as MessageLogStatus;

  if (status === "FAILED") {
    if (current !== "SENT") return; // não reverte DELIVERED/READ
    await db.messageLog.update({
      where: { id: existing.id },
      data: { status: "FAILED", errorMessage: errorMessage ?? existing.errorMessage },
    });
    return;
  }

  if (STATUS_RANK[status] <= STATUS_RANK[current]) return;
  await db.messageLog.update({
    where: { id: existing.id },
    data: {
      status,
      ...(status === "DELIVERED" ? { deliveredAt: new Date() } : {}),
      ...(status === "READ" ? { readAt: new Date() } : {}),
    },
  });
}
```

- [ ] **Step 4: Verificar `lib/campaigns/delivery-status.ts`**

Ler `updateCampaignRecipientStatusByProviderMessageId`. Se hoje o tipo do `status` for `"DELIVERED" | "READ"`, estender pra incluir `"FAILED"` e mapear para o status de falha do `CampaignRecipient` (seguir a convenção já usada no arquivo pra falhas — provavelmente já existe um status `FAILED`/`failed`). Se já aceitar, não mudar. Documentar no report o que foi encontrado.

- [ ] **Step 5: Run tests + tsc**

Run: `npx vitest run tests/message-logs.test.ts tests/whatsapp-status-webhook-route.test.ts && npx tsc --noEmit`
Expected: PASS. O webhook Evolution existente (`/api/webhooks/whatsapp`) não passa `errorMessage` — o parâmetro opcional mantém a chamada válida (verificar que o teste do webhook Evolution segue verde).

- [ ] **Step 6: Commit**

```bash
git add lib/message-logs.ts lib/campaigns/delivery-status.ts tests/
git commit -m "feat: updateMessageLogStatusByProviderMessageId aceita FAILED (só a partir de SENT)"
```

---

### Task 6: Webhook de status do Twilio

**Files:**
- Create: `app/api/webhooks/whatsapp/twilio/route.ts`
- Test: `tests/whatsapp-twilio-webhook-route.test.ts`

**Interfaces:**
- Consumes: `getTwilioConfig` (Task 1), `twilioStatusCallbackUrl` (Task 3), `updateMessageLogStatusByProviderMessageId` (Task 5), `updateCampaignRecipientStatusByProviderMessageId` (existente/Task 5), `twilio.validateRequest`.
- Produces: nada.

- [ ] **Step 1: Write the failing test**

Create `tests/whatsapp-twilio-webhook-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const validateRequest = vi.fn();
vi.mock("twilio", () => ({ default: Object.assign(vi.fn(), { validateRequest }) }));
vi.mock("@/lib/whatsapp-settings", async (orig) => {
  const actual = await orig<typeof import("@/lib/whatsapp-settings")>();
  return { ...actual, getTwilioConfig: vi.fn() };
});
vi.mock("@/lib/message-logs", () => ({ updateMessageLogStatusByProviderMessageId: vi.fn() }));
vi.mock("@/lib/campaigns/delivery-status", () => ({ updateCampaignRecipientStatusByProviderMessageId: vi.fn() }));

import { POST } from "@/app/api/webhooks/whatsapp/twilio/route";
import { getTwilioConfig } from "@/lib/whatsapp-settings";
import { updateMessageLogStatusByProviderMessageId } from "@/lib/message-logs";

function formReq(fields: Record<string, string>) {
  const body = new URLSearchParams(fields).toString();
  return new Request("http://localhost/api/webhooks/whatsapp/twilio", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "x-twilio-signature": "sig" },
    body,
  }) as any;
}

describe("POST /api/webhooks/whatsapp/twilio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTwilioConfig).mockResolvedValue({ accountSid: "AC1", authToken: "tok", fromNumber: "+55", contentSid: "HX" });
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  });

  it("assinatura inválida → 403", async () => {
    validateRequest.mockReturnValue(false);
    const res = await POST(formReq({ MessageSid: "SM1", MessageStatus: "delivered" }));
    expect(res.status).toBe(403);
    expect(updateMessageLogStatusByProviderMessageId).not.toHaveBeenCalled();
  });

  it("authToken vazio → 403 (fail closed)", async () => {
    vi.mocked(getTwilioConfig).mockResolvedValue({ accountSid: "", authToken: "", fromNumber: "", contentSid: "" });
    validateRequest.mockReturnValue(true);
    const res = await POST(formReq({ MessageSid: "SM1", MessageStatus: "delivered" }));
    expect(res.status).toBe(403);
  });

  it("delivered → DELIVERED", async () => {
    validateRequest.mockReturnValue(true);
    const res = await POST(formReq({ MessageSid: "SM1", MessageStatus: "delivered" }));
    expect(res.status).toBe(200);
    expect(updateMessageLogStatusByProviderMessageId).toHaveBeenCalledWith("SM1", "DELIVERED");
  });

  it("read → READ", async () => {
    validateRequest.mockReturnValue(true);
    await POST(formReq({ MessageSid: "SM1", MessageStatus: "read" }));
    expect(updateMessageLogStatusByProviderMessageId).toHaveBeenCalledWith("SM1", "READ");
  });

  it("failed com ErrorCode → FAILED + 'Twilio <code>'", async () => {
    validateRequest.mockReturnValue(true);
    await POST(formReq({ MessageSid: "SM1", MessageStatus: "failed", ErrorCode: "63016" }));
    expect(updateMessageLogStatusByProviderMessageId).toHaveBeenCalledWith("SM1", "FAILED", "Twilio 63016");
  });

  it("sent/queued → no-op, 200", async () => {
    validateRequest.mockReturnValue(true);
    const res = await POST(formReq({ MessageSid: "SM1", MessageStatus: "sent" }));
    expect(res.status).toBe(200);
    expect(updateMessageLogStatusByProviderMessageId).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/whatsapp-twilio-webhook-route.test.ts`
Expected: FAIL — rota inexistente.

- [ ] **Step 3: `app/api/webhooks/whatsapp/twilio/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getTwilioConfig } from "@/lib/whatsapp-settings";
import { twilioStatusCallbackUrl } from "@/lib/whatsapp/twilio-client";
import { updateMessageLogStatusByProviderMessageId } from "@/lib/message-logs";
import { updateCampaignRecipientStatusByProviderMessageId } from "@/lib/campaigns/delivery-status";

const STATUS_MAP: Record<string, "DELIVERED" | "READ" | "FAILED"> = {
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
  undelivered: "FAILED",
};

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  const { authToken } = await getTwilioConfig();
  const signature = req.headers.get("x-twilio-signature") ?? "";
  const url = twilioStatusCallbackUrl();
  if (!authToken || !url || !twilio.validateRequest(authToken, signature, url, params)) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 403 });
  }

  const sid = params.MessageSid;
  const mapped = STATUS_MAP[params.MessageStatus];
  if (sid && mapped) {
    const errorMessage = params.ErrorCode ? `Twilio ${params.ErrorCode}` : undefined;
    await updateMessageLogStatusByProviderMessageId(sid, mapped, errorMessage);
    await updateCampaignRecipientStatusByProviderMessageId(sid, mapped);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run tests/whatsapp-twilio-webhook-route.test.ts && npx tsc --noEmit`
Expected: PASS / limpo. Se `updateCampaignRecipientStatusByProviderMessageId` não aceitar `"FAILED"` (Task 5 Step 4), ajustar o mapeamento aqui pra só chamá-la em `DELIVERED`/`READ`.

- [ ] **Step 5: Commit**

```bash
git add app/api/webhooks/whatsapp/twilio/route.ts tests/whatsapp-twilio-webhook-route.test.ts
git commit -m "feat: webhook de status de entrega do Twilio (assinatura, idempotente)"
```

---

### Task 7: Mascarar secrets no audit log de `/api/admin/settings`

**Files:**
- Modify: `app/api/admin/settings/route.ts`
- Test: `tests/admin-settings-route.test.ts` (estender)

**Interfaces:**
- Consumes: nada novo.
- Produces: nada (comportamento interno).

- [ ] **Step 1: Write the failing test**

Estender `tests/admin-settings-route.test.ts`:

```ts
it("mascara o valor no audit log quando a key é secreta (twilio_auth_token)", async () => {
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  dbMock.platformSetting.findUnique.mockResolvedValueOnce({ value: "old-token" });
  dbMock.platformSetting.upsert.mockResolvedValueOnce({});
  dbMock.auditLog.create.mockResolvedValueOnce({});

  const res = await POST(makeReq({ key: "twilio_auth_token", value: "SUPERSECRET" }));
  expect(res.status).toBe(200);
  const meta = dbMock.auditLog.create.mock.calls.at(-1)[0].data.metadata;
  expect(meta.newValue).toBe("***");
  expect(meta.oldValue).toBe("***");
  expect(JSON.stringify(meta)).not.toContain("SUPERSECRET");
});

it("mantém o valor real no audit log para key não-secreta (whatsapp_provider)", async () => {
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  dbMock.platformSetting.findUnique.mockResolvedValueOnce(null);
  dbMock.platformSetting.upsert.mockResolvedValueOnce({});
  dbMock.auditLog.create.mockResolvedValueOnce({});

  await POST(makeReq({ key: "whatsapp_provider", value: "twilio" }));
  const meta = dbMock.auditLog.create.mock.calls.at(-1)[0].data.metadata;
  expect(meta.newValue).toBe("twilio");
});
```

(Ajustar `makeReq`/nomes ao que o arquivo já usa.)

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/admin-settings-route.test.ts`
Expected: FAIL — hoje o metadata leva o valor cru.

- [ ] **Step 3: Modificar `app/api/admin/settings/route.ts`**

Antes do `db.auditLog.create`:

```ts
function isSecretKey(key: string): boolean {
  return /(_token|_key|_secret|_password)$/.test(key);
}
const masked = isSecretKey(parsed.data.key);
```

No `metadata` do audit log:

```ts
metadata: {
  key: parsed.data.key,
  oldValue: masked ? (previous?.value ? "***" : null) : (previous?.value ?? null),
  newValue: masked ? "***" : parsed.data.value,
},
```

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run tests/admin-settings-route.test.ts && npx tsc --noEmit`
Expected: PASS / limpo.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/settings/route.ts tests/admin-settings-route.test.ts
git commit -m "fix: mascara secrets (*_token/_key/_secret/_password) no audit log de settings"
```

---

### Task 8: UI admin — seletor de provider + form do Twilio

**Files:**
- Create: `components/admin/WhatsAppProviderSelector.tsx`, `components/admin/TwilioCredentialsForm.tsx`
- Modify: `app/admin/whatsapp/page.tsx`
- Modify: `app/api/admin/whatsapp/{instance,status,disconnect,delete}/route.ts`
- Modify: `app/api/admin/whatsapp/test/route.ts`
- Modify: `components/admin/WhatsAppConnectionPanel.tsx` (só render condicional se necessário — ver Step)

**Interfaces:**
- Consumes: `getWhatsAppProvider`, `getTwilioConfig` (Task 1); `WhatsAppSendError`, `whatsAppErrorLabel` (Task 1).
- Produces: nada (UI). Sem teste automatizado de UI (convenção do projeto).

- [ ] **Step 1: `components/admin/WhatsAppProviderSelector.tsx`**

Client component: dois rádios (Evolution API / Twilio), salva `whatsapp_provider` via `POST /api/admin/settings`, faz `router.refresh()` no sucesso. Padrão visual dos outros forms admin (`btn-primary`, estado de saving/saved, erro inline).

- [ ] **Step 2: `components/admin/TwilioCredentialsForm.tsx`**

Segue `WhatsAppCredentialsForm.tsx`: campos Account SID, Auth Token (`type="password"`, placeholder "Deixe em branco para manter o atual", **nunca** pré-preenchido), From number, Content SID. Salva cada um via `POST /api/admin/settings` (`twilio_account_sid`, `twilio_auth_token`, `twilio_from_number`, `twilio_content_sid`). Auth Token só é enviado se não-vazio. Indicadores "Configurado / Não configurado" por campo (props booleanas do server component). Texto de ajuda: "O template do Twilio deve ter exatamente uma variável de corpo `{{1}}`, que recebe o texto completo da notificação."

- [ ] **Step 3: `app/admin/whatsapp/page.tsx`**

```tsx
const [provider, evoConfig, twilioConfig] = await Promise.all([
  getWhatsAppProvider(), getWhatsAppConfig(), getTwilioConfig(),
]);
```

- Título: "WhatsApp" (sem "(Evolution API)").
- `<WhatsAppProviderSelector current={provider} />` no topo.
- Card "Credenciais": `provider === "twilio" ? <TwilioCredentialsForm .../> : <WhatsAppCredentialsForm .../>`.
- Card "Conexão": `provider === "evolution" && <WhatsAppConnectionPanel .../>`. Um card "Teste de envio" (input de telefone + botão → `POST /api/admin/whatsapp/test`) aparece para os dois providers.

- [ ] **Step 4: Guards nas rotas Evolution-only**

Em cada uma de `app/api/admin/whatsapp/{instance,status,disconnect,delete}/route.ts`, logo após o check de admin:

```ts
import { getWhatsAppProvider } from "@/lib/whatsapp-settings";
// ...
if ((await getWhatsAppProvider()) === "twilio") {
  return NextResponse.json({ error: "Ação disponível apenas com o provedor Evolution API" }, { status: 400 });
}
```

- [ ] **Step 5: `app/api/admin/whatsapp/test/route.ts` — erro por kind**

```ts
} catch (err) {
  const msg = err instanceof WhatsAppSendError ? whatsAppErrorLabel(err.kind) : "Falha ao enviar WhatsApp de teste";
  return NextResponse.json({ error: msg }, { status: 502 });
}
```

- [ ] **Step 6: Verificação**

Run: `npx tsc --noEmit && npm run build`
Expected: limpo. Sem teste de UI (convenção). Verificação manual pós-deploy: alternar provider, salvar credenciais Twilio (campo mascarado), botão de teste.

- [ ] **Step 7: Commit**

```bash
git add components/admin/ app/admin/whatsapp/ app/api/admin/whatsapp/
git commit -m "feat: UI de seleção de provider de WhatsApp + form de credenciais Twilio"
```

---

### Task 9: Verificação final + PROGRESSO

**Files:**
- Modify: `PROGRESSO.md`
- Modify: `docs/superpowers/specs/2026-08-28-twilio-whatsapp-provider-design.md` (marcar critérios de aceite)

- [ ] **Step 1: Suíte completa**

Run: `npx vitest run`
Expected: tudo verde. Corrigir mocks de testes não tocados que assumiam `sendTextMessage` direto (adicionar `vi.mock("@/lib/whatsapp/sender")` ou mockar `getWhatsAppSender` onde o teste exercita envio de WhatsApp).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: limpo.

- [ ] **Step 3: Revisão adversarial (grep), registrar cada check no report**

- `grep -rn "provider === .twilio\|provider === \"twilio\"" lib/ app/ components/` — só em `lib/whatsapp/sender.ts` (e os guards das rotas Evolution-only da Task 8, que são explicitamente permitidos).
- `grep -rn "sendTextMessage\|sendMediaMessage" lib/ app/` — só em `lib/whatsapp/evolution-client.ts` e `lib/whatsapp/evolution-sender.ts` (não mais em `lib/whatsapp.ts`).
- Confirmar que `recordMessageLog` só é chamado em `lib/whatsapp.ts` (não nos senders).
- Confirmar que nenhum `WhatsAppSendError.message` nem `MessageLog.errorMessage` inclui `providerCode`, token, SID ou corpo cru — inspecionar `safeErrorMessage`, `classifyTwilioError`, `kindFromEvolutionStatus`.
- Confirmar que o webhook Twilio falha fechado (token vazio → 403) e nunca lança 5xx pro Twilio.
- `git diff` no webhook Evolution (`app/api/webhooks/whatsapp/route.ts`) — deve estar **vazio** (não tocado).
- Confirmar default: sem `whatsapp_provider` setado → `getWhatsAppProvider()` devolve `"evolution"`.

- [ ] **Step 4: PROGRESSO.md**

Nova entrada no topo: sub-projeto A (Twilio) concluído, arquivos principais, resultado de `vitest`/`tsc`/`build`. **PRÓXIMA TAREFA:** deploy (`git push` + `deploy.sh`, code-only, `npm ci` pega o `twilio`; sem `db push`), e depois setup operacional no Twilio/Meta (criar o template utilitário, pegar o Content SID, configurar as 4 settings) — aguardando o usuário. Depois: escolher sub-projeto B ou C.

- [ ] **Step 5: Commit**

```bash
git add PROGRESSO.md docs/superpowers/specs/2026-08-28-twilio-whatsapp-provider-design.md
git commit -m "docs: conclui sub-projeto A (Twilio WhatsApp) — verificação + PROGRESSO"
```

---

## Self-Review

**1. Spec coverage:**

| Spec (seção) | Task |
|---|---|
| §1.1 setting `whatsapp_provider` | Task 1 |
| §1.1 `getWhatsAppProvider`, `getTwilioConfig`, `isTwilioConfigured` | Task 1 |
| §1.2 `WhatsAppSender` + `getWhatsAppSender` | Tasks 2 (interface) + 3 (branch twilio) |
| §1.3 `EvolutionSender` + `sendMediaMessage` retorna `{providerMessageId:null}` | Task 2 |
| §1.4 `lib/whatsapp.ts` usa `getWhatsAppSender`, `safeErrorMessage`, MessageLog no domínio | Task 4 |
| §2.1 dep `twilio` | Task 3 |
| §2.2 `TwilioSender.sendText` (template utilitário, statusCallback) | Task 3 |
| §2.2 `sendMedia` fallback | Task 3 |
| §2.3 template utilitário documentado | Task 3 (Step 4 comentário) + Task 8 (texto de ajuda) |
| §3 `WhatsAppSendError` + `classifyTwilioError` + `classifyEvolutionError` | Tasks 1 + 2 (evolution) + 3 (twilio) |
| §3.3 consumidores (domain log, test route, fallback 2FA inalterado) | Tasks 4 + 8 (test route) |
| §4.1 webhook `/api/webhooks/whatsapp/twilio` | Task 6 |
| §4.2 `updateMessageLogStatusByProviderMessageId` + FAILED | Task 5 |
| §4.3 `statusCallback` por mensagem (sem config global) | Task 3 |
| §5 UI: seletor, `TwilioCredentialsForm`, painel QR só Evolution, guards | Task 8 |
| §5.4 mascaramento de secrets no audit log | Task 7 |
| §6 compatibilidade (sem schema, Evolution intacta, default evolution) | verificado Task 9 §3 |
| §7 testes | Tasks 1–7; suíte Task 9 |
| §9 critérios de aceite | Task 9 §3 |
| §10 pendências (mídia Twilio, templates por messageType, 2FA config) | documentado no spec; Task 9 Step 4 no PROGRESSO |

Sem lacunas.

**2. Placeholder scan:** Sem "TBD"/"TODO"/"handle errors". Os "verificar na implementação" (Task 2 Step 6 — testes do evolution-client que asseriam a string de erro; Task 5 Step 4 — assinatura de `updateCampaignRecipientStatusByProviderMessageId`; Task 7 Step 1 — nomes de helper do arquivo de teste) são checagens legítimas de momento-de-implementação, com o comportamento esperado explícito.

**3. Type consistency:**
- `WhatsAppSender` / `SendContext` / `getWhatsAppSender` — nomes idênticos Tasks 2, 3, 4.
- `WhatsAppSendError` / `WhatsAppErrorKind` / `whatsAppErrorLabel` — Tasks 1, 2, 3, 4, 8.
- `getWhatsAppProvider` / `getTwilioConfig` / `TwilioConfig` / `isTwilioConfigured` — Tasks 1, 3, 6, 8.
- `twilioStatusCallbackUrl` — definido Task 3, consumido Task 6.
- `updateMessageLogStatusByProviderMessageId(id, "DELIVERED"|"READ"|"FAILED", errorMessage?)` — Task 5, consumido Task 6.
- `classifyTwilioError` — Task 3; `classifyEvolutionError` mora inline como `kindFromEvolutionStatus` em `evolution-client.ts` (Task 2) — o spec §3.2 chama de `classifyEvolutionError`, mas a implementação como helper local do client é equivalente e menor; consistente entre as tasks.

Sem inconsistências.
