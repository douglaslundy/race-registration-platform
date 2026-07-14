import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { DELETE } from "@/app/api/daily-summary-recipients/[id]/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/daily-summary-recipients/r1", { method: "DELETE" }) as any;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/daily-summary-recipients/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await DELETE(makeRequest(), makeContext("r1"));
    expect(res.status).toBe(401);
    expect(dbMock.dailySummaryRecipient.delete).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o destinatário não existe ou não pertence ao usuário", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.dailySummaryRecipient.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(makeRequest(), makeContext("r1"));

    expect(dbMock.dailySummaryRecipient.findFirst).toHaveBeenCalledWith({ where: { id: "r1", userId: "admin-1" } });
    expect(res.status).toBe(404);
    expect(dbMock.dailySummaryRecipient.delete).not.toHaveBeenCalled();
  });

  it("remove o destinatário quando pertence ao usuário autenticado", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.dailySummaryRecipient.findFirst.mockResolvedValueOnce({ id: "r1", userId: "admin-1" });

    const res = await DELETE(makeRequest(), makeContext("r1"));
    const body = await res.json();

    expect(dbMock.dailySummaryRecipient.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
    expect(body).toEqual({ success: true });
  });
});
