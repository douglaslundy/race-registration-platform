import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyOrderConfirmed: vi.fn() }));

import { POST } from "@/app/api/admin/registrations/[id]/resend-confirmation-email/route";
import { notifyOrderConfirmed } from "@/lib/notifications";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/admin/registrations/reg-1/resend-confirmation-email", {
    method: "POST",
  }) as any;
}

const registrationFixture = {
  id: "reg-1",
  status: "CONFIRMED",
  order: { id: "order-1" },
};

describe("POST /api/admin/registrations/[id]/resend-confirmation-email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não tem a permissão (inclusive organizador titular)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a inscrição não existe", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(404);
    expect(notifyOrderConfirmed).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a inscrição ainda não está confirmada", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ ...registrationFixture, status: "PENDING_PAYMENT" });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(notifyOrderConfirmed).not.toHaveBeenCalled();
  });

  it("chama notifyOrderConfirmed e grava auditoria, sem filtrar por organizador", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-1" } }),
    );
    expect(notifyOrderConfirmed).toHaveBeenCalledWith("order-1");
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "admin-1",
        action: "CONFIRMATION_EMAIL_RESENT",
        entityType: "Registration",
        entityId: "reg-1",
      }),
    });
  });

  it("assistente de admin com a permissão reenvia o e-mail (bypass também vale pra ele)", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
  });

  it("assistente de organizador é barrado com 403 mesmo com a chave -any concedida por engano", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
});
