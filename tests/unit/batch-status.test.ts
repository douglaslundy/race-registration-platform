import { describe, expect, it } from "vitest";
import { getBatchStatus, getEventDisplayStatus, isBatchAvailable, type BatchForStatus } from "@/lib/batch-status";

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

describe("getEventDisplayStatus", () => {
  // Bug corrigido: com status="REGISTRATIONS_OPEN" no banco mas todos os lotes esgotados, o card
  // mostrava "Inscrições abertas" (badge, direto de event.status) e "Inscrições fechadas"/"Esgotado"
  // (botão, calculado dos lotes) ao mesmo tempo — as duas mensagens contraditórias juntas. Badge e
  // botão devem sempre ler o MESMO valor (o retorno desta função), nunca event.status cru.

  it("mantém REGISTRATIONS_OPEN quando existe lote ACTIVE", () => {
    const active = makeBatch({ activationMode: "MANUAL", active: true });
    expect(getEventDisplayStatus("REGISTRATIONS_OPEN", [active])).toBe("REGISTRATIONS_OPEN");
  });

  it("reinterpreta REGISTRATIONS_OPEN como SOLD_OUT quando todos os lotes estão esgotados (o bug relatado)", () => {
    const soldOut = makeBatch({ soldCount: 100, capacity: 100 });
    expect(getEventDisplayStatus("REGISTRATIONS_OPEN", [soldOut])).toBe("SOLD_OUT");
  });

  it("reinterpreta REGISTRATIONS_OPEN como SOLD_OUT com mistura de lotes esgotados e fechados por data (nenhum ACTIVE/UPCOMING)", () => {
    const soldOut = makeBatch({ id: "b1", soldCount: 100, capacity: 100 });
    const closedByDate = makeBatch({ id: "b2", endAt: new Date(now.getTime() - HOUR) });
    expect(getEventDisplayStatus("REGISTRATIONS_OPEN", [soldOut, closedByDate])).toBe("SOLD_OUT");
  });

  it("reinterpreta REGISTRATIONS_OPEN como PUBLISHED (Em breve) quando só há lote UPCOMING", () => {
    const upcoming = makeBatch({ startAt: new Date(now.getTime() + HOUR) });
    expect(getEventDisplayStatus("REGISTRATIONS_OPEN", [upcoming])).toBe("PUBLISHED");
  });

  it("reinterpreta REGISTRATIONS_OPEN como PUBLISHED (Em breve), não como fechado, quando o único lote está INACTIVE dentro da janela de datas", () => {
    const inactive = makeBatch({ activationMode: "MANUAL", active: false });
    expect(getEventDisplayStatus("REGISTRATIONS_OPEN", [inactive])).toBe("PUBLISHED");
  });

  it("reinterpreta REGISTRATIONS_OPEN como REGISTRATIONS_CLOSED quando os lotes só estão fechados por data, nunca esgotados", () => {
    const closedByDate = makeBatch({ endAt: new Date(now.getTime() - HOUR) });
    expect(getEventDisplayStatus("REGISTRATIONS_OPEN", [closedByDate])).toBe("REGISTRATIONS_CLOSED");
  });

  it("mantém REGISTRATIONS_OPEN quando o evento não tem nenhum lote cadastrado", () => {
    expect(getEventDisplayStatus("REGISTRATIONS_OPEN", [])).toBe("REGISTRATIONS_OPEN");
  });

  it("não mexe em status que não seja REGISTRATIONS_OPEN, mesmo com lotes esgotados", () => {
    const soldOut = makeBatch({ soldCount: 100, capacity: 100 });
    expect(getEventDisplayStatus("SOLD_OUT", [soldOut])).toBe("SOLD_OUT");
    expect(getEventDisplayStatus("REGISTRATIONS_CLOSED", [soldOut])).toBe("REGISTRATIONS_CLOSED");
    expect(getEventDisplayStatus("COMPLETED", [soldOut])).toBe("COMPLETED");
    expect(getEventDisplayStatus("DRAFT", [soldOut])).toBe("DRAFT");
    expect(getEventDisplayStatus("UNDER_REVIEW", [soldOut])).toBe("UNDER_REVIEW");
    expect(getEventDisplayStatus("PUBLISHED", [soldOut])).toBe("PUBLISHED");
    expect(getEventDisplayStatus("CANCELLED", [soldOut])).toBe("CANCELLED");
  });
});
