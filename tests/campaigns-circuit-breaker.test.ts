import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  recordCampaignSendFailure,
  recordCampaignSendSuccess,
  isCircuitBreakerTripped,
} from "@/lib/campaigns/circuit-breaker";

const dbMock = db as any;

describe("circuit breaker de envio de campanhas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("não dispara antes de 5 falhas seguidas", async () => {
    dbMock.platformSetting.findUnique.mockResolvedValueOnce({ value: "3" });
    const result = await recordCampaignSendFailure();
    expect(result).toEqual({ tripped: false, count: 4 });
    expect(dbMock.platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "campaign_consecutive_failures" }, create: expect.objectContaining({ value: "4" }), update: { value: "4" } }),
    );
  });

  it("dispara exatamente na 5ª falha seguida", async () => {
    dbMock.platformSetting.findUnique.mockResolvedValueOnce({ value: "4" });
    const result = await recordCampaignSendFailure();
    expect(result).toEqual({ tripped: true, count: 5 });
  });

  it("sucesso zera o contador", async () => {
    await recordCampaignSendSuccess();
    expect(dbMock.platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "campaign_consecutive_failures" }, update: { value: "0" } }),
    );
  });

  it("isCircuitBreakerTripped reflete o contador atual", async () => {
    dbMock.platformSetting.findUnique.mockResolvedValueOnce({ value: "5" });
    expect(await isCircuitBreakerTripped()).toBe(true);

    dbMock.platformSetting.findUnique.mockResolvedValueOnce({ value: "2" });
    expect(await isCircuitBreakerTripped()).toBe(false);

    dbMock.platformSetting.findUnique.mockResolvedValueOnce(null);
    expect(await isCircuitBreakerTripped()).toBe(false);
  });
});
