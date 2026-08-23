import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
  buildPreferencesFooterText: () => "\n\nRODAPE_TESTE",
}));

import { GET as VARIABLES } from "@/app/api/events/[id]/campaigns/variables/route";
import { GET as ALERT_OPTIONS } from "@/app/api/events/[id]/campaigns/alert-options/route";
import { POST as PREVIEW } from "@/app/api/events/[id]/campaigns/[campaignId]/preview/route";
import { POST as TEST_SEND } from "@/app/api/events/[id]/campaigns/[campaignId]/test-send/route";
import { POST as SCHEDULE } from "@/app/api/events/[id]/campaigns/[campaignId]/schedule/route";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const sendMock = vi.mocked(sendWhatsAppMessage);

describe("GET /api/events/[id]/campaigns/variables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
  });

  it("inclui variáveis de Evento, já que a campanha tem um evento associado", async () => {
    const res = await VARIABLES(new Request("http://localhost") as any, { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    const names = data.variables.map((v: any) => v.name);
    expect(names).toContain("nome_evento");
    expect(names).toContain("nome_atleta");
  });

  it("bloqueia quando o organizador não tem campaignsEnabled", async () => {
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: false });

    const res = await VARIABLES(new Request("http://localhost") as any, { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/events/[id]/campaigns/alert-options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
    dbMock.messageTemplate.findFirst.mockResolvedValue(null);
  });

  it("só lista alertas WhatsApp voltados a atleta/comprador", async () => {
    const res = await ALERT_OPTIONS(new Request("http://localhost") as any, { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    const keys = data.options.map((o: any) => o.alertKey);
    expect(keys).toContain("ORDER_CONFIRMED");
    expect(keys).toContain("ABANDONED_CART");
    expect(keys).not.toContain("RECONCILIATION_MISMATCH");
    expect(keys).not.toContain("LOW_STOCK");
    expect(keys).not.toContain("DAILY_SUMMARY");
  });

  it("cada opção retorna o texto efetivo (renderizável) do alerta", async () => {
    const res = await ALERT_OPTIONS(new Request("http://localhost") as any, { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    const orderConfirmed = data.options.find((o: any) => o.alertKey === "ORDER_CONFIRMED");
    // Nota: o corpo WHATSAPP de ORDER_CONFIRMED (registry.ts) não usa {{nome_atleta}} — só a
    // variante EMAIL usa. Verificamos {{codigo_confirmacao}}, que está presente nos dois canais e
    // já é travado por outro teste existente (notifications.test.ts:458) com o texto exato.
    expect(orderConfirmed.body).toContain("{{codigo_confirmacao}}");
  });
});

const draftCampaign = {
  id: "campaign-1",
  eventId: "event-1",
  name: "Campanha de teste",
  description: null,
  status: "DRAFT",
  messageBody: "Olá {{nome_atleta}}, {{nome_evento}} te espera!",
  createdByUserId: "organizer-1",
};

describe("POST /api/events/[id]/campaigns/[campaignId]/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
    dbMock.campaign.findFirst.mockResolvedValue({ ...draftCampaign });
  });

  it("renderiza com dados de exemplo e inclui o rodapé de opt-out, sem enviar nada", async () => {
    const res = await PREVIEW(new Request("http://localhost", { method: "POST" }) as any, {
      params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.body).not.toContain("{{");
    expect(data.body).toContain("RODAPE_TESTE");
    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMock.campaignRecipient.createMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/events/[id]/campaigns/[campaignId]/test-send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
    dbMock.campaign.findFirst.mockResolvedValue({ ...draftCampaign });
  });

  it("envia pro telefone da própria conta, prefixado [TESTE], marcado como CAMPAIGN_TEST", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ phone: "5511999999999" });

    const res = await TEST_SEND(new Request("http://localhost", { method: "POST" }) as any, {
      params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledWith("5511999999999", expect.stringContaining("[TESTE]"), "CAMPAIGN_TEST");
    expect(sendMock).toHaveBeenCalledWith("5511999999999", expect.stringContaining("RODAPE_TESTE"), "CAMPAIGN_TEST");
    expect(dbMock.campaignRecipient.createMany).not.toHaveBeenCalled();
  });

  it("400 quando a conta não tem telefone cadastrado", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ phone: null });

    const res = await TEST_SEND(new Request("http://localhost", { method: "POST" }) as any, {
      params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/events/[id]/campaigns/[campaignId]/schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
    dbMock.campaign.findFirst.mockResolvedValue({ id: "campaign-1", eventId: "event-1", status: "DRAFT" });
  });

  it("400 quando a campanha não tem destinatários preparados", async () => {
    dbMock.campaignRecipient.count.mockResolvedValueOnce(0);

    const res = await SCHEDULE(
      new Request("http://localhost", { method: "POST", body: "{}" }) as any,
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(400);
  });

  it("sem scheduledAt: vira RUNNING agora", async () => {
    dbMock.campaignRecipient.count.mockResolvedValueOnce(5);
    dbMock.campaign.update.mockResolvedValueOnce({ id: "campaign-1", status: "RUNNING" });

    const res = await SCHEDULE(
      new Request("http://localhost", { method: "POST", body: "{}" }) as any,
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
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
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "SCHEDULED", scheduledAt: new Date(future) } });
  });

  it("400 com scheduledAt no passado", async () => {
    dbMock.campaignRecipient.count.mockResolvedValueOnce(5);
    const past = new Date(Date.now() - 3600_000).toISOString();

    const res = await SCHEDULE(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ scheduledAt: past }) }) as any,
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(400);
  });
});
