import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveRefundManually } from "@/lib/payment/manual-refund-resolution";
import { POST } from "@/app/api/organizer/refunds/[paymentId]/manual-resolve/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/manual-refund-resolution", () => ({ resolveRefundManually: vi.fn() }));

const authMock = vi.mocked(auth);
const dbMock = db as any;
const resolveMock = vi.mocked(resolveRefundManually);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/refunds/pay-1/manual-resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/organizer/refunds/[paymentId]/manual-resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
  });

  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);

    const res = await POST(makeRequest({ resolutionNote: "nota" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(403);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando resolutionNote está vazio", async () => {
    const res = await POST(makeRequest({ resolutionNote: "   " }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(400);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("escopa a resolução aos pagamentos de eventos do organizador logado", async () => {
    resolveMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest({ resolutionNote: "Estorno feito via PIX manual" }), {
      params: Promise.resolve({ paymentId: "pay-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(resolveMock).toHaveBeenCalledWith({
      where: { id: "pay-1", order: { event: { organizer: { userId: "org-1" } } } },
      resolvedByUserId: "org-1",
      resolutionNote: "Estorno feito via PIX manual",
    });
  });

  it("repassa erro e status quando o serviço falha", async () => {
    resolveMock.mockResolvedValueOnce({ ok: false, status: 404, error: "Pagamento não encontrado" });

    const res = await POST(makeRequest({ resolutionNote: "nota" }), { params: Promise.resolve({ paymentId: "pay-1" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Pagamento não encontrado");
  });

  it("assistente de organizador com a permissão resolve usando o userId do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdByUserId: "org-1" });
    resolveMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest({ resolutionNote: "resolvido" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(resolveMock).toHaveBeenCalledWith({
      where: { id: "pay-1", order: { event: { organizer: { userId: "org-1" } } } },
      resolvedByUserId: "assistant-1",
      resolutionNote: "resolvido",
    });
    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ resolutionNote: "nota" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(403);
    expect(resolveMock).not.toHaveBeenCalled();
  });
});
