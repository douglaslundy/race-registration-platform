import { describe, expect, it } from "vitest";
import { getBatchStatus, isBatchAvailable, type BatchForStatus } from "@/lib/batch-status";

const HOUR = 60 * 60 * 1000;
const now = new Date();

function makeBatch(overrides: Partial<BatchForStatus> = {}): BatchForStatus {
  return {
    id: "batch-1",
    soldCount: 0,
    capacity: 100,
    startAt: new Date(now.getTime() - HOUR),
    endAt: new Date(now.getTime() + HOUR),
    active: true,
    activationMode: "MANUAL",
    ...overrides,
  };
}

describe("getBatchStatus", () => {
  it("retorna SOLD_OUT quando soldCount >= capacity, mesmo dentro da janela de datas", () => {
    const batch = makeBatch({ soldCount: 100, capacity: 100 });
    expect(getBatchStatus(batch, [batch])).toBe("SOLD_OUT");
  });

  it("retorna CLOSED quando endAt já passou", () => {
    const batch = makeBatch({ endAt: new Date(now.getTime() - HOUR) });
    expect(getBatchStatus(batch, [batch])).toBe("CLOSED");
  });

  it("modo MANUAL: retorna UPCOMING quando startAt está no futuro, mesmo com active=true (bug corrigido)", () => {
    const batch = makeBatch({
      activationMode: "MANUAL",
      active: true,
      startAt: new Date(now.getTime() + HOUR),
    });
    expect(getBatchStatus(batch, [batch])).toBe("UPCOMING");
  });

  it("modo MANUAL: retorna ACTIVE quando startAt já passou e active=true", () => {
    const batch = makeBatch({ activationMode: "MANUAL", active: true });
    expect(getBatchStatus(batch, [batch])).toBe("ACTIVE");
  });

  it("modo MANUAL: retorna INACTIVE quando startAt já passou mas active=false", () => {
    const batch = makeBatch({ activationMode: "MANUAL", active: false });
    expect(getBatchStatus(batch, [batch])).toBe("INACTIVE");
  });

  it("modo DATE: retorna UPCOMING quando startAt está no futuro", () => {
    const batch = makeBatch({
      activationMode: "DATE",
      startAt: new Date(now.getTime() + HOUR),
    });
    expect(getBatchStatus(batch, [batch])).toBe("UPCOMING");
  });

  it("modo DATE: retorna ACTIVE quando startAt já passou", () => {
    const batch = makeBatch({ activationMode: "DATE" });
    expect(getBatchStatus(batch, [batch])).toBe("ACTIVE");
  });

  it("modo AFTER_PREVIOUS: primeiro lote (sem anterior) retorna UPCOMING quando o próprio startAt está no futuro", () => {
    const batch = makeBatch({
      activationMode: "AFTER_PREVIOUS",
      startAt: new Date(now.getTime() + HOUR),
    });
    expect(getBatchStatus(batch, [batch])).toBe("UPCOMING");
  });

  it("modo AFTER_PREVIOUS: primeiro lote retorna ACTIVE quando o próprio startAt já passou", () => {
    const batch = makeBatch({ id: "batch-1", activationMode: "AFTER_PREVIOUS" });
    expect(getBatchStatus(batch, [batch])).toBe("ACTIVE");
  });

  it("modo AFTER_PREVIOUS: segundo lote fica UPCOMING enquanto o anterior ainda está ACTIVE", () => {
    const prev = makeBatch({ id: "batch-1", startAt: new Date(now.getTime() - 2 * HOUR) });
    const next = makeBatch({
      id: "batch-2",
      activationMode: "AFTER_PREVIOUS",
      startAt: new Date(now.getTime() - HOUR),
    });
    expect(getBatchStatus(next, [prev, next])).toBe("UPCOMING");
  });

  it("modo AFTER_PREVIOUS: segundo lote fica ACTIVE quando o anterior está SOLD_OUT, mesmo se o próprio startAt já passou", () => {
    const prev = makeBatch({ id: "batch-1", startAt: new Date(now.getTime() - 2 * HOUR), soldCount: 100, capacity: 100 });
    const next = makeBatch({
      id: "batch-2",
      activationMode: "AFTER_PREVIOUS",
      startAt: new Date(now.getTime() - HOUR),
    });
    expect(getBatchStatus(next, [prev, next])).toBe("ACTIVE");
  });

  it("modo AFTER_PREVIOUS: segundo lote continua UPCOMING mesmo com o anterior esgotado, se o próprio startAt está no futuro", () => {
    const prev = makeBatch({ id: "batch-1", startAt: new Date(now.getTime() - 2 * HOUR), soldCount: 100, capacity: 100 });
    const next = makeBatch({
      id: "batch-2",
      activationMode: "AFTER_PREVIOUS",
      startAt: new Date(now.getTime() + HOUR),
    });
    expect(getBatchStatus(next, [prev, next])).toBe("UPCOMING");
  });
});

describe("isBatchAvailable", () => {
  it("retorna true somente quando o status é ACTIVE", () => {
    const active = makeBatch({ activationMode: "MANUAL", active: true });
    const upcoming = makeBatch({ startAt: new Date(now.getTime() + HOUR) });
    expect(isBatchAvailable(active, [active])).toBe(true);
    expect(isBatchAvailable(upcoming, [upcoming])).toBe(false);
  });
});
