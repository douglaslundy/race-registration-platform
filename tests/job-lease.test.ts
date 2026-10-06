import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { acquireJobLease, releaseJobLease } from "@/lib/job-lease";

const dbMock = db as any;

describe("job lease", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.jobLease.updateMany.mockResolvedValue({ count: 1 });
  });

  it("adquire reassumindo um lease expirado", async () => {
    await expect(acquireJobLease("k", 1000)).resolves.toBe(true);
    expect(dbMock.jobLease.updateMany).toHaveBeenCalledWith({
      where: { key: "k", lockedUntil: { lt: expect.any(Date) } },
      data: { lockedUntil: expect.any(Date) },
    });
    expect(dbMock.jobLease.create).not.toHaveBeenCalled();
  });

  it("cria a linha na primeira execução", async () => {
    dbMock.jobLease.updateMany.mockResolvedValueOnce({ count: 0 });
    dbMock.jobLease.create.mockResolvedValueOnce({});
    await expect(acquireJobLease("k", 1000)).resolves.toBe(true);
  });

  it("recusa quando outra execução ainda detém o lease (P2002)", async () => {
    dbMock.jobLease.updateMany.mockResolvedValueOnce({ count: 0 });
    dbMock.jobLease.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }),
    );
    await expect(acquireJobLease("k", 1000)).resolves.toBe(false);
  });

  it("propaga erros inesperados", async () => {
    dbMock.jobLease.updateMany.mockResolvedValueOnce({ count: 0 });
    dbMock.jobLease.create.mockRejectedValueOnce(new Error("conexão caiu"));
    await expect(acquireJobLease("k", 1000)).rejects.toThrow("conexão caiu");
  });

  it("release expira o lease e nunca lança", async () => {
    dbMock.jobLease.updateMany.mockRejectedValueOnce(new Error("x"));
    await expect(releaseJobLease("k")).resolves.toBeUndefined();
  });
});
