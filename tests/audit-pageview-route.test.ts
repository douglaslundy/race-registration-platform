import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 59 })) };
});

import { POST } from "@/app/api/audit/pageview/route";
import { checkRateLimit } from "@/lib/rate-limit";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/audit/pageview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as any;
}

describe("POST /api/audit/pageview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await POST(makeRequest({ path: "/dashboard/inscricoes" }));
    expect(res.status).toBe(401);
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("retorna 400 com corpo inválido", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("L8 — sob rate-limit, responde 200 sem gravar AuditLog", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ATHLETE" } } as any);
    vi.mocked(checkRateLimit).mockReturnValueOnce({ allowed: false, remaining: 0 });

    const res = await POST(makeRequest({ path: "/x" }));

    expect(res.status).toBe(200);
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("grava o AuditLog com o caminho da página", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest({ path: "/dashboard/inscricoes" }));

    expect(res.status).toBe(200);
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "PAGE_VIEWED",
        entityType: "Page",
        entityId: "/dashboard/inscricoes",
        metadata: { path: "/dashboard/inscricoes" },
      },
    });
  });
});
