import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listOptedOutAthletes } from "@/lib/campaigns/opted-out";

const dbMock = db as any;

describe("listOptedOutAthletes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.user.count.mockResolvedValue(0);
    dbMock.user.findMany.mockResolvedValue([]);
  });

  it("filtra por role ATHLETE e receivePromotionalMessages false", async () => {
    await listOptedOutAthletes({});

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: "ATHLETE", active: true, receivePromotionalMessages: false },
      }),
    );
  });

  it("aplica busca por nome/e-mail/telefone quando q é informado", async () => {
    await listOptedOutAthletes({ q: "joão" });

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { name: { contains: "joão", mode: "insensitive" } },
            { email: { contains: "joão", mode: "insensitive" } },
            { athleteProfile: { phone: { contains: "joão", mode: "insensitive" } } },
          ],
        }),
      }),
    );
  });

  it("pagina corretamente (page 2, pageSize 20)", async () => {
    dbMock.user.count.mockResolvedValueOnce(45);
    dbMock.user.findMany.mockResolvedValueOnce([]);

    const result = await listOptedOutAthletes({ page: 2 });

    expect(dbMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(2);
  });

  it("mapeia phone a partir de athleteProfile", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "u1", name: "João", email: "joao@example.com", athleteProfile: { phone: "5511999999999" } },
    ]);

    const result = await listOptedOutAthletes({});

    expect(result.rows).toEqual([{ id: "u1", name: "João", email: "joao@example.com", phone: "5511999999999" }]);
  });
});
