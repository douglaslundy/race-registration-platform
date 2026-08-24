# Campanhas de WhatsApp — Fase F: Pausar/retomar manual + concorrência real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a guarda de concorrência global do worker de campanhas por uma reivindicação
atômica por destinatário (com varredura de recuperação automática) e dar ao operador um jeito de
pausar/retomar uma campanha em andamento, inclusive quando a pausa veio do circuit breaker.

**Architecture:** 4 tasks pequenas e independentes: (1) função de reset do circuit breaker, (2)
reescrita do worker de cron pra reivindicação atômica + varredura + reescrita completa da suíte de
testes do worker (a mudança de concorrência muda o número de chamadas mockadas em praticamente todo
teste existente), (3) rotas novas de pausar/retomar (par evento+admin, mesmo padrão de
`cancel`/`schedule`), (4) botões novos na UI.

**Tech Stack:** Next.js App Router + TypeScript + Prisma/Postgres + Vitest (mesmo stack do resto do
projeto).

**Spec:** `docs/superpowers/specs/2026-08-24-campanhas-whatsapp-fase-f-design.md`

## Global Constraints

- Nenhuma mudança de schema — `updatedAt` já existe em `CampaignRecipient` (`@updatedAt`), `PAUSED`
  já existe no enum `CampaignStatus`.
- Nunca usar `alert()`/`confirm()`/`prompt()` — sempre `ConfirmModal`/`ErrorModal`
  (`components/ui/ConfirmModal.tsx` / `components/ui/ErrorModal.tsx`).
- Rotas novas de pausar/retomar usam a MESMA permissão já usada pra agendar: `campaigns.edit` (via
  `checkApiPermission`/`checkAdminOnlyApiPermission` de `@/lib/auth/rbac`) — nenhuma chave de
  permissão nova.
- Reaproveitar `resolveCampaignDetailContext` (`@/lib/campaigns/service`) do mesmo jeito que
  `cancel`/`schedule` já fazem — não reimplementar a resolução de contexto.

---

### Task 1: Reset do circuit breaker (`lib/campaigns/circuit-breaker.ts`)

**Files:**
- Modify: `lib/campaigns/circuit-breaker.ts`
- Test: `tests/lib-campaigns-circuit-breaker.test.ts` (crie este arquivo se ele não existir ainda —
  confira primeiro se já existe um teste pra este módulo antes de criar um novo)

**Interfaces:**
- Consumes: nada de outra task.
- Produces: `resetCircuitBreakerIfTripped(): Promise<boolean>` — usado pela Task 3 (rota de
  retomar). Retorna `true` se o contador estava disparado (≥ 5) e foi zerado; `false` se não
  estava disparado (não mexe em nada).

O arquivo atual (`lib/campaigns/circuit-breaker.ts`) é:

```ts
import { db } from "@/lib/db";

const SETTING_KEY = "campaign_consecutive_failures";
const TRIP_THRESHOLD = 5;

async function readCount(): Promise<number> {
  const row = await db.platformSetting.findUnique({ where: { key: SETTING_KEY } });
  return row ? parseInt(row.value, 10) || 0 : 0;
}

async function writeCount(count: number): Promise<void> {
  await db.platformSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: String(count) },
    update: { value: String(count) },
  });
}

/** Contador global (não por campanha) — todas as campanhas competem pelo mesmo número/instância de
 * WhatsApp, então uma falha sistêmica (instância caída, etc.) afeta todas igualmente. */
export async function recordCampaignSendFailure(): Promise<{ tripped: boolean; count: number }> {
  const count = (await readCount()) + 1;
  await writeCount(count);
  return { tripped: count >= TRIP_THRESHOLD, count };
}

export async function recordCampaignSendSuccess(): Promise<void> {
  await writeCount(0);
}

export async function isCircuitBreakerTripped(): Promise<boolean> {
  return (await readCount()) >= TRIP_THRESHOLD;
}
```

- [ ] **Step 1: Checar se já existe teste pra este módulo**

Rode: `git ls-files tests/ | grep -i circuit-breaker` (ou equivalente no seu shell). Se já existir
um arquivo (ex: `tests/lib-campaigns-circuit-breaker.test.ts` ou nome parecido), use ESSE arquivo
no Step 2 em vez de criar um novo — leia o arquivo primeiro pra seguir o padrão de mock já usado
nele (provavelmente mocka `db.platformSetting.findUnique`/`.upsert`).

- [ ] **Step 2: Escrever o teste falhando pra `resetCircuitBreakerIfTripped`**

Adicione (ou crie o arquivo com) estes casos, usando o mesmo padrão de mock de
`db.platformSetting.findUnique`/`db.platformSetting.upsert` que os testes existentes de
`recordCampaignSendFailure`/`isCircuitBreakerTripped` já usam neste módulo:

```ts
describe("resetCircuitBreakerIfTripped", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reseta o contador e retorna true quando está disparado (>= 5)", async () => {
    dbMock.platformSetting.findUnique.mockResolvedValueOnce({ key: "campaign_consecutive_failures", value: "7" });

    const result = await resetCircuitBreakerIfTripped();

    expect(result).toBe(true);
    expect(dbMock.platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "campaign_consecutive_failures" },
        update: { value: "0" },
      }),
    );
  });

  it("não mexe em nada e retorna false quando não está disparado (< 5)", async () => {
    dbMock.platformSetting.findUnique.mockResolvedValueOnce({ key: "campaign_consecutive_failures", value: "3" });

    const result = await resetCircuitBreakerIfTripped();

    expect(result).toBe(false);
    expect(dbMock.platformSetting.upsert).not.toHaveBeenCalled();
  });

  it("não mexe em nada e retorna false quando o contador nunca foi criado (nenhuma linha)", async () => {
    dbMock.platformSetting.findUnique.mockResolvedValueOnce(null);

    const result = await resetCircuitBreakerIfTripped();

    expect(result).toBe(false);
    expect(dbMock.platformSetting.upsert).not.toHaveBeenCalled();
  });
});
```

Ajuste os imports do topo do arquivo pra incluir `resetCircuitBreakerIfTripped` junto das outras 3
funções já importadas de `@/lib/campaigns/circuit-breaker`.

- [ ] **Step 2b: Rodar o teste e confirmar que falha**

Rode: `npx vitest run tests/lib-campaigns-circuit-breaker.test.ts` (ou o caminho real do arquivo).
Esperado: falha porque `resetCircuitBreakerIfTripped` ainda não existe.

- [ ] **Step 3: Implementar `resetCircuitBreakerIfTripped`**

Adicione ao final de `lib/campaigns/circuit-breaker.ts`:

```ts

/** Chamado só pela rota de retomar campanha. Só reseta o contador se ele estiver REALMENTE
 * disparado (>= 5) — nunca zera uma contagem parcial de falhas (ex: 3 seguidas, ainda não
 * disparado) só porque uma campanha não relacionada foi retomada manualmente. */
export async function resetCircuitBreakerIfTripped(): Promise<boolean> {
  const tripped = await isCircuitBreakerTripped();
  if (tripped) await writeCount(0);
  return tripped;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Rode: `npx vitest run tests/lib-campaigns-circuit-breaker.test.ts` (ou o caminho real). Esperado:
todos os testes passam, incluindo os 3 novos.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/circuit-breaker.ts tests/lib-campaigns-circuit-breaker.test.ts
git commit -m "feat: adiciona resetCircuitBreakerIfTripped pra retomar campanha pausada"
```

(ajuste o caminho do teste no `git add` se o arquivo já existia com outro nome)

---

### Task 2: Reivindicação atômica + varredura de recuperação no worker

**Files:**
- Modify: `tests/setup.ts` (adicionar `updateMany: vi.fn()` ao mock de `campaignRecipient`)
- Modify: `app/api/cron/send-campaign-messages/route.ts`
- Modify: `tests/cron-send-campaign-messages-route.test.ts` (reescrita quase completa — a mudança
  de concorrência muda o número de chamadas mockadas em praticamente todo teste existente)

**Interfaces:**
- Consumes: `isCircuitBreakerTripped`/`recordCampaignSendFailure`/`recordCampaignSendSuccess` de
  `@/lib/campaigns/circuit-breaker` (sem mudança de assinatura — Task 1 só ADICIONA uma função
  nova, não muda as existentes).
- Produces: nenhuma interface nova pra outra task consumir — esta task só muda o comportamento
  interno do worker.

**Passo prévio — confirme que o mock de `campaignRecipient` em `tests/setup.ts` já tem
`updateMany`.** Hoje ele é (procure a linha que começa com `campaignRecipient:`):

```ts
    campaignRecipient: { findMany: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn(), groupBy: vi.fn(), update: vi.fn(), count: vi.fn() },
```

Ele **não tem** `updateMany` ainda — sem isso, `dbMock.campaignRecipient.updateMany.mockResolvedValue(...)`
quebraria com "Cannot read properties of undefined" em QUALQUER teste deste arquivo.

- [ ] **Step 1: Adicionar `updateMany` ao mock de `campaignRecipient` em `tests/setup.ts`**

Troque a linha acima por:

```ts
    campaignRecipient: { findMany: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn(), groupBy: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
```

- [ ] **Step 2: Substituir o arquivo de teste do worker inteiro**

O arquivo atual (`tests/cron-send-campaign-messages-route.test.ts`) tem 285 linhas testando o
comportamento ANTIGO (guarda global de `PROCESSING`, `campaignRecipient.update` simples pra
reivindicar). A mudança de concorrência troca a forma como CADA teste precisa mockar
`campaignRecipient.findFirst`/`updateMany` — em vez de reescrever teste por teste, substitua o
arquivo inteiro por este conteúdo (mantém o mesmo comportamento coberto, ajustado pro novo fluxo,
mais 2 casos novos — varredura de recuperação e corrida perdida):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/whatsapp", async () => {
  const actual = await vi.importActual<typeof import("@/lib/whatsapp")>("@/lib/whatsapp");
  return {
    ...actual,
    sendWhatsAppMessage: vi.fn(),
    buildPreferencesFooterText: () => "\n\nRODAPE",
  };
});
vi.mock("@/lib/campaigns/resolve-recipient-variables", () => ({
  resolveCampaignRecipientVariables: vi.fn().mockResolvedValue({ nome_atleta: "Maria" }),
}));
vi.mock("@/lib/campaigns/circuit-breaker", () => ({
  recordCampaignSendFailure: vi.fn().mockResolvedValue({ tripped: false, count: 1 }),
  recordCampaignSendSuccess: vi.fn(),
  isCircuitBreakerTripped: vi.fn().mockResolvedValue(false),
}));

import { POST } from "@/app/api/cron/send-campaign-messages/route";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { recordCampaignSendFailure, recordCampaignSendSuccess, isCircuitBreakerTripped } from "@/lib/campaigns/circuit-breaker";
import { resolveCampaignRecipientVariables } from "@/lib/campaigns/resolve-recipient-variables";

const dbMock = db as any;
const sendMock = vi.mocked(sendWhatsAppMessage);

function makeRequest() {
  return new Request("http://localhost", { method: "POST", headers: { "x-cron-secret": "test-secret" } }) as any;
}

describe("POST /api/cron/send-campaign-messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
    dbMock.campaignRecipient.findFirst.mockResolvedValue(null);
    // Default: sweep de recuperação sem nenhum destinatário travado, e reivindicação bem-sucedida.
    // Testes que precisam simular uma corrida perdida sobrescrevem a 2ª chamada com mockResolvedValueOnce.
    dbMock.campaignRecipient.updateMany.mockResolvedValue({ count: 1 });
    dbMock.campaign.updateMany.mockResolvedValue({ count: 0 });
    dbMock.campaign.findMany.mockResolvedValue([]);
    // Default: atleta com consentimento e telefone — testes que precisam do caminho OPTED_OUT
    // sobrescrevem isto com mockResolvedValueOnce. Sem este default, qualquer teste que não mocka
    // explicitamente db.user.findUnique cairia sempre no ramo OPTED_OUT (valor undefined vira
    // falsy), nunca exercitando o envio/retry/falha que o teste alega testar.
    dbMock.user.findUnique.mockResolvedValue({ receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } });
  });

  it("401 sem o segredo correto", async () => {
    const res = await POST(new Request("http://localhost", { method: "POST" }) as any);
    expect(res.status).toBe(401);
  });

  it("promove campanhas SCHEDULED vencidas pra RUNNING", async () => {
    await POST(makeRequest());
    expect(dbMock.campaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "SCHEDULED" }), data: { status: "RUNNING" } }),
    );
  });

  it("varredura de recuperação: reseta destinatário PROCESSING antigo pra PENDING, antes de qualquer outra coisa", async () => {
    await POST(makeRequest());

    expect(dbMock.campaignRecipient.updateMany).toHaveBeenCalledWith({
      where: { status: "PROCESSING", updatedAt: { lt: expect.any(Date) } },
      data: { status: "PENDING" },
    });
  });

  it("não processa nada se o circuit breaker já disparou", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1",
      athleteUserId: "athlete-1",
      registrationId: null,
      campaignId: "campaign-1",
      normalizedPhone: "5511999999999",
    });
    dbMock.campaign.findFirst.mockResolvedValue({ id: "campaign-1", messageBody: "Olá {{nome_atleta}}" });
    vi.mocked(isCircuitBreakerTripped).mockResolvedValueOnce(true);

    await POST(makeRequest());

    expect(sendMock).not.toHaveBeenCalled();
    // Só a chamada da varredura de recuperação deve ter acontecido — a reivindicação (2ª chamada
    // de updateMany, pra status: "PROCESSING") nunca é alcançada, porque o circuit breaker corta
    // o fluxo antes da busca do candidato.
    expect(dbMock.campaignRecipient.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "PROCESSING" } }),
    );
  });

  it("corrida perdida: outro processo já reivindicou o candidato entre o findFirst e o updateMany", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1",
      athleteUserId: "athlete-1",
      registrationId: null,
      campaignId: "campaign-1",
      normalizedPhone: "5511999999999",
    });
    dbMock.campaignRecipient.updateMany
      .mockResolvedValueOnce({ count: 0 }) // varredura de recuperação — nada travado
      .mockResolvedValueOnce({ count: 0 }); // reivindicação perdida — outro processo já pegou esta linha

    const res = await POST(makeRequest());
    const data = await res.json();

    expect(data).toEqual({ processed: false, reason: "lost_claim_race" });
    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMock.campaignRecipient.update).not.toHaveBeenCalled();
  });

  it("envia com sucesso: marca SENT, grava sentAt/providerMessageId, zera contador de falhas", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1",
      athleteUserId: "athlete-1",
      registrationId: null,
      campaignId: "campaign-1",
      // Telefone capturado pela Fase B, deliberadamente DIFERENTE do telefone atual do atleta
      // (buscado logo abaixo) — prova que o envio usa o telefone FRESCO, não este snapshot stale.
      normalizedPhone: "5511888888888",
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá {{nome_atleta}}" });
    dbMock.user.findUnique.mockResolvedValueOnce({ receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } });
    dbMock.campaignRecipient.update.mockResolvedValueOnce({});
    sendMock.mockResolvedValueOnce({ providerMessageId: "wamid.1" });

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.updateMany).toHaveBeenCalledWith({
      where: { id: "rec-1", status: "PENDING" },
      data: { status: "PROCESSING" },
    });
    // Usa o telefone recém-buscado (normaliza "11999999999" -> "5511999999999"), não o
    // normalizedPhone stale ("5511888888888") capturado quando a Fase B populou a lista.
    expect(sendMock).toHaveBeenCalledWith("5511999999999", expect.stringContaining("RODAPE"), "CAMPAIGN_MESSAGE");
    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({ status: "SENT", providerMessageId: "wamid.1", failureReason: null }),
      }),
    );
    expect(recordCampaignSendSuccess).toHaveBeenCalled();
  });

  it("telefone atual do atleta ausente/inválido: recipiente vira INVALID_PHONE, sem enviar nem contar pro circuit breaker", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1",
      athleteUserId: "athlete-1",
      registrationId: null,
      campaignId: "campaign-1",
      normalizedPhone: "5511999999999",
    });
    dbMock.user.findUnique.mockResolvedValueOnce({ receivePromotionalMessages: true, athleteProfile: { phone: "" } });

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "INVALID_PHONE" }) }),
    );
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordCampaignSendFailure).not.toHaveBeenCalled();
  });

  it("falha com attempts < 3: volta pra PENDING, incrementa attempts e o contador de falhas", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 0,
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    sendMock.mockRejectedValueOnce(new Error("falha de rede"));

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "PENDING", attempts: 1 }) }),
    );
    expect(recordCampaignSendFailure).toHaveBeenCalled();
  });

  it("3ª falha: marca FAILED com failureReason", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 2,
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    sendMock.mockRejectedValueOnce(new Error("falha de novo"));

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "FAILED", attempts: 3 }) }),
    );
  });

  it("5ª falha consecutiva pausa TODAS as campanhas RUNNING", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 0,
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    sendMock.mockRejectedValueOnce(new Error("falha"));
    vi.mocked(recordCampaignSendFailure).mockResolvedValueOnce({ tripped: true, count: 5 });

    await POST(makeRequest());

    expect(dbMock.campaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "RUNNING" }, data: { status: "PAUSED" } }),
    );
  });

  it("erro na resolução de variáveis (antes do envio) não deixa o destinatário preso em PROCESSING", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 0,
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    vi.mocked(resolveCampaignRecipientVariables).mockRejectedValueOnce(new Error("erro ao resolver variáveis"));

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({ status: "PENDING", attempts: 1, failureReason: "erro ao resolver variáveis" }),
      }),
    );
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordCampaignSendFailure).not.toHaveBeenCalled();
  });

  it("erro na re-checagem de consentimento (db.user.findUnique) não deixa o destinatário preso em PROCESSING", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 0,
    });
    dbMock.user.findUnique.mockRejectedValueOnce(new Error("erro ao re-checar consentimento"));

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({ status: "PENDING", attempts: 1, failureReason: "erro ao re-checar consentimento" }),
      }),
    );
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordCampaignSendFailure).not.toHaveBeenCalled();
  });

  it("re-checa receivePromotionalMessages no momento do envio — revogado vira OPTED_OUT sem enviar", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1",
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    dbMock.user.findUnique.mockResolvedValueOnce({ receivePromotionalMessages: false });

    await POST(makeRequest());

    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "OPTED_OUT" }) }),
    );
  });

  it("campanha sem mais PENDING vira COMPLETED", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce(null);
    dbMock.campaign.findMany.mockResolvedValueOnce([{ id: "campaign-1" }]);
    dbMock.campaignRecipient.count.mockResolvedValueOnce(0);

    await POST(makeRequest());

    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "COMPLETED" } });
  });
});
```

- [ ] **Step 3: Rodar a suíte e confirmar que falha**

Rode: `npx vitest run tests/cron-send-campaign-messages-route.test.ts`. Esperado: falhas, já que a
implementação ainda usa a guarda antiga (chamadas mockadas não batem com o comportamento antigo).

- [ ] **Step 4: Reescrever `app/api/cron/send-campaign-messages/route.ts`**

Substitua o conteúdo INTEIRO do arquivo por:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  sendWhatsAppMessage,
  buildPreferencesFooterText,
  normalizePhoneForWhatsApp,
  isValidWhatsAppPhone,
} from "@/lib/whatsapp";
import { renderTemplate } from "@/lib/templates/render";
import { resolveCampaignRecipientVariables } from "@/lib/campaigns/resolve-recipient-variables";
import {
  recordCampaignSendFailure,
  recordCampaignSendSuccess,
  isCircuitBreakerTripped,
} from "@/lib/campaigns/circuit-breaker";

const MAX_ATTEMPTS = 3;
const STALE_PROCESSING_MINUTES = 5;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // 1. Promove campanhas agendadas cujo horário já passou.
  await db.campaign.updateMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    data: { status: "RUNNING" },
  });

  // 2. Varredura de recuperação: destinatário preso em PROCESSING há mais de 5 minutos volta
  // sozinho pra PENDING. Um tick normal dura segundos — 5 minutos preso só acontece se um processo
  // anterior morreu no meio do envio (OOM kill, restart do container, etc.). Substitui a antiga
  // guarda global (que bloqueava TODO envio de campanhas por causa de UM destinatário travado) por
  // autocorreção, sem intervenção manual.
  const staleThreshold = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000);
  await db.campaignRecipient.updateMany({
    where: { status: "PROCESSING", updatedAt: { lt: staleThreshold } },
    data: { status: "PENDING" },
  });

  // 3. Circuit breaker já disparado — não processa nada.
  if (await isCircuitBreakerTripped()) {
    return NextResponse.json({ processed: false, reason: "circuit_breaker_tripped" });
  }

  // 4. Escolhe o próximo candidato: campanha RUNNING mais antiga com algo PENDING, dentro dela
  // o CampaignRecipient PENDING mais antigo.
  const candidate = await db.campaignRecipient.findFirst({
    where: { status: "PENDING", campaign: { status: "RUNNING" } },
    orderBy: [{ campaign: { createdAt: "asc" } }, { createdAt: "asc" }],
  });

  if (!candidate) {
    // Nenhum PENDING em nenhuma campanha RUNNING — completa as que não têm mais nada pendente.
    const runningCampaigns = await db.campaign.findMany({ where: { status: "RUNNING" }, select: { id: true } });
    for (const c of runningCampaigns) {
      const remaining = await db.campaignRecipient.count({ where: { campaignId: c.id, status: "PENDING" } });
      if (remaining === 0) {
        await db.campaign.update({ where: { id: c.id }, data: { status: "COMPLETED" } });
      }
    }
    return NextResponse.json({ processed: false, reason: "nothing_pending" });
  }

  // 5. Reivindicação atômica: o WHERE inclui status: "PENDING" de novo — se outro processo já
  // reivindicou esta linha entre o findFirst (passo 4) e aqui, count vem 0 e a gente simplesmente
  // não processa nada neste tick, sem erro, sem trava global. Isso substitui a guarda antiga por
  // algo que continua correto mesmo com mais de um processo rodando o cron ao mesmo tempo.
  const claim = await db.campaignRecipient.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: { status: "PROCESSING" },
  });
  if (claim.count === 0) {
    return NextResponse.json({ processed: false, reason: "lost_claim_race" });
  }
  const recipient = candidate;

  try {
    // A re-checagem de consentimento, a campanha, a resolução de variáveis e a renderização do
    // template vivem dentro do try: qualquer exceção aqui (erro transiente de banco, bug na
    // resolução de variáveis, messageBody malformado) precisa cair na mesma lógica de
    // retry/FAILED/circuit-breaker do catch abaixo — senão o destinatário fica preso em
    // PROCESSING até a próxima varredura de recuperação (passo 2), sem log nem alerta imediato.

    // 6. Re-checa consentimento AGORA — uma campanha longa dá tempo de sobra pro atleta mudar de
    // ideia em /preferencias depois que a Fase B já preparou a lista.
    const athlete = await db.user.findUnique({
      where: { id: recipient.athleteUserId },
      select: { receivePromotionalMessages: true, athleteProfile: { select: { phone: true } } },
    });

    if (!athlete?.receivePromotionalMessages) {
      await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "OPTED_OUT" } });
      return NextResponse.json({ processed: true, result: "opted_out" });
    }

    // 6b. Usa o telefone ATUAL do atleta (buscado agora), não o snapshot capturado quando a Fase B
    // preparou a lista — pode estar dias desatualizado numa campanha lenta, e enviar pro número
    // errado (reatribuído/corrigido nesse meio-tempo) seria uma mensagem promocional pra quem não
    // consentiu, enquanto quem consentiu de fato nunca recebe.
    const freshPhone = athlete.athleteProfile?.phone
      ? normalizePhoneForWhatsApp(athlete.athleteProfile.phone)
      : null;
    if (!freshPhone || !isValidWhatsAppPhone(freshPhone)) {
      await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "INVALID_PHONE" } });
      return NextResponse.json({ processed: true, result: "invalid_phone" });
    }

    const campaign = await db.campaign.findFirst({ where: { id: recipient.campaignId } });
    if (!campaign) {
      throw new Error("Campanha não encontrada");
    }

    const values = await resolveCampaignRecipientVariables({
      athleteUserId: recipient.athleteUserId,
      registrationId: recipient.registrationId,
    });
    const body = renderTemplate(campaign.messageBody, values, "WHATSAPP") + buildPreferencesFooterText();

    let sendResult: { providerMessageId?: string };
    try {
      sendResult = await sendWhatsAppMessage(freshPhone, body, "CAMPAIGN_MESSAGE");
    } catch (sendErr) {
      const { tripped } = await recordCampaignSendFailure();
      if (tripped) {
        await db.campaign.updateMany({ where: { status: "RUNNING" }, data: { status: "PAUSED" } });
      }
      throw sendErr;
    }

    await db.campaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "SENT", sentAt: new Date(), providerMessageId: sendResult.providerMessageId, failureReason: null },
    });
    await recordCampaignSendSuccess();
    return NextResponse.json({ processed: true, result: "sent" });
  } catch (err) {
    const attempts = (recipient.attempts ?? 0) + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    await db.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: failed ? "FAILED" : "PENDING",
        attempts,
        failureReason: err instanceof Error ? err.message : String(err),
      },
    });
    // Nota: recordCampaignSendFailure() já foi chamado acima, dentro do try interno, se o erro
    // veio de sendWhatsAppMessage. Erros de qualquer outra etapa (busca de campanha, resolução de
    // variáveis, renderização, telefone inválido) chegam aqui SEM contar pro circuit breaker
    // global — só uma falha de envio real deve contar, senão blips transitórios de banco
    // pausariam todas as campanhas.
    return NextResponse.json({ processed: true, result: failed ? "failed" : "retry_scheduled" });
  }
}
```

- [ ] **Step 5: Rodar a suíte e confirmar que passa**

Rode: `npx vitest run tests/cron-send-campaign-messages-route.test.ts`. Esperado: todos os testes
passam (13 testes: os 11 comportamentos antigos ajustados + 2 novos — varredura e corrida perdida).

- [ ] **Step 6: Rodar a suíte inteira do projeto**

Rode: `npx vitest run`. Esperado: nenhuma regressão em nenhum outro arquivo (o mock de
`campaignRecipient.updateMany` adicionado no Step 1 é aditivo — não deveria afetar nenhum outro
teste que já mocka esse model, mas confirme).

- [ ] **Step 7: Commit**

```bash
git add tests/setup.ts app/api/cron/send-campaign-messages/route.ts tests/cron-send-campaign-messages-route.test.ts
git commit -m "feat: worker de campanha usa reivindicacao atomica por destinatario + varredura de recuperacao"
```

---

### Task 3: Rotas de pausar/retomar (evento + admin)

**Files:**
- Create: `app/api/events/[id]/campaigns/[campaignId]/pause/route.ts`
- Create: `app/api/admin/campaigns/[campaignId]/pause/route.ts`
- Create: `app/api/events/[id]/campaigns/[campaignId]/resume/route.ts`
- Create: `app/api/admin/campaigns/[campaignId]/resume/route.ts`
- Modify: `tests/events-campaigns-route.test.ts` (adicionar 2 `describe` blocks novos)
- Modify: `tests/admin-campaigns-route.test.ts` (adicionar 2 `describe` blocks novos)

**Interfaces:**
- Consumes: `resetCircuitBreakerIfTripped` de `@/lib/campaigns/circuit-breaker` (Task 1);
  `resolveCampaignDetailContext` de `@/lib/campaigns/service` (já existe, usado por
  `cancel`/`schedule`); `checkApiPermission`/`checkAdminOnlyApiPermission` de `@/lib/auth/rbac` (já
  existe).
- Produces: `POST .../pause` (sem corpo) → `{ campaign }`; `POST .../resume` (sem corpo) →
  `{ campaign, breakerWasReset: boolean }` — usado pela Task 4 (UI).

- [ ] **Step 1: Escrever os testes falhando pra rota event-scoped**

Em `tests/events-campaigns-route.test.ts`, adicione os imports no topo (junto dos já existentes):

```ts
import { POST as PAUSE } from "@/app/api/events/[id]/campaigns/[campaignId]/pause/route";
import { POST as RESUME } from "@/app/api/events/[id]/campaigns/[campaignId]/resume/route";
import { resetCircuitBreakerIfTripped } from "@/lib/campaigns/circuit-breaker";
```

E logo abaixo do `vi.mock("@/lib/auth", ...)` já existente no topo do arquivo, adicione:

```ts
vi.mock("@/lib/campaigns/circuit-breaker", () => ({
  resetCircuitBreakerIfTripped: vi.fn().mockResolvedValue(false),
}));
```

Adicione estes 2 `describe` blocks ao final do arquivo (depois do último `describe` já existente),
seguindo o mesmo padrão de `draftCampaign`/`authMock`/`dbMock` já usado no arquivo:

```ts
describe("POST /api/events/[id]/campaigns/[campaignId]/pause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
  });

  it("pausa uma campanha RUNNING", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign, status: "RUNNING" });
    dbMock.campaign.update.mockResolvedValueOnce({ ...draftCampaign, status: "PAUSED" });

    const res = await PAUSE(makeRequest("POST"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "PAUSED" } });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CAMPAIGN_PAUSED" }) }),
    );
  });

  it("rejeita pausar uma campanha em DRAFT", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign, status: "DRAFT" });

    const res = await PAUSE(makeRequest("POST"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/events/[id]/campaigns/[campaignId]/resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
  });

  it("retoma uma campanha PAUSED e reseta o circuit breaker quando ele está disparado", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign, status: "PAUSED" });
    dbMock.campaign.update.mockResolvedValueOnce({ ...draftCampaign, status: "RUNNING" });
    vi.mocked(resetCircuitBreakerIfTripped).mockResolvedValueOnce(true);

    const res = await RESUME(makeRequest("POST"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "RUNNING" } });
    expect(data.breakerWasReset).toBe(true);
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CAMPAIGN_RESUMED" }) }),
    );
  });

  it("retoma uma campanha PAUSED sem mexer no circuit breaker quando ele não está disparado", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign, status: "PAUSED" });
    dbMock.campaign.update.mockResolvedValueOnce({ ...draftCampaign, status: "RUNNING" });
    vi.mocked(resetCircuitBreakerIfTripped).mockResolvedValueOnce(false);

    const res = await RESUME(makeRequest("POST"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.breakerWasReset).toBe(false);
  });

  it("rejeita retomar uma campanha RUNNING", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign, status: "RUNNING" });

    const res = await RESUME(makeRequest("POST"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Rode: `npx vitest run tests/events-campaigns-route.test.ts`. Esperado: falha (módulos das rotas
ainda não existem).

- [ ] **Step 3: Implementar as rotas event-scoped**

Crie `app/api/events/[id]/campaigns/[campaignId]/pause/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  if (context.campaign.status !== "RUNNING") {
    return NextResponse.json({ error: "Só é possível pausar campanhas em andamento" }, { status: 400 });
  }

  const updated = await db.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED" } });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_PAUSED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: {},
    },
  });

  return NextResponse.json({ campaign: updated });
}
```

Crie `app/api/events/[id]/campaigns/[campaignId]/resume/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { resetCircuitBreakerIfTripped } from "@/lib/campaigns/circuit-breaker";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  if (context.campaign.status !== "PAUSED") {
    return NextResponse.json({ error: "Só é possível retomar campanhas pausadas" }, { status: 400 });
  }

  const updated = await db.campaign.update({ where: { id: campaignId }, data: { status: "RUNNING" } });
  const breakerWasReset = await resetCircuitBreakerIfTripped();

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_RESUMED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: { breakerWasReset },
    },
  });

  return NextResponse.json({ campaign: updated, breakerWasReset });
}
```

- [ ] **Step 4: Rodar e confirmar que os testes event-scoped passam**

Rode: `npx vitest run tests/events-campaigns-route.test.ts`.

- [ ] **Step 5: Escrever os testes falhando pra rota admin**

Em `tests/admin-campaigns-route.test.ts`, adicione os imports no topo (junto dos já existentes):

```ts
import { POST as PAUSE } from "@/app/api/admin/campaigns/[campaignId]/pause/route";
import { POST as RESUME } from "@/app/api/admin/campaigns/[campaignId]/resume/route";
import { resetCircuitBreakerIfTripped } from "@/lib/campaigns/circuit-breaker";
```

E logo abaixo dos `vi.mock` já existentes no topo do arquivo, adicione:

```ts
vi.mock("@/lib/campaigns/circuit-breaker", () => ({
  resetCircuitBreakerIfTripped: vi.fn().mockResolvedValue(false),
}));
```

Adicione estes 2 `describe` blocks ao final do arquivo, seguindo o mesmo padrão de
`platformDraftCampaign`/`authMock`/`dbMock` já usado no arquivo:

```ts
describe("POST /api/admin/campaigns/[campaignId]/pause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("pausa uma campanha RUNNING", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign, status: "RUNNING" });
    dbMock.campaign.update.mockResolvedValueOnce({ ...platformDraftCampaign, status: "PAUSED" });

    const res = await PAUSE(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "PAUSED" } });
  });

  it("rejeita pausar uma campanha em DRAFT", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign, status: "DRAFT" });

    const res = await PAUSE(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });

  it("rejeita ORGANIZER ao pausar, mesmo com campaignsEnabled", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await PAUSE(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/campaigns/[campaignId]/resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retoma uma campanha PAUSED e reseta o circuit breaker quando ele está disparado", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign, status: "PAUSED" });
    dbMock.campaign.update.mockResolvedValueOnce({ ...platformDraftCampaign, status: "RUNNING" });
    vi.mocked(resetCircuitBreakerIfTripped).mockResolvedValueOnce(true);

    const res = await RESUME(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.breakerWasReset).toBe(true);
  });

  it("rejeita retomar uma campanha RUNNING", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign, status: "RUNNING" });

    const res = await RESUME(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Rodar e confirmar que falha**

Rode: `npx vitest run tests/admin-campaigns-route.test.ts`. Esperado: falha (módulos das rotas
admin ainda não existem).

- [ ] **Step 7: Implementar as rotas admin**

Crie `app/api/admin/campaigns/[campaignId]/pause/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkAdminOnlyApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  if (context.campaign.status !== "RUNNING") {
    return NextResponse.json({ error: "Só é possível pausar campanhas em andamento" }, { status: 400 });
  }

  const updated = await db.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED" } });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_PAUSED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: {},
    },
  });

  return NextResponse.json({ campaign: updated });
}
```

Crie `app/api/admin/campaigns/[campaignId]/resume/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { resetCircuitBreakerIfTripped } from "@/lib/campaigns/circuit-breaker";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkAdminOnlyApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  if (context.campaign.status !== "PAUSED") {
    return NextResponse.json({ error: "Só é possível retomar campanhas pausadas" }, { status: 400 });
  }

  const updated = await db.campaign.update({ where: { id: campaignId }, data: { status: "RUNNING" } });
  const breakerWasReset = await resetCircuitBreakerIfTripped();

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_RESUMED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: { breakerWasReset },
    },
  });

  return NextResponse.json({ campaign: updated, breakerWasReset });
}
```

- [ ] **Step 8: Rodar a suíte inteira e confirmar que tudo passa**

Rode: `npx vitest run`.

- [ ] **Step 9: Commit**

```bash
git add app/api/events/\[id\]/campaigns/\[campaignId\]/pause app/api/events/\[id\]/campaigns/\[campaignId\]/resume app/api/admin/campaigns/\[campaignId\]/pause app/api/admin/campaigns/\[campaignId\]/resume tests/events-campaigns-route.test.ts tests/admin-campaigns-route.test.ts
git commit -m "feat: rotas de pausar/retomar campanha (evento + admin), com reset condicional do circuit breaker"
```

---

### Task 4: UI — botões Pausar/Retomar

**Files:**
- Modify: `components/campaigns/CampaignsManager.tsx`

**Interfaces:**
- Consumes: `POST {apiBase}/{campaignId}/pause` e `POST {apiBase}/{campaignId}/resume` (Task 3) —
  ambos sem corpo, `resume` retorna `{ campaign, breakerWasReset }` (o campo `breakerWasReset` não
  precisa ser mostrado na UI nesta fase — só o reload do estado já reflete `RUNNING`).

Não existe suíte de componente pra este arquivo (mesma situação já registrada nas Fases D e E) —
esta task é verificada por leitura direta do código depois de implementada, não por teste
automatizado novo.

- [ ] **Step 1: Adicionar os 2 states novos, ao lado de `cancelingId`/`canceling` (linha ~65-66)**

Localize (perto do topo do componente, junto dos outros `useState`):

```tsx
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
```

Adicione logo abaixo:

```tsx
  const [pausingConfirmId, setPausingConfirmId] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);
  const [resumingConfirmId, setResumingConfirmId] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
```

- [ ] **Step 2: Adicionar `doPause`/`doResume`, ao lado de `doCancel` (depois da função `doCancel`)**

Localize a função `doCancel` (usa `cancelingId`/`setCanceling`/`fetch .../cancel`). Logo depois
dela, adicione:

```tsx
  async function doPause() {
    if (!pausingConfirmId) return;
    setPausing(true);
    const res = await fetch(`${apiBase}/${pausingConfirmId}/pause`, { method: "POST" });
    setPausing(false);
    setPausingConfirmId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Erro ao pausar campanha");
      return;
    }
    await reload();
  }

  async function doResume() {
    if (!resumingConfirmId) return;
    setResuming(true);
    const res = await fetch(`${apiBase}/${resumingConfirmId}/resume`, { method: "POST" });
    setResuming(false);
    setResumingConfirmId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Erro ao retomar campanha");
      return;
    }
    await reload();
  }
```

- [ ] **Step 3: Adicionar os 2 `ConfirmModal` novos, ao lado do `ConfirmModal` de `cancelingId`**

Localize o `ConfirmModal` de `cancelingId` (título "Cancelar campanha", logo no início do JSX
retornado, dentro de `<div className="max-w-2xl mx-auto space-y-6">`). Logo depois dele, adicione:

```tsx
      <ConfirmModal
        open={!!pausingConfirmId}
        title="Pausar campanha"
        message="Isso vai parar o envio desta campanha imediatamente. Os destinatários que ainda não receberam a mensagem continuam pendentes e o envio pode ser retomado depois. Deseja continuar?"
        confirmLabel="Pausar"
        tone="danger"
        loading={pausing}
        onConfirm={doPause}
        onCancel={() => setPausingConfirmId(null)}
      />

      <ConfirmModal
        open={!!resumingConfirmId}
        title="Retomar campanha"
        message="Isso vai voltar a enviar mensagens reais de WhatsApp pros destinatários pendentes desta campanha. Se a pausa foi causada por falhas consecutivas de envio, o contador de falhas também será reiniciado. Deseja continuar?"
        confirmLabel="Retomar"
        tone="danger"
        loading={resuming}
        onConfirm={doResume}
        onCancel={() => setResumingConfirmId(null)}
      />
```

- [ ] **Step 4: Adicionar os botões no card da campanha**

Localize o bloco `{campaign.status === "SCHEDULED" && (...)}` (botão "Cancelar" pra campanha
agendada, adicionado na Fase D). Logo depois dele (antes do botão "Duplicar"), adicione:

```tsx
                  {campaign.status === "RUNNING" && (
                    <button onClick={() => setPausingConfirmId(campaign.id)} className="text-amber-600 hover:text-amber-800 text-sm">
                      Pausar
                    </button>
                  )}
                  {campaign.status === "PAUSED" && (
                    <button onClick={() => setResumingConfirmId(campaign.id)} className="text-green-700 hover:text-green-900 text-sm">
                      Retomar
                    </button>
                  )}
```

- [ ] **Step 5: Rodar `tsc --noEmit` e a suíte inteira**

Rode: `npx tsc --noEmit -p tsconfig.json` (esperado: limpo) e `npx vitest run` (esperado: nenhuma
regressão — este arquivo não tem suíte própria, mas outros testes não devem ser afetados).

- [ ] **Step 6: Commit**

```bash
git add components/campaigns/CampaignsManager.tsx
git commit -m "feat: botoes Pausar/Retomar na UI de campanhas"
```
