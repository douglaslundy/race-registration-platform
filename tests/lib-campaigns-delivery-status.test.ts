import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { updateCampaignRecipientStatusByProviderMessageId } from "@/lib/campaigns/delivery-status";

const dbMock = db as any;

describe("updateCampaignRecipientStatusByProviderMessageId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atualiza pra DELIVERED quando o ACK é DELIVERED e o status atual é SENT", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({ id: "rec-1", status: "SENT" });

    await updateCampaignRecipientStatusByProviderMessageId("wamid.abc", "DELIVERED");

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith({
      where: { id: "rec-1" },
      data: { status: "DELIVERED" },
    });
  });

  it("atualiza pra READ quando o ACK é READ e o status atual é DELIVERED", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({ id: "rec-2", status: "DELIVERED" });

    await updateCampaignRecipientStatusByProviderMessageId("wamid.def", "READ");

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith({
      where: { id: "rec-2" },
      data: { status: "READ" },
    });
  });

  it("permite pular direto de SENT pra READ (o ACK de DELIVERED às vezes não chega)", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({ id: "rec-3", status: "SENT" });

    await updateCampaignRecipientStatusByProviderMessageId("wamid.ghi", "READ");

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith({
      where: { id: "rec-3" },
      data: { status: "READ" },
    });
  });

  it("não regride: ignora DELIVERED se o status atual já é READ", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({ id: "rec-4", status: "READ" });

    await updateCampaignRecipientStatusByProviderMessageId("wamid.jkl", "DELIVERED");

    expect(dbMock.campaignRecipient.update).not.toHaveBeenCalled();
  });

  it("ignora qualquer status fora de SENT/DELIVERED/READ (ex: FAILED, OPTED_OUT, PENDING, PROCESSING, CANCELLED)", async () => {
    for (const status of ["FAILED", "OPTED_OUT", "PENDING", "PROCESSING", "CANCELLED", "SKIPPED", "INVALID_PHONE"]) {
      dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({ id: "rec-x", status });
      await updateCampaignRecipientStatusByProviderMessageId("wamid.x", "DELIVERED");
    }

    expect(dbMock.campaignRecipient.update).not.toHaveBeenCalled();
  });

  it("ignora silenciosamente quando providerMessageId não bate com nenhuma linha", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce(null);

    await expect(
      updateCampaignRecipientStatusByProviderMessageId("wamid.unknown", "READ"),
    ).resolves.toBeUndefined();
    expect(dbMock.campaignRecipient.update).not.toHaveBeenCalled();
  });

  describe("FAILED", () => {
    it("marca FAILED quando o status atual é SENT", async () => {
      dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({ id: "rec-f1", status: "SENT" });

      await updateCampaignRecipientStatusByProviderMessageId("SM1", "FAILED", "Twilio 63016");

      expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith({
        where: { id: "rec-f1" },
        data: { status: "FAILED", failureReason: "Twilio 63016" },
      });
    });

    it("sem errorMessage: marca FAILED sem tocar em failureReason", async () => {
      dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({ id: "rec-f2", status: "SENT" });

      await updateCampaignRecipientStatusByProviderMessageId("SM1", "FAILED");

      expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith({
        where: { id: "rec-f2" },
        data: { status: "FAILED" },
      });
    });

    it("NÃO reverte DELIVERED/READ para FAILED", async () => {
      for (const status of ["DELIVERED", "READ"]) {
        dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({ id: "rec-fx", status });
        await updateCampaignRecipientStatusByProviderMessageId("SM1", "FAILED");
      }
      expect(dbMock.campaignRecipient.update).not.toHaveBeenCalled();
    });

    it("idempotente: FAILED de novo num destinatário já FAILED → no-op", async () => {
      dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({ id: "rec-f3", status: "FAILED" });
      await updateCampaignRecipientStatusByProviderMessageId("SM1", "FAILED");
      expect(dbMock.campaignRecipient.update).not.toHaveBeenCalled();
    });

    it("providerMessageId desconhecido → no-op", async () => {
      dbMock.campaignRecipient.findFirst.mockResolvedValueOnce(null);
      await updateCampaignRecipientStatusByProviderMessageId("SM-x", "FAILED");
      expect(dbMock.campaignRecipient.update).not.toHaveBeenCalled();
    });
  });
});
