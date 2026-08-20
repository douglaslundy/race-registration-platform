import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { PATCH } from "@/app/api/me/preferences/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const dbMock = db as any;
const authMock = vi.mocked(auth);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/me/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("PATCH /api/me/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ATHLETE" } } as any);
  });

  it("retorna 403 quando não autenticado", async () => {
    authMock.mockResolvedValueOnce(null as any);

    const res = await PATCH(makeRequest({ uiDensity: "compact" }));

    expect(res.status).toBe(403);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("atualiza só uiDensity quando é o único campo enviado (comportamento existente preservado)", async () => {
    const res = await PATCH(makeRequest({ uiDensity: "compact" }));

    expect(res.status).toBe(200);
    const callArgs = dbMock.user.update.mock.calls[0][0];
    expect(callArgs.where).toEqual({ id: "user-1" });
    expect(callArgs.data).toStrictEqual({ uiDensity: "compact" });
    expect(Object.keys(callArgs.data)).toEqual(["uiDensity"]);
  });

  it("atualiza receiveEventMessages isoladamente", async () => {
    const res = await PATCH(makeRequest({ receiveEventMessages: false }));

    expect(res.status).toBe(200);
    const callArgs = dbMock.user.update.mock.calls[0][0];
    expect(callArgs.where).toEqual({ id: "user-1" });
    expect(callArgs.data).toStrictEqual({ receiveEventMessages: false });
    expect(Object.keys(callArgs.data)).toEqual(["receiveEventMessages"]);
  });

  it("atualiza receivePromotionalMessages isoladamente", async () => {
    const res = await PATCH(makeRequest({ receivePromotionalMessages: false }));

    expect(res.status).toBe(200);
    const callArgs = dbMock.user.update.mock.calls[0][0];
    expect(callArgs.where).toEqual({ id: "user-1" });
    expect(callArgs.data).toStrictEqual({ receivePromotionalMessages: false });
    expect(Object.keys(callArgs.data)).toEqual(["receivePromotionalMessages"]);
  });

  it("aceita os três campos juntos", async () => {
    const res = await PATCH(
      makeRequest({ uiDensity: "compact", receiveEventMessages: true, receivePromotionalMessages: false }),
    );

    expect(res.status).toBe(200);
    const callArgs = dbMock.user.update.mock.calls[0][0];
    expect(callArgs.where).toEqual({ id: "user-1" });
    expect(callArgs.data).toStrictEqual({
      uiDensity: "compact",
      receiveEventMessages: true,
      receivePromotionalMessages: false,
    });
    expect(Object.keys(callArgs.data).sort()).toEqual(
      ["uiDensity", "receiveEventMessages", "receivePromotionalMessages"].sort(),
    );
  });

  it("retorna 400 quando nenhum campo é enviado", async () => {
    const res = await PATCH(makeRequest({}));

    expect(res.status).toBe(400);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("retorna 400 quando um campo não é do tipo esperado", async () => {
    const res = await PATCH(makeRequest({ receiveEventMessages: "sim" }));

    expect(res.status).toBe(400);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });
});
