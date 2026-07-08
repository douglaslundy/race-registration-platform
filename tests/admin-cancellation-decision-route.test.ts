import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { decideRegistrationCancellation } from "@/lib/registrations/cancellation-decision-service";
import { POST } from "@/app/api/admin/registrations/[id]/cancellation-decision/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/registrations/cancellation-decision-service", () => ({
  decideRegistrationCancellation: vi.fn(),
}));

const authMock = vi.mocked(auth);
const decideMock = vi.mocked(decideRegistrationCancellation);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/registrations/reg-1/cancellation-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/registrations/[id]/cancellation-decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("não restringe por dono do evento (admin vê qualquer inscrição)", async () => {
    decideMock.mockResolvedValueOnce({ ok: true, refund: "not_applicable" });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, refund: "not_applicable" });
    expect(decideMock).toHaveBeenCalledWith({ where: { id: "reg-1" }, decision: "APPROVE", actingUserId: "admin-1" });
  });
});
