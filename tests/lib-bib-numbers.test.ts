import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    event: { findUnique: vi.fn() },
    kitDelivery: { count: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db }));

import { BibNumberError, generateBibNumbers } from "@/lib/bib-numbers";

describe("generateBibNumbers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.kitDelivery.count.mockResolvedValue(0);
    db.$transaction.mockResolvedValue([0, 3]);
  });

  it("recusa evento sem a opção de gerar número de peito", async () => {
    db.event.findUnique.mockResolvedValue({ generateBibNumbers: false, status: "REGISTRATIONS_CLOSED" });
    await expect(generateBibNumbers("e1")).rejects.toBeInstanceOf(BibNumberError);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("recusa enquanto as inscrições não estão encerradas", async () => {
    db.event.findUnique.mockResolvedValue({ generateBibNumbers: true, status: "REGISTRATIONS_OPEN" });
    await expect(generateBibNumbers("e1")).rejects.toThrow(/Encerre as inscrições/);
  });

  it("recusa renumerar depois de kits entregues", async () => {
    db.event.findUnique.mockResolvedValue({ generateBibNumbers: true, status: "COMPLETED" });
    db.kitDelivery.count.mockResolvedValue(2);
    await expect(generateBibNumbers("e1")).rejects.toThrow(/kits entregues/);
  });

  it("numera e devolve o total de confirmados", async () => {
    db.event.findUnique.mockResolvedValue({ generateBibNumbers: true, status: "REGISTRATIONS_CLOSED" });
    await expect(generateBibNumbers("e1")).resolves.toEqual({ total: 3 });
    expect(db.$transaction).toHaveBeenCalledOnce();
  });
});
