import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
  buildPreferencesFooterText: () => "\n\nRODAPE_TESTE",
  normalizePhoneForWhatsApp: (phone: string) => {
    if (phone.startsWith("+")) return phone.slice(1);
    if (!phone.startsWith("55")) return "55" + phone;
    return phone;
  },
  isValidWhatsAppPhone: (phone: string) => {
    return /^55\d{11}$/.test(phone);
  },
}));

import { GET as VARIABLES } from "@/app/api/admin/campaigns/variables/route";
import { GET as ALERT_OPTIONS } from "@/app/api/admin/campaigns/alert-options/route";
import { POST as PREVIEW } from "@/app/api/admin/campaigns/[campaignId]/preview/route";
import { POST as TEST_SEND } from "@/app/api/admin/campaigns/[campaignId]/test-send/route";
import { POST as SCHEDULE } from "@/app/api/admin/campaigns/[campaignId]/schedule/route";
import { POST as SEND_TO_NUMBER } from "@/app/api/admin/campaigns/[campaignId]/send-to-number/route";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const sendMock = vi.mocked(sendWhatsAppMessage);

describe("GET /api/admin/campaigns/variables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("não inclui variáveis de Evento numa campanha de plataforma", async () => {
    const res = await VARIABLES(new Request("http://localhost") as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    const names = data.variables.map((v: any) => v.name);
    expect(names).not.toContain("nome_evento");
    expect(names).toContain("nome_atleta");
  });

  it("rejeita ORGANIZER", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await VARIABLES(new Request("http://localhost") as any);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/campaigns/alert-options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.messageTemplate.findFirst.mockResolvedValue(null);
  });

  it("filtra alertas cujo texto usa variáveis fora do escopo de plataforma (eventId null)", async () => {
    const res = await ALERT_OPTIONS(new Request("http://localhost") as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    const keys = data.options.map((o: any) => o.alertKey);
    // Todos os alertas WHATSAPP voltados a atleta/comprador (ORDER_CONFIRMED e afins) usam
    // {{nome_evento}} (categoria Evento), que só é permitida quando a campanha tem um evento
    // associado — numa campanha de plataforma inteira (eventId null) nenhum deles cabe, então a
    // lista fica vazia.
    expect(keys).not.toContain("ORDER_CONFIRMED");
    expect(keys).not.toContain("RECONCILIATION_MISMATCH");
    expect(data.options).toEqual([]);
  });
});

const platformDraftCampaign = {
  id: "campaign-1",
  eventId: null,
  name: "Campanha de plataforma",
  description: null,
  status: "DRAFT",
  messageBody: "Olá {{nome_atleta}}!",
  createdByUserId: "admin-1",
};

describe("POST /api/admin/campaigns/[campaignId]/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.findFirst.mockResolvedValue({ ...platformDraftCampaign });
  });

  it("renderiza com dados de exemplo e inclui o rodapé de opt-out", async () => {
    const res = await PREVIEW(new Request("http://localhost", { method: "POST" }) as any, {
      params: Promise.resolve({ campaignId: "campaign-1" }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.body).not.toContain("{{");
    expect(data.body).toContain("RODAPE_TESTE");
    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMock.campaignRecipient.createMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/campaigns/[campaignId]/test-send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.findFirst.mockResolvedValue({ ...platformDraftCampaign });
  });

  it("envia pro telefone da própria conta admin, prefixado [TESTE]", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ phone: "5511988888888" });

    const res = await TEST_SEND(new Request("http://localhost", { method: "POST" }) as any, {
      params: Promise.resolve({ campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledWith("5511988888888", expect.stringContaining("[TESTE]"), "CAMPAIGN_TEST");
    expect(sendMock).toHaveBeenCalledWith("5511988888888", expect.stringContaining("RODAPE_TESTE"), "CAMPAIGN_TEST");
    expect(dbMock.campaignRecipient.createMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/campaigns/[campaignId]/schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.findFirst.mockResolvedValue({ id: "campaign-1", eventId: null, status: "DRAFT" });
  });

  it("400 quando a campanha não tem destinatários preparados", async () => {
    dbMock.campaignRecipient.count.mockResolvedValueOnce(0);

    const res = await SCHEDULE(
      new Request("http://localhost", { method: "POST", body: "{}" }) as any,
      { params: Promise.resolve({ campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(400);
  });

  it("sem scheduledAt: vira RUNNING agora", async () => {
    dbMock.campaignRecipient.count.mockResolvedValueOnce(5);
    dbMock.campaign.update.mockResolvedValueOnce({ id: "campaign-1", status: "RUNNING" });

    const res = await SCHEDULE(
      new Request("http://localhost", { method: "POST", body: "{}" }) as any,
      { params: Promise.resolve({ campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "RUNNING", scheduledAt: null } });
  });

  it("com scheduledAt no futuro: vira SCHEDULED", async () => {
    dbMock.campaignRecipient.count.mockResolvedValueOnce(5);
    const future = new Date(Date.now() + 3600_000).toISOString();
    dbMock.campaign.update.mockResolvedValueOnce({ id: "campaign-1", status: "SCHEDULED" });

    const res = await SCHEDULE(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ scheduledAt: future }) }) as any,
      { params: Promise.resolve({ campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "SCHEDULED", scheduledAt: new Date(future) } });
  });

  it("400 com scheduledAt no passado", async () => {
    dbMock.campaignRecipient.count.mockResolvedValueOnce(5);
    const past = new Date(Date.now() - 3600_000).toISOString();

    const res = await SCHEDULE(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ scheduledAt: past }) }) as any,
      { params: Promise.resolve({ campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/campaigns/[campaignId]/send-to-number", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.findFirst.mockResolvedValue({ ...platformDraftCampaign });
  });

  function makeRequest(body: unknown) {
    return new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as any;
  }

  it("normaliza e envia pro número informado (sem +55, assume Brasil)", async () => {
    const res = await SEND_TO_NUMBER(makeRequest({ phone: "11988888888" }), {
      params: Promise.resolve({ campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledWith("5511988888888", expect.stringContaining("RODAPE_TESTE"), "CAMPAIGN_MESSAGE");
  });

  it("aceita o número já com +55", async () => {
    const res = await SEND_TO_NUMBER(makeRequest({ phone: "+5511988888888" }), {
      params: Promise.resolve({ campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledWith("5511988888888", expect.any(String), "CAMPAIGN_MESSAGE");
  });

  it("rejeita telefone inválido", async () => {
    const res = await SEND_TO_NUMBER(makeRequest({ phone: "123" }), {
      params: Promise.resolve({ campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejeita corpo sem telefone", async () => {
    const res = await SEND_TO_NUMBER(makeRequest({}), {
      params: Promise.resolve({ campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
