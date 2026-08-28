import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveRefundManually } from "@/lib/payment/manual-refund-resolution";
import { POST } from "@/app/api/admin/refunds/[paymentId]/manual-resolve/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/manual-refund-resolution", () => ({ resolveRefundManually: vi.fn() }));

const authMock = vi.mocked(auth);
const dbMock = db as any;
const resolveMock = vi.mocked(resolveRefundManually);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/refunds/pay-1/manual-resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/refunds/[paymentId]/manual-resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);

    const res = await POST(makeRequest({ resolutionNote: "nota" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(403);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("não restringe por dono do evento (admin vê qualquer pagamento)", async () => {
    resolveMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest({ resolutionNote: "Estorno feito via PIX manual" }), {
      params: Promise.resolve({ paymentId: "pay-1" }),
    });

    expect(res.status).toBe(200);
    expect(resolveMock).toHaveBeenCalledWith({
      where: { id: "pay-1" },
      resolvedByUserId: "admin-1",
      resolutionNote: "Estorno feito via PIX manual",
    });
  });

  it("assistente de admin com a permissão resolve qualquer estorno", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    resolveMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest({ resolutionNote: "x" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST(makeRequest({ resolutionNote: "x" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(403);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ resolutionNote: "x" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(403);
  });
});
