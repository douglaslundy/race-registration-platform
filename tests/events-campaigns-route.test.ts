import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, POST } from "@/app/api/events/[id]/campaigns/route";
import { GET as GET_ONE, PATCH } from "@/app/api/events/[id]/campaigns/[campaignId]/route";
import { POST as CANCEL } from "@/app/api/events/[id]/campaigns/[campaignId]/cancel/route";
import { POST as DUPLICATE } from "@/app/api/events/[id]/campaigns/[campaignId]/duplicate/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/events/event-1/campaigns", {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as any;
}

const draftCampaign = {
  id: "campaign-1",
  eventId: "event-1",
  name: "Campanha de teste",
  description: null,
  status: "DRAFT",
  messageBody: "Olá {{nome_atleta}}!",
  createdByUserId: "organizer-1",
};

describe("GET/POST /api/events/[id]/campaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
  });

  it("lista as campanhas do evento", async () => {
    dbMock.campaign.findMany.mockResolvedValueOnce([draftCampaign]);

    const res = await GET(makeRequest("GET"), { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.campaigns).toHaveLength(1);
    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "event-1", organizerId: "organizer-profile-1" },
    });
  });

  it("bloqueia quando o organizador não tem campaignsEnabled", async () => {
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: false });

    const res = await GET(makeRequest("GET"), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.campaign.findMany).not.toHaveBeenCalled();
  });

  it("cria uma campanha nova em DRAFT", async () => {
    dbMock.campaign.create.mockResolvedValueOnce({ ...draftCampaign });

    const res = await POST(
      makeRequest("POST", { name: "Campanha de teste", messageBody: "Olá {{nome_atleta}}!" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(201);
    expect(dbMock.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventId: "event-1", createdByUserId: "organizer-1", name: "Campanha de teste" }),
      }),
    );
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CAMPAIGN_CREATED" }) }),
    );
  });

  it("rejeita corpo inválido (sem messageBody)", async () => {
    const res = await POST(
      makeRequest("POST", { name: "Campanha de teste" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("cria uma campanha como ADMIN, mesmo sem ser o organizador do evento", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });
    dbMock.campaign.create.mockResolvedValueOnce({ ...draftCampaign, createdByUserId: "admin-1" });

    const res = await POST(
      makeRequest("POST", { name: "Campanha de teste", messageBody: "Olá!" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(201);
    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "event-1" } });
  });
});

describe("GET/PATCH /api/events/[id]/campaigns/[campaignId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
    dbMock.campaign.findFirst.mockResolvedValue({ ...draftCampaign });
  });

  it("retorna a campanha", async () => {
    const res = await GET_ONE(makeRequest("GET"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) });
    expect(res.status).toBe(200);
    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "event-1", organizerId: "organizer-profile-1" },
    });
  });

  it("retorna 404 quando a campanha não pertence ao evento", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce(null);
    const res = await GET_ONE(makeRequest("GET"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-999" }) });
    expect(res.status).toBe(404);
  });

  it("edita uma campanha em DRAFT", async () => {
    dbMock.campaign.update.mockResolvedValueOnce({ ...draftCampaign, name: "Nome novo" });

    const res = await PATCH(
      makeRequest("PATCH", { name: "Nome novo" }),
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "campaign-1" }, data: expect.objectContaining({ name: "Nome novo" }) }),
    );
  });

  it("rejeita editar uma campanha que não está em DRAFT", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign, status: "CANCELLED" });

    const res = await PATCH(
      makeRequest("PATCH", { name: "Nome novo" }),
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(400);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/events/[id]/campaigns/[campaignId]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
  });

  it("cancela uma campanha em DRAFT", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign });
    dbMock.campaign.update.mockResolvedValueOnce({ ...draftCampaign, status: "CANCELLED" });

    const res = await CANCEL(makeRequest("POST"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "CANCELLED" } });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CAMPAIGN_CANCELLED" }) }),
    );
    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "event-1", organizerId: "organizer-profile-1" },
    });
  });

  it("rejeita cancelar uma campanha já cancelada", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign, status: "CANCELLED" });

    const res = await CANCEL(makeRequest("POST"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/events/[id]/campaigns/[campaignId]/duplicate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
  });

  it("duplica uma campanha existente numa DRAFT nova", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign, status: "CANCELLED" });
    dbMock.campaign.create.mockResolvedValueOnce({ ...draftCampaign, id: "campaign-2", name: "Cópia de Campanha de teste" });

    const res = await DUPLICATE(makeRequest("POST"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(dbMock.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: "event-1",
          name: "Cópia de Campanha de teste",
          messageBody: draftCampaign.messageBody,
          status: "DRAFT",
        }),
      }),
    );
    expect(data.campaign.name).toBe("Cópia de Campanha de teste");
    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "event-1", organizerId: "organizer-profile-1" },
    });
  });
});
