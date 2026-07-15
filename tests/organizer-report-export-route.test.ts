import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET } from "@/app/api/organizer/report/export/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/organizer/report/export?de=2026-01-01&ate=2026-01-31") as any;
}

function mockAggregates() {
  dbMock.payment.aggregate
    .mockResolvedValueOnce({ _sum: { amount: 10000, gatewayFeeAmount: 100 }, _count: { id: 1 } })
    .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { id: 0 } })
    .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { id: 0 } });
  dbMock.order.aggregate.mockResolvedValueOnce({
    _sum: { platformFeeAmount: 1000, paymentFeeAmount: 200, subtotalAmount: 10000 },
  });
  dbMock.transferPayout.aggregate.mockResolvedValueOnce({ _sum: { netAmount: 8800 } });
}

describe("GET /api/organizer/report/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(dbMock.payment.aggregate).not.toHaveBeenCalled();
  });

  it("retorna 403 pra quem não tem a permissão nem é titular", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    expect(dbMock.payment.aggregate).not.toHaveBeenCalled();
  });

  it("organizador titular exporta o relatório escopado ao próprio perfil", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    mockAggregates();

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("relatorio-financeiro-organizador.csv");
  });

  it("admin titular recebe 404 (sem acesso funcional, como hoje — não tem perfil de organizador)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await GET(makeRequest());

    expect(res.status).toBe(404);
    expect(dbMock.payment.aggregate).not.toHaveBeenCalled();
  });

  it("assistente de organizador com a permissão exporta com o organizerId do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    mockAggregates();

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
  });
});
