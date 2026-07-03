# Infraestrutura Evolution API / WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar o sistema a um servidor Evolution API já existente (URL + API key configuráveis pelo admin), com uma página dedicada `/admin/whatsapp` para gerar QR code, ver status de conexão, desconectar/excluir a instância e enviar uma mensagem de teste — e uma função genérica `sendWhatsAppMessage()` pronta para o próximo sub-projeto (catálogo de alertas) consumir.

**Architecture:** Segue o padrão já estabelecido para SMTP/gateway de pagamento: credenciais em `PlatformSetting` via `getSetting`/`upsertSetting`, um módulo de config dedicado (`lib/whatsapp-settings.ts`), um cliente HTTP puro para a Evolution API (`lib/whatsapp/evolution-client.ts`, mesmo estilo de `lib/payment/pagarme.ts`), uma função de envio genérica (`lib/whatsapp.ts`, espelhando `lib/email.ts`), 5 rotas admin finas que delegam para essas funções, e uma página dedicada com 2 componentes client.

**Tech Stack:** Next.js App Router, `fetch` nativo (sem SDK de terceiros), Vitest, TypeScript.

## Global Constraints

- Deploy do servidor Evolution API está fora de escopo — o sistema só se conecta via URL + API key já existentes.
- Uma única instância global para a plataforma toda (sem multi-instância).
- Sem webhooks de status em tempo real nesta versão — status é sempre consultado por polling manual (botão "Atualizar status" e ao carregar a página).
- Todas as rotas novas exigem `session.user.role === "ADMIN"` (403 caso contrário), mesmo padrão de todas as rotas `/api/admin/*` existentes.
- Nenhum componente React tem teste automatizado neste projeto (convenção já estabelecida) — só funções puras e rotas de API são testadas.
- O botão "Enviar WhatsApp de teste" só fica habilitado quando o estado de conexão é `"open"` (Conectado).

---

## Task 1: Configuração de credenciais (`lib/whatsapp-settings.ts`)

**Files:**
- Create: `lib/whatsapp-settings.ts`
- Test: `tests/whatsapp-settings.test.ts`

**Interfaces:**
- Produces: `WhatsAppConfig { apiUrl: string; apiKey: string; instanceName: string }`, `getWhatsAppConfig(): Promise<WhatsAppConfig>`, `isWhatsAppConfigured(config: WhatsAppConfig): boolean` — consumidos pelas Tasks 2, 3, 4, 5.

- [ ] **Step 1: Escrever o teste de `isWhatsAppConfigured` (falhando)**

Create `tests/whatsapp-settings.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isWhatsAppConfigured } from "@/lib/whatsapp-settings";

describe("isWhatsAppConfigured", () => {
  it("retorna true quando apiUrl, apiKey e instanceName estão todos preenchidos", () => {
    expect(
      isWhatsAppConfigured({ apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" }),
    ).toBe(true);
  });

  it("retorna false quando apiUrl está vazio", () => {
    expect(isWhatsAppConfigured({ apiUrl: "", apiKey: "key", instanceName: "corridas-app" })).toBe(false);
  });

  it("retorna false quando apiKey está vazio", () => {
    expect(isWhatsAppConfigured({ apiUrl: "https://evo.example.com", apiKey: "", instanceName: "corridas-app" })).toBe(
      false,
    );
  });

  it("retorna false quando instanceName está vazio", () => {
    expect(
      isWhatsAppConfigured({ apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "" }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/whatsapp-settings.test.ts`
Expected: FAIL — `Cannot find module '@/lib/whatsapp-settings'`.

- [ ] **Step 3: Implementar o módulo**

Create `lib/whatsapp-settings.ts`:
```ts
import { getSetting } from "./settings";

export interface WhatsAppConfig {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
}

export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  const [apiUrl, apiKey, instanceName] = await Promise.all([
    getSetting("whatsapp_api_url"),
    getSetting("whatsapp_api_key"),
    getSetting("whatsapp_instance_name"),
  ]);

  return {
    apiUrl: (apiUrl ?? process.env.WHATSAPP_API_URL ?? "").replace(/\/+$/, ""),
    apiKey: apiKey ?? process.env.WHATSAPP_API_KEY ?? "",
    instanceName: instanceName ?? process.env.WHATSAPP_INSTANCE_NAME ?? "",
  };
}

export function isWhatsAppConfigured(config: WhatsAppConfig): boolean {
  return Boolean(config.apiUrl && config.apiKey && config.instanceName);
}
```

Note: `apiUrl` tem a barra final removida (`replace(/\/+$/, "")`) para que o cliente da Task 2 possa concatenar caminhos (`${apiUrl}/instance/create`) sem gerar barra dupla.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/whatsapp-settings.test.ts`
Expected: PASS — 4/4 testes.

- [ ] **Step 5: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/whatsapp-settings.ts tests/whatsapp-settings.test.ts
git commit -m "feat: modulo de configuracao de credenciais do WhatsApp/Evolution API"
```

---

## Task 2: Cliente HTTP da Evolution API (`lib/whatsapp/evolution-client.ts`)

**Files:**
- Create: `lib/whatsapp/evolution-client.ts`
- Test: `tests/whatsapp-evolution-client.test.ts`

**Interfaces:**
- Consumes: `WhatsAppConfig` (Task 1).
- Produces: `ConnectionState = "open" | "connecting" | "close" | "not_found"`, `createInstance(config)`, `getQrCode(config)`, `getConnectionState(config)`, `logoutInstance(config)`, `deleteInstance(config)`, `sendTextMessage(config, phone, text)` — consumidos pelas Tasks 3 e 4.

Contrato REST da Evolution API v2 (confirmado via documentação oficial `doc.evolution-api.com/v2` e exemplos da comunidade): todos os endpoints ficam sob `{apiUrl}/instance/...` ou `{apiUrl}/message/...`, autenticados pelo header `apikey`. `POST /instance/create` recebe `{ instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true }`. `GET /instance/connect/{instance}` e a resposta de `create` podem trazer o QR code em formatos ligeiramente diferentes entre versões (`{ qrcode: "data:..." }` ou `{ qrcode: { base64: "data:..." } }` ou `{ base64: "data:..." }`) — o cliente extrai de forma tolerante a essas variações. `GET /instance/connectionState/{instance}` retorna `{ instance: { state: "open" | "close" | "connecting" } }` (404 se a instância não existe). `POST /instance/logout/{instance}` desconecta a sessão. `DELETE /instance/delete/{instance}` remove a instância. `POST /message/sendText/{instance}` recebe `{ number, text }`.

- [ ] **Step 1: Escrever os testes (falhando)**

Create `tests/whatsapp-evolution-client.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInstance,
  getQrCode,
  getConnectionState,
  logoutInstance,
  deleteInstance,
  sendTextMessage,
} from "@/lib/whatsapp/evolution-client";

const config = { apiUrl: "https://evo.example.com", apiKey: "test-key", instanceName: "corridas-app" };

describe("evolution-client", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  describe("createInstance", () => {
    it("faz POST em /instance/create com o nome da instância e retorna o QR code", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        status: 201,
        json: async () => ({
          instance: { instanceName: "corridas-app", status: "created" },
          qrcode: { base64: "data:image/png;base64,AAA" },
        }),
      });

      const result = await createInstance(config);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://evo.example.com/instance/create",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ apikey: "test-key", "Content-Type": "application/json" }),
          body: JSON.stringify({ instanceName: "corridas-app", integration: "WHATSAPP-BAILEYS", qrcode: true }),
        }),
      );
      expect(result).toEqual({ qrCodeBase64: "data:image/png;base64,AAA" });
    });

    it("lança erro quando a Evolution API retorna status de erro", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 500, json: async () => ({ error: "boom" }) });
      await expect(createInstance(config)).rejects.toThrow("Evolution API 500");
    });
  });

  describe("getQrCode", () => {
    it("busca o QR code em /instance/connect/{instance}, tratando o campo qrcode como string", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        status: 200,
        json: async () => ({ qrcode: "data:image/png;base64,BBB" }),
      });

      const result = await getQrCode(config);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://evo.example.com/instance/connect/corridas-app",
        expect.objectContaining({ method: "GET", headers: expect.objectContaining({ apikey: "test-key" }) }),
      );
      expect(result).toEqual({ qrCodeBase64: "data:image/png;base64,BBB" });
    });
  });

  describe("getConnectionState", () => {
    it("retorna 'open' quando instance.state é open", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 200, json: async () => ({ instance: { state: "open" } }) });
      expect(await getConnectionState(config)).toBe("open");
    });

    it("retorna 'not_found' em um 404", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 404, json: async () => ({}) });
      expect(await getConnectionState(config)).toBe("not_found");
    });

    it("lança erro em outros status de erro", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 500, json: async () => ({}) });
      await expect(getConnectionState(config)).rejects.toThrow("Evolution API 500");
    });
  });

  describe("logoutInstance", () => {
    it("faz POST em /instance/logout/{instance}", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 200, json: async () => ({}) });
      await logoutInstance(config);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://evo.example.com/instance/logout/corridas-app",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("não lança erro em um 404 (já desconectado)", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 404, json: async () => ({}) });
      await expect(logoutInstance(config)).resolves.toBeUndefined();
    });
  });

  describe("deleteInstance", () => {
    it("faz DELETE em /instance/delete/{instance}", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 200, json: async () => ({}) });
      await deleteInstance(config);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://evo.example.com/instance/delete/corridas-app",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("não lança erro em um 404 (instância já não existe)", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 404, json: async () => ({}) });
      await expect(deleteInstance(config)).resolves.toBeUndefined();
    });
  });

  describe("sendTextMessage", () => {
    it("envia o telefone e o texto para /message/sendText/{instance}", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 200, json: async () => ({ key: { id: "abc" } }) });
      await sendTextMessage(config, "5511999999999", "Olá!");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://evo.example.com/message/sendText/corridas-app",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ number: "5511999999999", text: "Olá!" }),
        }),
      );
    });

    it("lança erro quando o envio falha", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 400, json: async () => ({ error: "invalid number" }) });
      await expect(sendTextMessage(config, "invalid", "Olá!")).rejects.toThrow("Evolution API 400");
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/whatsapp-evolution-client.test.ts`
Expected: FAIL — `Cannot find module '@/lib/whatsapp/evolution-client'`.

- [ ] **Step 3: Implementar o cliente**

Create `lib/whatsapp/evolution-client.ts`:
```ts
import type { WhatsAppConfig } from "@/lib/whatsapp-settings";

export type ConnectionState = "open" | "connecting" | "close" | "not_found";

// Diferentes versões da Evolution API colocam o QR code em campos diferentes da resposta.
function extractQrCodeBase64(body: unknown): string | null {
  const b = body as Record<string, unknown> | null | undefined;
  if (!b) return null;
  const qrcode = b.qrcode;
  if (typeof qrcode === "string") return qrcode;
  if (qrcode && typeof qrcode === "object" && typeof (qrcode as Record<string, unknown>).base64 === "string") {
    return (qrcode as Record<string, unknown>).base64 as string;
  }
  if (typeof b.base64 === "string") return b.base64;
  return null;
}

async function evolutionFetch(
  config: WhatsAppConfig,
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: Record<string, unknown> },
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { apikey: config.apiKey };
  if (init.body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${config.apiUrl}${path}`, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function createInstance(config: WhatsAppConfig): Promise<{ qrCodeBase64: string | null }> {
  const { status, body } = await evolutionFetch(config, "/instance/create", {
    method: "POST",
    body: { instanceName: config.instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true },
  });

  if (status >= 400) {
    throw new Error(`Evolution API ${status} ao criar instância: ${JSON.stringify(body).slice(0, 300)}`);
  }

  return { qrCodeBase64: extractQrCodeBase64(body) };
}

export async function getQrCode(config: WhatsAppConfig): Promise<{ qrCodeBase64: string | null }> {
  const { status, body } = await evolutionFetch(config, `/instance/connect/${config.instanceName}`, {
    method: "GET",
  });

  if (status >= 400) {
    throw new Error(`Evolution API ${status} ao buscar QR code: ${JSON.stringify(body).slice(0, 300)}`);
  }

  return { qrCodeBase64: extractQrCodeBase64(body) };
}

export async function getConnectionState(config: WhatsAppConfig): Promise<ConnectionState> {
  const { status, body } = await evolutionFetch(config, `/instance/connectionState/${config.instanceName}`, {
    method: "GET",
  });

  if (status === 404) return "not_found";
  if (status >= 400) {
    throw new Error(`Evolution API ${status} ao consultar status: ${JSON.stringify(body).slice(0, 300)}`);
  }

  const state = (body as { instance?: { state?: string } } | null)?.instance?.state;
  if (state === "open" || state === "connecting" || state === "close") return state;
  return "close";
}

export async function logoutInstance(config: WhatsAppConfig): Promise<void> {
  const { status, body } = await evolutionFetch(config, `/instance/logout/${config.instanceName}`, {
    method: "POST",
  });

  if (status >= 400 && status !== 404) {
    throw new Error(`Evolution API ${status} ao desconectar: ${JSON.stringify(body).slice(0, 300)}`);
  }
}

export async function deleteInstance(config: WhatsAppConfig): Promise<void> {
  const { status, body } = await evolutionFetch(config, `/instance/delete/${config.instanceName}`, {
    method: "DELETE",
  });

  if (status >= 400 && status !== 404) {
    throw new Error(`Evolution API ${status} ao excluir instância: ${JSON.stringify(body).slice(0, 300)}`);
  }
}

export async function sendTextMessage(config: WhatsAppConfig, phone: string, text: string): Promise<void> {
  const { status, body } = await evolutionFetch(config, `/message/sendText/${config.instanceName}`, {
    method: "POST",
    body: { number: phone, text },
  });

  if (status >= 400) {
    throw new Error(`Evolution API ${status} ao enviar mensagem: ${JSON.stringify(body).slice(0, 300)}`);
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/whatsapp-evolution-client.test.ts`
Expected: PASS — 12/12 testes.

- [ ] **Step 5: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/whatsapp/evolution-client.ts tests/whatsapp-evolution-client.test.ts
git commit -m "feat: cliente HTTP da Evolution API"
```

---

## Task 3: Função genérica de envio (`lib/whatsapp.ts`)

**Files:**
- Create: `lib/whatsapp.ts`
- Test: `tests/whatsapp.test.ts`

**Interfaces:**
- Consumes: `getWhatsAppConfig`, `isWhatsAppConfigured` (Task 1); `sendTextMessage` (Task 2).
- Produces: `sendWhatsAppMessage(phone: string, text: string): Promise<void>` — consumida pela Task 4 (rota de teste) e pelo próximo sub-projeto (catálogo de alertas).

- [ ] **Step 1: Escrever os testes (falhando)**

Create `tests/whatsapp.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp-settings", () => ({
  getWhatsAppConfig: vi.fn(),
  isWhatsAppConfigured: vi.fn(),
}));
vi.mock("@/lib/whatsapp/evolution-client", () => ({
  sendTextMessage: vi.fn(),
}));

import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { sendTextMessage } from "@/lib/whatsapp/evolution-client";

describe("sendWhatsAppMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lança erro quando o WhatsApp não está configurado, sem chamar o cliente", async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue({ apiUrl: "", apiKey: "", instanceName: "" });
    vi.mocked(isWhatsAppConfigured).mockReturnValue(false);

    await expect(sendWhatsAppMessage("5511999999999", "Olá!")).rejects.toThrow("WhatsApp não configurado");
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("delega para sendTextMessage com a config resolvida quando configurado", async () => {
    const config = { apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" };
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);

    await sendWhatsAppMessage("5511999999999", "Olá!");

    expect(sendTextMessage).toHaveBeenCalledWith(config, "5511999999999", "Olá!");
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/whatsapp.test.ts`
Expected: FAIL — `Cannot find module '@/lib/whatsapp'`.

- [ ] **Step 3: Implementar a função**

Create `lib/whatsapp.ts`:
```ts
import { getWhatsAppConfig, isWhatsAppConfigured } from "./whatsapp-settings";
import { sendTextMessage } from "./whatsapp/evolution-client";

/** Envia uma mensagem de WhatsApp usando a configuração salva (Evolution API). */
export async function sendWhatsAppMessage(phone: string, text: string): Promise<void> {
  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) {
    throw new Error("WhatsApp não configurado. Configure em Admin → WhatsApp.");
  }
  await sendTextMessage(config, phone, text);
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/whatsapp.test.ts`
Expected: PASS — 2/2 testes.

- [ ] **Step 5: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/whatsapp.ts tests/whatsapp.test.ts
git commit -m "feat: funcao generica de envio de WhatsApp"
```

---

## Task 4: Rotas de API + rótulos de auditoria

**Files:**
- Create: `app/api/admin/whatsapp/instance/route.ts`
- Create: `app/api/admin/whatsapp/status/route.ts`
- Create: `app/api/admin/whatsapp/disconnect/route.ts`
- Create: `app/api/admin/whatsapp/delete/route.ts`
- Create: `app/api/admin/whatsapp/test/route.ts`
- Modify: `lib/admin/labels.ts`
- Test: `tests/admin-whatsapp-routes.test.ts`

**Interfaces:**
- Consumes: `getWhatsAppConfig`, `isWhatsAppConfigured` (Task 1); `createInstance`, `getQrCode`, `getConnectionState`, `logoutInstance`, `deleteInstance` (Task 2); `sendWhatsAppMessage` (Task 3).
- Produces: `POST /api/admin/whatsapp/instance` → `{ qrCodeBase64: string | null }`; `GET /api/admin/whatsapp/status` → `{ state: string }`; `POST /api/admin/whatsapp/disconnect` → `{ ok: true }`; `POST /api/admin/whatsapp/delete` → `{ ok: true }`; `POST /api/admin/whatsapp/test` com corpo `{ phone: string }` → `{ ok: true, to: string }`. Todas consumidas pela Task 5 (UI).

- [ ] **Step 1: Adicionar os rótulos de auditoria**

Find (em `lib/admin/labels.ts`):
```ts
  PAYMENT_REFUNDED: "Pagamento estornado",
};
```

Replace it with:
```ts
  PAYMENT_REFUNDED: "Pagamento estornado",
  WHATSAPP_INSTANCE_CREATED: "Instância do WhatsApp criada",
  WHATSAPP_INSTANCE_DELETED: "Instância do WhatsApp excluída",
};
```

- [ ] **Step 2: Escrever os testes de rota (falhando)**

Create `tests/admin-whatsapp-routes.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/whatsapp-settings", () => ({
  getWhatsAppConfig: vi.fn(),
  isWhatsAppConfigured: vi.fn(),
}));

vi.mock("@/lib/whatsapp/evolution-client", () => ({
  createInstance: vi.fn(),
  getQrCode: vi.fn(),
  getConnectionState: vi.fn(),
  logoutInstance: vi.fn(),
  deleteInstance: vi.fn(),
}));

vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));

import { POST as instancePost } from "@/app/api/admin/whatsapp/instance/route";
import { GET as statusGet } from "@/app/api/admin/whatsapp/status/route";
import { POST as disconnectPost } from "@/app/api/admin/whatsapp/disconnect/route";
import { POST as deletePost } from "@/app/api/admin/whatsapp/delete/route";
import { POST as testPost } from "@/app/api/admin/whatsapp/test/route";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import {
  createInstance,
  getQrCode,
  getConnectionState,
  logoutInstance,
  deleteInstance,
} from "@/lib/whatsapp/evolution-client";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const configMock = { apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" };

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/admin/whatsapp/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as any;
}

describe("admin whatsapp routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(configMock);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
  });

  describe("POST /api/admin/whatsapp/instance", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await instancePost();
      expect(res.status).toBe(403);
    });

    it("retorna 400 quando não está configurado", async () => {
      vi.mocked(isWhatsAppConfigured).mockReturnValue(false);
      const res = await instancePost();
      expect(res.status).toBe(400);
      expect(getConnectionState).not.toHaveBeenCalled();
    });

    it("cria a instância e grava auditoria quando ela ainda não existe", async () => {
      vi.mocked(getConnectionState).mockResolvedValueOnce("not_found");
      vi.mocked(createInstance).mockResolvedValueOnce({ qrCodeBase64: "data:image/png;base64,AAA" });

      const res = await instancePost();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.qrCodeBase64).toBe("data:image/png;base64,AAA");
      expect(createInstance).toHaveBeenCalledWith(configMock);
      expect(getQrCode).not.toHaveBeenCalled();
      expect(dbMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "WHATSAPP_INSTANCE_CREATED" }) }),
      );
    });

    it("atualiza o QR code sem criar uma nova instância quando ela já existe", async () => {
      vi.mocked(getConnectionState).mockResolvedValueOnce("close");
      vi.mocked(getQrCode).mockResolvedValueOnce({ qrCodeBase64: "data:image/png;base64,BBB" });

      const res = await instancePost();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.qrCodeBase64).toBe("data:image/png;base64,BBB");
      expect(createInstance).not.toHaveBeenCalled();
      expect(dbMock.auditLog.create).not.toHaveBeenCalled();
    });

    it("retorna 502 quando a chamada à Evolution API falha", async () => {
      vi.mocked(getConnectionState).mockRejectedValueOnce(new Error("Evolution API 500: boom"));
      const res = await instancePost();
      expect(res.status).toBe(502);
    });
  });

  describe("GET /api/admin/whatsapp/status", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await statusGet();
      expect(res.status).toBe(403);
    });

    it("retorna not_configured sem chamar o cliente quando faltam credenciais", async () => {
      vi.mocked(isWhatsAppConfigured).mockReturnValue(false);
      const res = await statusGet();
      const body = await res.json();
      expect(body.state).toBe("not_configured");
      expect(getConnectionState).not.toHaveBeenCalled();
    });

    it("retorna o estado de conexão quando configurado", async () => {
      vi.mocked(getConnectionState).mockResolvedValueOnce("open");
      const res = await statusGet();
      const body = await res.json();
      expect(body.state).toBe("open");
    });
  });

  describe("POST /api/admin/whatsapp/disconnect", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await disconnectPost();
      expect(res.status).toBe(403);
    });

    it("chama logoutInstance e retorna ok", async () => {
      const res = await disconnectPost();
      expect(res.status).toBe(200);
      expect(logoutInstance).toHaveBeenCalledWith(configMock);
    });
  });

  describe("POST /api/admin/whatsapp/delete", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await deletePost();
      expect(res.status).toBe(403);
    });

    it("chama deleteInstance e grava auditoria", async () => {
      const res = await deletePost();
      expect(res.status).toBe(200);
      expect(deleteInstance).toHaveBeenCalledWith(configMock);
      expect(dbMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "WHATSAPP_INSTANCE_DELETED" }) }),
      );
    });
  });

  describe("POST /api/admin/whatsapp/test", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await testPost(makeRequest({ phone: "5511999999999" }));
      expect(res.status).toBe(403);
    });

    it("retorna 400 para um telefone inválido", async () => {
      const res = await testPost(makeRequest({ phone: "123" }));
      expect(res.status).toBe(400);
      expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it("envia a mensagem de teste e retorna ok", async () => {
      const res = await testPost(makeRequest({ phone: "5511999999999" }));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.to).toBe("5511999999999");
      expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999999999", expect.any(String));
    });

    it("retorna 502 quando o envio falha", async () => {
      vi.mocked(sendWhatsAppMessage).mockRejectedValueOnce(new Error("WhatsApp não configurado"));
      const res = await testPost(makeRequest({ phone: "5511999999999" }));
      expect(res.status).toBe(502);
    });
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-whatsapp-routes.test.ts`
Expected: FAIL — os 5 módulos de rota ainda não existem.

- [ ] **Step 4: Implementar a rota de instância/QR code**

Create `app/api/admin/whatsapp/instance/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { createInstance, getConnectionState, getQrCode } from "@/lib/whatsapp/evolution-client";

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) {
    return NextResponse.json(
      { error: "Configure a URL, a API key e o nome da instância antes de gerar o QR code" },
      { status: 400 },
    );
  }

  try {
    const state = await getConnectionState(config);
    const { qrCodeBase64 } = state === "not_found" ? await createInstance(config) : await getQrCode(config);

    if (state === "not_found") {
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          action: "WHATSAPP_INSTANCE_CREATED",
          entityType: "PlatformSetting",
          entityId: config.instanceName,
        },
      });
    }

    return NextResponse.json({ qrCodeBase64 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao gerar QR code";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
```

- [ ] **Step 5: Implementar a rota de status**

Create `app/api/admin/whatsapp/status/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { getConnectionState } from "@/lib/whatsapp/evolution-client";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) {
    return NextResponse.json({ state: "not_configured" });
  }

  try {
    const state = await getConnectionState(config);
    return NextResponse.json({ state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao consultar status";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
```

- [ ] **Step 6: Implementar a rota de desconexão**

Create `app/api/admin/whatsapp/disconnect/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { logoutInstance } from "@/lib/whatsapp/evolution-client";

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) {
    return NextResponse.json({ error: "WhatsApp não configurado" }, { status: 400 });
  }

  try {
    await logoutInstance(config);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao desconectar";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
```

- [ ] **Step 7: Implementar a rota de exclusão**

Create `app/api/admin/whatsapp/delete/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { deleteInstance } from "@/lib/whatsapp/evolution-client";

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) {
    return NextResponse.json({ error: "WhatsApp não configurado" }, { status: 400 });
  }

  try {
    await deleteInstance(config);
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "WHATSAPP_INSTANCE_DELETED",
        entityType: "PlatformSetting",
        entityId: config.instanceName,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao excluir instância";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
```

- [ ] **Step 8: Implementar a rota de teste de envio**

Create `app/api/admin/whatsapp/test/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

const schema = z.object({
  phone: z.string().min(8, "Informe um telefone válido com DDI e DDD"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe um telefone válido" }, { status: 400 });
  }

  try {
    await sendWhatsAppMessage(
      parsed.data.phone,
      "Mensagem de teste do painel administrativo. Se você recebeu isso, o WhatsApp está configurado corretamente. ✅",
    );
    return NextResponse.json({ ok: true, to: parsed.data.phone });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao enviar WhatsApp de teste";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
```

- [ ] **Step 9: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-whatsapp-routes.test.ts`
Expected: PASS — 16/16 testes.

- [ ] **Step 10: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros novos.

- [ ] **Step 11: Commit**

```bash
git add app/api/admin/whatsapp lib/admin/labels.ts tests/admin-whatsapp-routes.test.ts
git commit -m "feat: rotas admin de conexao e teste do WhatsApp"
```

---

## Task 5: Página `/admin/whatsapp` (UI)

**Files:**
- Create: `components/admin/WhatsAppCredentialsForm.tsx`
- Create: `components/admin/WhatsAppConnectionPanel.tsx`
- Create: `app/admin/whatsapp/page.tsx`
- Modify: `components/admin/AdminNav.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/settings` (existente, para salvar credenciais); `POST /api/admin/whatsapp/instance`, `GET /api/admin/whatsapp/status`, `POST /api/admin/whatsapp/disconnect`, `POST /api/admin/whatsapp/delete`, `POST /api/admin/whatsapp/test` (Task 4); `getWhatsAppConfig`, `isWhatsAppConfigured` (Task 1).

Nota de arquitetura: o painel de conexão e o formulário de teste de envio compartilham o mesmo estado de conexão ao vivo (`state`) — por isso ficam em um único componente `WhatsAppConnectionPanel.tsx` (duas seções visuais dentro do mesmo componente) em vez de dois componentes separados, evitando duplicar a lógica de polling do status.

Sem testes automatizados de UI (convenção já estabelecida no projeto — nenhum componente React tem teste hoje); a verificação é manual na Task 6.

- [ ] **Step 1: Criar o formulário de credenciais**

Create `components/admin/WhatsAppCredentialsForm.tsx`:
```tsx
"use client";

import { useState } from "react";

interface WhatsAppCredentialsFormProps {
  urlConfigured: boolean;
  keyConfigured: boolean;
  currentUrl: string;
  currentInstanceName: string;
}

export default function WhatsAppCredentialsForm({
  urlConfigured,
  keyConfigured,
  currentUrl,
  currentInstanceName,
}: WhatsAppCredentialsFormProps) {
  const [apiUrl, setApiUrl] = useState(currentUrl);
  const [apiKey, setApiKey] = useState("");
  const [instanceName, setInstanceName] = useState(currentInstanceName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveSetting(key: string, value: string) {
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveSetting("whatsapp_api_url", apiUrl.trim());
      if (apiKey.trim()) await saveSetting("whatsapp_api_key", apiKey.trim());
      await saveSetting("whatsapp_instance_name", instanceName.trim());
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {saved && (
        <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded px-3 py-2">
          Credenciais do WhatsApp atualizadas!
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 text-sm">
        <div className="p-3 rounded-lg border dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">URL do servidor</p>
          <p className={urlConfigured ? "text-green-600 font-medium" : "text-gray-400"}>
            {urlConfigured ? "Configurado" : "Não configurado"}
          </p>
        </div>
        <div className="p-3 rounded-lg border dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">API key</p>
          <p className={keyConfigured ? "text-green-600 font-medium" : "text-gray-400"}>
            {keyConfigured ? "Configurado" : "Não configurado"}
          </p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          URL do servidor Evolution API
        </label>
        <input
          type="text"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          className="input-field w-full"
          placeholder="https://evolution.seudominio.com.br"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API key (global)</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="input-field w-full"
            placeholder="Deixe em branco para manter a atual"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome da instância</label>
          <input
            type="text"
            value={instanceName}
            onChange={(e) => setInstanceName(e.target.value)}
            className="input-field w-full"
            placeholder="corridas-app"
          />
        </div>
      </div>

      <button type="submit" disabled={saving} className="btn-primary px-6">
        {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar credenciais"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Criar o painel de conexão + teste de envio**

Create `components/admin/WhatsAppConnectionPanel.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";

type ConnectionState = "open" | "connecting" | "close" | "not_found" | "not_configured" | "unknown";

const STATE_LABEL: Record<ConnectionState, string> = {
  open: "Conectado",
  connecting: "Conectando",
  close: "Desconectado",
  not_found: "Instância não criada",
  not_configured: "Configure as credenciais primeiro",
  unknown: "Verificando...",
};

const STATE_COLOR: Record<ConnectionState, string> = {
  open: "text-green-600",
  connecting: "text-yellow-600",
  close: "text-gray-500",
  not_found: "text-gray-500",
  not_configured: "text-gray-400",
  unknown: "text-gray-400",
};

export default function WhatsAppConnectionPanel({ configured }: { configured: boolean }) {
  const [state, setState] = useState<ConnectionState>("unknown");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);

  async function refreshStatus() {
    setError(null);
    const res = await fetch("/api/admin/whatsapp/status");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Falha ao consultar status");
      return;
    }
    setState(data.state ?? "unknown");
  }

  useEffect(() => {
    if (configured) {
      refreshStatus();
    } else {
      setState("not_configured");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  async function handleGenerateQrCode() {
    setLoading("qrcode");
    setError(null);
    try {
      const res = await fetch("/api/admin/whatsapp/instance", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao gerar QR code");
      setQrCode(data.qrCodeBase64 ?? null);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar QR code");
    } finally {
      setLoading(null);
    }
  }

  async function handleDisconnect() {
    setLoading("disconnect");
    setError(null);
    try {
      const res = await fetch("/api/admin/whatsapp/disconnect", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao desconectar");
      setQrCode(null);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao desconectar");
    } finally {
      setLoading(null);
    }
  }

  async function handleDelete() {
    setLoading("delete");
    setError(null);
    try {
      const res = await fetch("/api/admin/whatsapp/delete", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao excluir instância");
      setQrCode(null);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir instância");
    } finally {
      setLoading(null);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestMsg(null);
    setTestOk(false);
    try {
      const res = await fetch("/api/admin/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      setTestOk(true);
      setTestMsg(`WhatsApp de teste enviado para ${data.to}.`);
    } catch (err) {
      setTestOk(false);
      setTestMsg(err instanceof Error ? err.message : "Falha ao enviar WhatsApp de teste");
    } finally {
      setTesting(false);
    }
  }

  const isConnected = state === "open";

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Status:</span>
          <span className={`font-medium ${STATE_COLOR[state]}`}>{STATE_LABEL[state]}</span>
        </div>

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
            {error}
          </div>
        )}

        {qrCode && (
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrCode} alt="QR code do WhatsApp" className="w-56 h-56 border rounded-lg" />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleGenerateQrCode}
            disabled={!configured || loading !== null}
            className="btn-primary px-4 text-sm disabled:opacity-50"
          >
            {loading === "qrcode" ? "Gerando..." : "Gerar QR Code"}
          </button>
          <button
            type="button"
            onClick={refreshStatus}
            disabled={!configured || loading !== null}
            className="btn-secondary px-4 text-sm disabled:opacity-50"
          >
            Atualizar status
          </button>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={!configured || loading !== null}
            className="btn-secondary px-4 text-sm disabled:opacity-50"
          >
            {loading === "disconnect" ? "Desconectando..." : "Desconectar"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!configured || loading !== null}
            className="text-sm text-red-600 hover:underline disabled:opacity-50 px-2"
          >
            {loading === "delete" ? "Excluindo..." : "Excluir instância"}
          </button>
        </div>

        {!configured && (
          <p className="text-xs text-gray-500 dark:text-gray-400">Configure e salve as credenciais primeiro.</p>
        )}
      </div>

      <div className="border-t dark:border-gray-700 pt-4 space-y-3">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Enviar WhatsApp de teste</p>
        {testMsg && (
          <div
            className={`text-sm rounded px-3 py-2 border ${
              testOk
                ? "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
                : "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
            }`}
          >
            {testMsg}
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="input-field flex-1"
            placeholder="5511999999999 (DDI + DDD + número)"
          />
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !isConnected || !phone.trim()}
            className="btn-secondary whitespace-nowrap disabled:opacity-50"
          >
            {testing ? "Enviando..." : "Enviar WhatsApp de teste"}
          </button>
        </div>
        {!isConnected && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Conecte o WhatsApp primeiro (gere e escaneie o QR code acima).
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Criar a página**

Create `app/admin/whatsapp/page.tsx`:
```tsx
import { requireAdmin } from "@/lib/auth/rbac";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import WhatsAppCredentialsForm from "@/components/admin/WhatsAppCredentialsForm";
import WhatsAppConnectionPanel from "@/components/admin/WhatsAppConnectionPanel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "WhatsApp — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminWhatsAppPage() {
  await requireAdmin();

  const config = await getWhatsAppConfig();
  const configured = isWhatsAppConfigured(config);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-bold">WhatsApp (Evolution API)</h1>
        <p className="text-sm text-gray-500 mt-1">
          Conecte um número de WhatsApp para enviar alertas da plataforma. O servidor Evolution API precisa já
          estar rodando — esta página só se conecta a ele.
        </p>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold">Credenciais</h2>
        <WhatsAppCredentialsForm
          urlConfigured={Boolean(config.apiUrl)}
          keyConfigured={Boolean(config.apiKey)}
          currentUrl={config.apiUrl}
          currentInstanceName={config.instanceName}
        />
      </div>

      <div className="card">
        <h2 className="font-semibold mb-4">Conexão</h2>
        <WhatsAppConnectionPanel configured={configured} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Adicionar o link no menu admin**

Find (em `components/admin/AdminNav.tsx`):
```tsx
          <Link href="/admin/backup" className="hover:text-gray-300">Backup</Link>
```

Replace it with:
```tsx
          <Link href="/admin/backup" className="hover:text-gray-300">Backup</Link>
          <Link href="/admin/whatsapp" className="hover:text-gray-300">WhatsApp</Link>
```

- [ ] **Step 5: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add components/admin/WhatsAppCredentialsForm.tsx components/admin/WhatsAppConnectionPanel.tsx app/admin/whatsapp/page.tsx components/admin/AdminNav.tsx
git commit -m "feat: pagina admin/whatsapp para conectar e testar a Evolution API"
```

---

## Task 6: Verificação manual

**Files:** nenhum (só verificação).

- [ ] **Step 1: Preparar o ambiente**

Mesmo padrão de VPS descartável usado nos sub-projetos anteriores (clone + `npx prisma db push` + `npx prisma generate` + reiniciar o servidor — **neste sub-projeto não há mudança de schema**, então o `db push`/`generate` só é necessário se o banco de teste ainda não tiver os campos dos sub-projetos anteriores). Se não houver um servidor Evolution API real disponível para o teste, documentar isso e focar a verificação no tratamento de erro (URL inválida/inacessível) — que já é parte do fluxo obrigatório de qualquer forma.

- [ ] **Step 2: Fluxo sem credenciais**

Acessar `/admin/whatsapp` sem nada configurado: confirmar que os badges mostram "Não configurado", o status mostra "Configure as credenciais primeiro", e os botões de ação (Gerar QR Code, Atualizar, Desconectar, Excluir) estão desabilitados.

- [ ] **Step 3: Salvar credenciais inválidas e confirmar tratamento de erro**

Salvar uma URL que não responde (ex.: `https://localhost:1`) com uma API key qualquer. Clicar "Gerar QR Code" e confirmar que aparece uma mensagem de erro amigável (não uma página quebrada ou erro não tratado no console).

- [ ] **Step 4 (se houver um servidor Evolution API real disponível): fluxo completo**

Salvar credenciais reais. Clicar "Gerar QR Code", confirmar que a imagem do QR aparece. Escanear com um WhatsApp de teste. Clicar "Atualizar status" e confirmar que muda para "Conectado". Preencher um telefone e clicar "Enviar WhatsApp de teste", confirmar que chega a mensagem. Clicar "Desconectar" e confirmar que o status volta para "Desconectado". Clicar "Excluir instância" e confirmar que o status volta para "Instância não criada" (e que gerar QR code de novo recria a instância do zero).

- [ ] **Step 5: Relatar ao usuário**

Resumir o que foi verificado (incluindo se um servidor Evolution API real estava disponível ou não) e aguardar autorização explícita antes de qualquer push/deploy em produção.
