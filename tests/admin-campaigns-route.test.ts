import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/campaigns/recipients", () => ({ prepareCampaignRecipients: vi.fn() }));
vi.mock("@/lib/campaigns/circuit-breaker", () => ({
  resetCircuitBreakerIfTripped: vi.fn().mockResolvedValue(false),
}));

import { GET, POST } from "@/app/api/admin/campaigns/route";
import { GET as GET_ONE, PATCH } from "@/app/api/admin/campaigns/[campaignId]/route";
import { DELETE as DELETE_CAMPAIGN } from "@/app/api/admin/campaigns/[campaignId]/route";
import { POST as CANCEL } from "@/app/api/admin/campaigns/[campaignId]/cancel/route";
import { POST as DUPLICATE } from "@/app/api/admin/campaigns/[campaignId]/duplicate/route";
import { POST as PREPARE } from "@/app/api/admin/campaigns/[campaignId]/prepare-recipients/route";
import { GET as SUMMARY } from "@/app/api/admin/campaigns/[campaignId]/recipients/summary/route";
import { POST as PAUSE } from "@/app/api/admin/campaigns/[campaignId]/pause/route";
import { POST as RESUME } from "@/app/api/admin/campaigns/[campaignId]/resume/route";
import { prepareCampaignRecipients } from "@/lib/campaigns/recipients";
import { resetCircuitBreakerIfTripped } from "@/lib/campaigns/circuit-breaker";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const prepareMock = vi.mocked(prepareCampaignRecipients);

function makeRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/admin/campaigns", {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as any;
}

const platformDraftCampaign = {
  id: "campaign-1",
  eventId: null,
  name: "Campanha de plataforma",
  description: null,
  status: "DRAFT",
  messageBody: "Olá {{nome_atleta}}!",
  createdByUserId: "admin-1",
};

describe("GET/POST /api/admin/campaigns (admin-only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejeita ORGANIZER, mesmo com campaignsEnabled", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await GET(makeRequest("GET"));

    expect(res.status).toBe(403);
    expect(dbMock.campaign.findMany).not.toHaveBeenCalled();
  });

  it("lista as campanhas de plataforma (eventId null) como ADMIN", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.findMany.mockResolvedValueOnce([platformDraftCampaign]);

    const res = await GET(makeRequest("GET"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(dbMock.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: null } }),
    );
    expect(data.campaigns).toHaveLength(1);
  });

  it("cria uma campanha de plataforma (eventId null) como ADMIN", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.create.mockResolvedValueOnce({ ...platformDraftCampaign });

    const res = await POST(makeRequest("POST", { name: "Campanha de plataforma", messageBody: "Olá!" }));

    expect(res.status).toBe(201);
    expect(dbMock.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventId: null, createdByUserId: "admin-1" }) }),
    );
  });

  it("rejeita ORGANIZER ao criar campanha, mesmo com campaignsEnabled", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await POST(makeRequest("POST", { name: "Campanha de plataforma", messageBody: "Olá!" }));

    expect(res.status).toBe(403);
    expect(dbMock.campaign.create).not.toHaveBeenCalled();
  });

  it("rejeita ASSISTANT de ORGANIZER, mesmo com a permissão concedida", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValue({ id: "perm-1" });
    // checkAdminOnlyApiPermission e resolveCampaignListContext cada um chama resolveActingScope,
    // então db.user.findUnique é consultado duas vezes nesse fluxo — mockResolvedValue (não Once)
    // garante a mesma resposta nas duas chamadas.
    dbMock.user.findUnique.mockResolvedValue({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await GET(makeRequest("GET"));

    expect(res.status).toBe(403);
    expect(dbMock.campaign.findMany).not.toHaveBeenCalled();
  });

  it("permite ASSISTANT de ADMIN, com a permissão concedida", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValue({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValue({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.campaign.findMany.mockResolvedValueOnce([platformDraftCampaign]);

    const res = await GET(makeRequest("GET"));

    expect(res.status).toBe(200);
    expect(dbMock.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: null } }),
    );
  });

  it("rejeita variável de categoria Evento numa campanha de plataforma", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await POST(makeRequest("POST", { name: "Campanha de plataforma", messageBody: "Vem pro {{nome_evento}}!" }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.unknownVariables).toEqual(["nome_evento"]);
    expect(dbMock.campaign.create).not.toHaveBeenCalled();
  });
});

describe("GET/PATCH /api/admin/campaigns/[campaignId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.findFirst.mockResolvedValue({ ...platformDraftCampaign });
  });

  it("retorna a campanha de plataforma", async () => {
    const res = await GET_ONE(makeRequest("GET"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.campaign.findFirst).toHaveBeenCalledWith({ where: { id: "campaign-1", eventId: null } });
  });

  it("edita uma campanha de plataforma em DRAFT", async () => {
    dbMock.campaign.update.mockResolvedValueOnce({ ...platformDraftCampaign, name: "Nome novo" });

    const res = await PATCH(
      makeRequest("PATCH", { name: "Nome novo" }),
      { params: Promise.resolve({ campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(200);
  });

  it("rejeita ORGANIZER ao editar, mesmo com campaignsEnabled", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await PATCH(
      makeRequest("PATCH", { name: "Nome novo" }),
      { params: Promise.resolve({ campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(403);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });

  it("rejeita editar com variável de categoria Evento", async () => {
    const res = await PATCH(
      makeRequest("PATCH", { messageBody: "Vem pro {{nome_evento}}!" }),
      { params: Promise.resolve({ campaignId: "campaign-1" }) },
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.unknownVariables).toEqual(["nome_evento"]);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/campaigns/[campaignId]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("cancela uma campanha de plataforma em DRAFT", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign });
    dbMock.campaign.update.mockResolvedValueOnce({ ...platformDraftCampaign, status: "CANCELLED" });

    const res = await CANCEL(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "CANCELLED" } });
  });

  it("rejeita ORGANIZER ao cancelar, mesmo com campaignsEnabled", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await CANCEL(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });

  it("cancela uma campanha de plataforma em SCHEDULED", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign, status: "SCHEDULED" });
    dbMock.campaign.update.mockResolvedValueOnce({ ...platformDraftCampaign, status: "CANCELLED" });

    const res = await CANCEL(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "CANCELLED" } });
  });

  it("rejeita cancelar uma campanha RUNNING", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign, status: "RUNNING" });

    const res = await CANCEL(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/campaigns/[campaignId]/duplicate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("duplica uma campanha de plataforma numa DRAFT nova, ainda sem evento", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign, status: "CANCELLED" });
    dbMock.campaign.create.mockResolvedValueOnce({ ...platformDraftCampaign, id: "campaign-2", name: "Cópia de Campanha de plataforma" });

    const res = await DUPLICATE(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(201);
    expect(dbMock.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventId: null, status: "DRAFT" }) }),
    );
  });

  it("rejeita ORGANIZER ao duplicar, mesmo com campaignsEnabled", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await DUPLICATE(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.campaign.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/campaigns/[campaignId]/prepare-recipients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("prepara os destinatários de uma campanha de plataforma em DRAFT", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign });
    prepareMock.mockResolvedValueOnce({ total: 1000, pending: 950, optedOut: 30, invalidPhone: 20, duplicate: 0 });

    const res = await PREPARE(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(prepareMock).toHaveBeenCalledWith("campaign-1", null, undefined);
    expect(data.summary.total).toBe(1000);
  });

  it("rejeita ORGANIZER ao preparar destinatários, mesmo com campaignsEnabled", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await PREPARE(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(403);
    expect(prepareMock).not.toHaveBeenCalled();
  });

  it("repassa athleteUserIds do corpo pra prepareCampaignRecipients (seleção manual)", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign });
    prepareMock.mockResolvedValueOnce({ total: 2, pending: 2, optedOut: 0, invalidPhone: 0, duplicate: 0 });

    const res = await PREPARE(
      makeRequest("POST", { athleteUserIds: ["athlete-1", "athlete-2"] }),
      { params: Promise.resolve({ campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(200);
    expect(prepareMock).toHaveBeenCalledWith("campaign-1", null, ["athlete-1", "athlete-2"]);
  });

  it("rejeita athleteUserIds malformado (chave presente mas de tipo errado) em vez de cair no modo automático", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign });

    const res = await PREPARE(
      makeRequest("POST", { athleteUserIds: "not-an-array" }),
      { params: Promise.resolve({ campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(400);
    expect(prepareMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/campaigns/[campaignId]/recipients/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.findFirst.mockResolvedValue({ ...platformDraftCampaign });
  });

  it("retorna a contagem de destinatários agrupada por status", async () => {
    dbMock.campaignRecipient.groupBy.mockResolvedValueOnce([{ status: "PENDING", _count: { _all: 950 } }]);

    const res = await SUMMARY(makeRequest("GET"), { params: Promise.resolve({ campaignId: "campaign-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.summary).toEqual({ PENDING: 950 });
  });
});

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

describe("DELETE /api/admin/campaigns/[campaignId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    // Roteia o tx do $transaction pros mesmos spies de dbMock, pra podermos controlar os
    // valores retornados (count pós-deleteMany) e também afirmar sobre as chamadas — mesmo
    // padrão usado em tests/event-delete-route.test.ts.
    dbMock.$transaction.mockImplementation(async (fn: any) =>
      fn({
        campaignRecipient: { deleteMany: dbMock.campaignRecipient.deleteMany, count: dbMock.campaignRecipient.count },
        campaign: { delete: dbMock.campaign.delete },
      }),
    );
  });

  it("exclui uma campanha sem nenhum envio real", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign });
    dbMock.campaignRecipient.count.mockResolvedValueOnce(0);

    const res = await DELETE_CAMPAIGN(makeRequest("DELETE"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.campaignRecipient.deleteMany).toHaveBeenCalledWith({
      where: { campaignId: "campaign-1", status: { in: ["PENDING", "SKIPPED", "OPTED_OUT", "INVALID_PHONE", "CANCELLED"] } },
    });
    expect(dbMock.campaign.delete).toHaveBeenCalledWith({ where: { id: "campaign-1" } });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CAMPAIGN_DELETED" }) }),
    );
  });

  it("rejeita excluir uma campanha que já teve envios reais", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign, status: "RUNNING" });
    dbMock.campaignRecipient.count.mockResolvedValueOnce(3);

    const res = await DELETE_CAMPAIGN(makeRequest("DELETE"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.campaign.delete).not.toHaveBeenCalled();
  });

  it("rejeita e não deleta nada se um recipient PROCESSING/SENT sobrevive ao deleteMany (corrida com o cron)", async () => {
    // Simula o cron (app/api/cron/send-campaign-messages) tendo reivindicado um recipient
    // (status PROCESSING, envio em andamento/prestes a acontecer via WhatsApp) ou já concluído
    // pra SENT bem no meio da exclusão. O deleteMany exclui explicitamente PROCESSING/SENT/etc do
    // seu WHERE, então essa linha sempre sobrevive; a recontagem pós-deleteMany ainda encontra 1
    // registro, então a transação inteira é abortada (deleteMany incluso) e nada é removido —
    // fecha tanto a janela "já tinha envio real" quanto a janela "envio em voo via PROCESSING".
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign });
    dbMock.campaignRecipient.count.mockResolvedValueOnce(1);

    const res = await DELETE_CAMPAIGN(makeRequest("DELETE"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.campaign.delete).not.toHaveBeenCalled();
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejeita ORGANIZER", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await DELETE_CAMPAIGN(makeRequest("DELETE"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.campaign.delete).not.toHaveBeenCalled();
  });
});
