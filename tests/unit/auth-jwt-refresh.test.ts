import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { authConfig } from "@/lib/auth/config";

const dbMock = db as any;
const jwt = authConfig.callbacks!.jwt! as (args: any) => Promise<any>;
const sessionCb = authConfig.callbacks!.session! as (args: any) => Promise<any>;

describe("authConfig.callbacks.jwt — recarrega role/active do banco", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no login (com `user`) grava id/role e marca active=true, sem consultar o banco", async () => {
    const token = await jwt({
      token: {},
      user: { id: "u1", role: "ASSISTANT" },
    } as any);

    expect(token).toEqual(expect.objectContaining({ id: "u1", role: "ASSISTANT", active: true }));
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("em requests seguintes recarrega role e active do banco (assistente re-promovido volta a ter acesso)", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ role: "ASSISTANT", active: true });

    const token = await jwt({
      token: { id: "u1", role: "ATHLETE", active: true },
      user: undefined,
    } as any);

    expect(dbMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { role: true, active: true, passwordChangedAt: true },
    });
    expect(token).toEqual(expect.objectContaining({ id: "u1", role: "ASSISTANT", active: true }));
  });

  it("M9 — token emitido antes da troca de senha é invalidado (active=false)", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      role: "ATHLETE",
      active: true,
      passwordChangedAt: new Date("2026-08-31T12:00:00.000Z"),
    });

    const token = await jwt({
      token: { id: "u1", role: "ATHLETE", active: true, iat: Math.floor(new Date("2026-08-31T11:00:00.000Z").getTime() / 1000) },
    } as any);

    expect(token.active).toBe(false);
  });

  it("M9 — token emitido depois da troca de senha continua válido", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      role: "ATHLETE",
      active: true,
      passwordChangedAt: new Date("2026-08-31T12:00:00.000Z"),
    });

    const token = await jwt({
      token: { id: "u1", role: "ATHLETE", active: true, iat: Math.floor(new Date("2026-08-31T13:00:00.000Z").getTime() / 1000) },
    } as any);

    expect(token.active).toBe(true);
  });

  it("propaga o bloqueio: active=false do banco chega no token", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ role: "ASSISTANT", active: false });

    const token = await jwt({ token: { id: "u1", role: "ASSISTANT", active: true } } as any);
    expect(token.active).toBe(false);
  });

  it("usuário excluído (não encontrado): marca active=false", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);

    const token = await jwt({ token: { id: "u1", role: "ASSISTANT", active: true } } as any);
    expect(token.active).toBe(false);
  });

  it("blip no banco não desloga: mantém o token atual", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMock.user.findUnique.mockRejectedValueOnce(new Error("db down"));

    const token = await jwt({ token: { id: "u1", role: "ADMIN", active: true } } as any);
    expect(token).toEqual(expect.objectContaining({ role: "ADMIN", active: true }));
    consoleSpy.mockRestore();
  });

  it("session callback expõe active (default true quando ausente)", async () => {
    const s1 = await sessionCb({ session: { user: {} }, token: { id: "u1", role: "ADMIN" } } as any);
    expect(s1.user.active).toBe(true);
    const s2 = await sessionCb({ session: { user: {} }, token: { id: "u1", role: "ADMIN", active: false } } as any);
    expect(s2.user.active).toBe(false);
  });
});
