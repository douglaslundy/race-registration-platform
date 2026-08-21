import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { prepareCampaignRecipients } from "@/lib/campaigns/recipients";

const dbMock = db as any;

describe("prepareCampaignRecipients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("apaga destinatários existentes antes de repopular", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await prepareCampaignRecipients("campaign-1", "event-1");

    expect(dbMock.campaignRecipient.deleteMany).toHaveBeenCalledWith({ where: { campaignId: "campaign-1" } });
  });

  it("marca como PENDING um destinatário elegível com telefone válido", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-1",
        athleteUserId: "athlete-1",
        athlete: { receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } },
      },
    ]);

    const result = await prepareCampaignRecipients("campaign-1", "event-1");

    expect(dbMock.campaignRecipient.createMany).toHaveBeenCalledWith({
      data: [
        {
          campaignId: "campaign-1",
          athleteUserId: "athlete-1",
          registrationId: "reg-1",
          normalizedPhone: "5511999999999",
          status: "PENDING",
          failureReason: null,
        },
      ],
    });
    expect(result).toEqual({ total: 1, pending: 1, optedOut: 0, invalidPhone: 0, duplicate: 0 });
  });

  it("marca como OPTED_OUT quando receivePromotionalMessages é false", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-1",
        athleteUserId: "athlete-1",
        athlete: { receivePromotionalMessages: false, athleteProfile: { phone: "11999999999" } },
      },
    ]);

    const result = await prepareCampaignRecipients("campaign-1", "event-1");

    expect(result.optedOut).toBe(1);
    expect(result.pending).toBe(0);
  });

  it("marca como INVALID_PHONE quando o telefone está ausente", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-1",
        athleteUserId: "athlete-1",
        athlete: { receivePromotionalMessages: true, athleteProfile: { phone: null } },
      },
    ]);

    const result = await prepareCampaignRecipients("campaign-1", "event-1");

    expect(result.invalidPhone).toBe(1);
    expect(result.pending).toBe(0);
  });

  it("marca como INVALID_PHONE quando o telefone tem formato inválido", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-1",
        athleteUserId: "athlete-1",
        athlete: { receivePromotionalMessages: true, athleteProfile: { phone: "123" } },
      },
    ]);

    const result = await prepareCampaignRecipients("campaign-1", "event-1");

    expect(result.invalidPhone).toBe(1);
  });

  it("marca como SKIPPED (duplicado) a segunda ocorrência do mesmo telefone, mantendo a primeira como PENDING", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-1",
        athleteUserId: "athlete-1",
        athlete: { receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } },
      },
      {
        id: "reg-2",
        athleteUserId: "athlete-2",
        athlete: { receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } },
      },
    ]);

    const result = await prepareCampaignRecipients("campaign-1", "event-1");

    expect(result).toEqual({ total: 2, pending: 1, optedOut: 0, invalidPhone: 0, duplicate: 1 });
    const rows = dbMock.campaignRecipient.createMany.mock.calls[0][0].data;
    expect(rows[0].status).toBe("PENDING");
    expect(rows[1].status).toBe("SKIPPED");
    expect(rows[1].failureReason).toBe("Telefone duplicado nesta campanha");
  });

  it("processa em múltiplos lotes quando há mais candidatos que o tamanho do lote (500)", async () => {
    const batch1 = Array.from({ length: 500 }, (_, i) => ({
      id: `reg-${i}`,
      athleteUserId: `athlete-${i}`,
      athlete: {
        receivePromotionalMessages: true,
        athleteProfile: { phone: `119${String(10000000 + i).slice(-8)}` },
      },
    }));
    dbMock.registration.findMany.mockResolvedValueOnce(batch1).mockResolvedValueOnce([]);

    const result = await prepareCampaignRecipients("campaign-1", "event-1");

    expect(dbMock.registration.findMany).toHaveBeenCalledTimes(2);
    expect(result.total).toBe(500);
  });

  it("detecta duplicado de telefone quando as ocorrências caem em lotes diferentes", async () => {
    const DUP_PHONE = "11999999999";
    const DUP_NORMALIZED = "5511999999999";

    const batch1 = Array.from({ length: 500 }, (_, i) => ({
      id: `reg-${i}`,
      athleteUserId: `athlete-${i}`,
      athlete: {
        receivePromotionalMessages: true,
        athleteProfile: {
          phone: i === 499 ? DUP_PHONE : `119${String(10000000 + i).slice(-8)}`,
        },
      },
    }));
    const batch2 = [
      {
        id: "reg-500",
        athleteUserId: "athlete-500",
        athlete: { receivePromotionalMessages: true, athleteProfile: { phone: DUP_PHONE } },
      },
    ];
    dbMock.registration.findMany.mockResolvedValueOnce(batch1).mockResolvedValueOnce(batch2);

    const result = await prepareCampaignRecipients("campaign-1", "event-1");

    expect(dbMock.registration.findMany).toHaveBeenCalledTimes(2);
    expect(result.total).toBe(501);
    expect(result.pending).toBe(500);
    expect(result.duplicate).toBe(1);

    const batch1Rows = dbMock.campaignRecipient.createMany.mock.calls[0][0].data;
    const batch2Rows = dbMock.campaignRecipient.createMany.mock.calls[1][0].data;

    expect(batch1Rows[499].registrationId).toBe("reg-499");
    expect(batch1Rows[499].normalizedPhone).toBe(DUP_NORMALIZED);
    expect(batch1Rows[499].status).toBe("PENDING");

    expect(batch2Rows[0].registrationId).toBe("reg-500");
    expect(batch2Rows[0].normalizedPhone).toBe("");
    expect(batch2Rows[0].status).toBe("SKIPPED");
    expect(batch2Rows[0].failureReason).toBe("Telefone duplicado nesta campanha");
  });

  it("usa User (role ATHLETE, active) em vez de Registration quando eventId é null (modo plataforma)", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "athlete-1", receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } },
    ]);

    const result = await prepareCampaignRecipients("campaign-1", null);

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "ATHLETE", active: true } }),
    );
    expect(dbMock.registration.findMany).not.toHaveBeenCalled();
    expect(result.pending).toBe(1);
    expect(dbMock.campaignRecipient.createMany).toHaveBeenCalledWith({
      data: [
        {
          campaignId: "campaign-1",
          athleteUserId: "athlete-1",
          registrationId: null,
          normalizedPhone: "5511999999999",
          status: "PENDING",
          failureReason: null,
        },
      ],
    });
  });
});
