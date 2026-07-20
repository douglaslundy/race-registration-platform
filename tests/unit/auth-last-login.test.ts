import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { authConfig } from "@/lib/auth/config";

const dbMock = db as any;

describe("authConfig.events.signIn — atualiza lastLoginAt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("grava a data/hora atual em User.lastLoginAt no login", async () => {
    dbMock.user.update.mockResolvedValueOnce({});

    await authConfig.events!.signIn!({ user: { id: "user-1" } } as any);

    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { lastLoginAt: expect.any(Date) },
    });
  });

  it("não faz nada (e não lança) quando o user não tem id", async () => {
    await expect(authConfig.events!.signIn!({ user: {} } as any)).resolves.toBeUndefined();
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("nunca lança erro mesmo se a gravação falhar (best-effort, não pode travar o login)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMock.user.update.mockRejectedValueOnce(new Error("db down"));

    await expect(authConfig.events!.signIn!({ user: { id: "user-1" } } as any)).resolves.toBeUndefined();

    consoleSpy.mockRestore();
  });
});
