import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { decideRegistrationCancellation } from "@/lib/registrations/cancellation-decision-service";
import { POST } from "@/app/api/organizer/registrations/[id]/cancellation-decision/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/registrations/cancellation-decision-service", () => ({
  decideRegistrationCancellation: vi.fn(),
}));

const authMock = vi.mocked(auth);
const decideMock = vi.mocked(decideRegistrationCancellation);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/registrations/reg-1/cancellation-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/organizer/registrations/[id]/cancellation-decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
  });

  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("retorna 400 para um corpo com decision inválida", async () => {
    const res = await POST(makeRequest({ decision: "MAYBE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("escopa a decisão às inscrições de eventos do organizador logado", async () => {
    decideMock.mockResolvedValueOnce({ ok: true, refund: "processed" });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, refund: "processed" });
    expect(decideMock).toHaveBeenCalledWith({
      where: { id: "reg-1", event: { organizer: { userId: "organizer-1" } } },
      decision: "APPROVE",
      actingUserId: "organizer-1",
    });
  });

  it("repassa erro e status quando o serviço falha", async () => {
    decideMock.mockResolvedValueOnce({ ok: false, status: 404, error: "Inscrição não encontrada" });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Inscrição não encontrada");
  });
});
