import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/campaigns/recipients", () => ({ prepareCampaignRecipients: vi.fn() }));

import { POST } from "@/app/api/events/[id]/campaigns/[campaignId]/prepare-recipients/route";
import { GET } from "@/app/api/events/[id]/campaigns/[campaignId]/recipients/summary/route";
import { prepareCampaignRecipients } from "@/lib/campaigns/recipients";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const prepareMock = vi.mocked(prepareCampaignRecipients);

const draftCampaign = { id: "campaign-1", eventId: "event-1", status: "DRAFT" };

describe("POST /api/events/[id]/campaigns/[campaignId]/prepare-recipients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
  });

  it("prepara os destinatários de uma campanha em DRAFT e retorna o resumo", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign });
    prepareMock.mockResolvedValueOnce({ total: 10, pending: 8, optedOut: 1, invalidPhone: 1, duplicate: 0 });

    const res = await POST(
      new Request("http://localhost", { method: "POST" }) as any,
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(prepareMock).toHaveBeenCalledWith("campaign-1", "event-1");
    expect(data.summary).toEqual({ total: 10, pending: 8, optedOut: 1, invalidPhone: 1, duplicate: 0 });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CAMPAIGN_RECIPIENTS_PREPARED" }) }),
    );
  });

  it("rejeita preparar destinatários de uma campanha que não está em DRAFT", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign, status: "CANCELLED" });

    const res = await POST(
      new Request("http://localhost", { method: "POST" }) as any,
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(400);
    expect(prepareMock).not.toHaveBeenCalled();
  });

  it("bloqueia quando o organizador não tem campaignsEnabled", async () => {
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: false });

    const res = await POST(
      new Request("http://localhost", { method: "POST" }) as any,
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(403);
    expect(prepareMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/events/[id]/campaigns/[campaignId]/recipients/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
    dbMock.campaign.findFirst.mockResolvedValue({ ...draftCampaign });
  });

  it("retorna a contagem de destinatários agrupada por status", async () => {
    dbMock.campaignRecipient.groupBy.mockResolvedValueOnce([
      { status: "PENDING", _count: { _all: 8 } },
      { status: "OPTED_OUT", _count: { _all: 1 } },
    ]);

    const res = await GET(
      new Request("http://localhost", { method: "GET" }) as any,
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.summary).toEqual({ PENDING: 8, OPTED_OUT: 1 });
  });
});
