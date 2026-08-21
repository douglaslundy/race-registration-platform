import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/campaigns/recipients", () => ({ prepareCampaignRecipients: vi.fn() }));

import { GET, POST } from "@/app/api/admin/campaigns/route";
import { GET as GET_ONE, PATCH } from "@/app/api/admin/campaigns/[campaignId]/route";
import { POST as CANCEL } from "@/app/api/admin/campaigns/[campaignId]/cancel/route";
import { POST as DUPLICATE } from "@/app/api/admin/campaigns/[campaignId]/duplicate/route";
import { POST as PREPARE } from "@/app/api/admin/campaigns/[campaignId]/prepare-recipients/route";
import { GET as SUMMARY } from "@/app/api/admin/campaigns/[campaignId]/recipients/summary/route";
import { prepareCampaignRecipients } from "@/lib/campaigns/recipients";

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
    expect(prepareMock).toHaveBeenCalledWith("campaign-1", null);
    expect(data.summary.total).toBe(1000);
  });

  it("rejeita ORGANIZER ao preparar destinatários, mesmo com campaignsEnabled", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await PREPARE(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(403);
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
