import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyOrderConfirmed: vi.fn() }));

import { POST } from "@/app/api/organizer/registrations/[id]/resend-confirmation-email/route";
import { notifyOrderConfirmed } from "@/lib/notifications";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/organizer/registrations/reg-1/resend-confirmation-email", {
    method: "POST",
  }) as any;
}

const registrationFixture = {
  id: "reg-1",
  status: "CONFIRMED",
  order: { id: "order-1" },
};

describe("POST /api/organizer/registrations/[id]/resend-confirmation-email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "org-1" });
  });

  it("retorna 403 para quem não tem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a inscrição não pertence a um evento deste organizador", async () => {
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

  it("chama notifyOrderConfirmed e grava auditoria", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reg-1", event: { organizerId: "org-1" } },
      }),
    );
    expect(notifyOrderConfirmed).toHaveBeenCalledWith("order-1", { bypassDedupe: true });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "organizer-1",
        action: "CONFIRMATION_EMAIL_RESENT",
        entityType: "Registration",
        entityId: "reg-1",
      }),
    });
  });

  it("assistente de organizador com a permissão reenvia o e-mail escopado ao evento do criador", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
});
