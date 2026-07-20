import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, POST } from "@/app/api/admin/ads/plans/route";
import { PATCH } from "@/app/api/admin/ads/plans/[id]/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as any;
}

const validPlanPayload = {
  name: "Plano Ouro",
  priceAmount: 50000,
  durationDays: 30,
  maxSimultaneousSlots: 3,
};

describe("GET /api/admin/ads/plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(dbMock.adPlan.findMany).not.toHaveBeenCalled();
  });

  it("lista todos os planos, incluindo inativos", async () => {
    dbMock.adPlan.findMany.mockResolvedValue([{ id: "plan-1", active: false }]);
    const res = await GET();
    expect(dbMock.adPlan.findMany).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/ads/plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest("http://localhost/api/admin/ads/plans", "POST", validPlanPayload));
    expect(res.status).toBe(403);
    expect(dbMock.adPlan.create).not.toHaveBeenCalled();
  });

  it.each([
    ["name", { ...validPlanPayload, name: "" }],
    ["priceAmount ausente", { ...validPlanPayload, priceAmount: undefined }],
    ["priceAmount negativo", { ...validPlanPayload, priceAmount: -1 }],
    ["priceAmount zero", { ...validPlanPayload, priceAmount: 0 }],
    ["durationDays negativo", { ...validPlanPayload, durationDays: -5 }],
    ["maxSimultaneousSlots negativo", { ...validPlanPayload, maxSimultaneousSlots: -1 }],
    ["priceAmount não inteiro", { ...validPlanPayload, priceAmount: 10.5 }],
  ])("retorna 400 quando %s é inválido", async (_label, payload) => {
    const res = await POST(makeRequest("http://localhost/api/admin/ads/plans", "POST", payload));
    expect(res.status).toBe(400);
    expect(dbMock.adPlan.create).not.toHaveBeenCalled();
  });

  it("cria o plano com active: true e retorna 201", async () => {
    dbMock.adPlan.create.mockResolvedValue({ id: "plan-1", ...validPlanPayload, active: true });
    const res = await POST(makeRequest("http://localhost/api/admin/ads/plans", "POST", validPlanPayload));
    expect(dbMock.adPlan.create).toHaveBeenCalledWith({
      data: { ...validPlanPayload, active: true },
    });
    expect(res.status).toBe(201);
  });
});

describe("PATCH /api/admin/ads/plans/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await PATCH(
      makeRequest("http://localhost/api/admin/ads/plans/plan-1", "PATCH", { active: false }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );
    expect(res.status).toBe(403);
    expect(dbMock.adPlan.update).not.toHaveBeenCalled();
  });

  it("retorna 400 com payload inválido (priceAmount negativo)", async () => {
    const res = await PATCH(
      makeRequest("http://localhost/api/admin/ads/plans/plan-1", "PATCH", { priceAmount: -10 }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );
    expect(res.status).toBe(400);
    expect(dbMock.adPlan.update).not.toHaveBeenCalled();
  });

  it("aceita payload parcial e repassa parsed.data direto pro update, sem reconstrução", async () => {
    dbMock.adPlan.update.mockResolvedValue({ id: "plan-1", active: false });
    const res = await PATCH(
      makeRequest("http://localhost/api/admin/ads/plans/plan-1", "PATCH", { active: false }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );
    expect(dbMock.adPlan.update).toHaveBeenCalledWith({
      where: { id: "plan-1" },
      data: { active: false },
    });
    expect(res.status).toBe(200);
  });

  it("aceita múltiplos campos parciais simultaneamente", async () => {
    dbMock.adPlan.update.mockResolvedValue({ id: "plan-1" });
    const res = await PATCH(
      makeRequest("http://localhost/api/admin/ads/plans/plan-1", "PATCH", {
        name: "Plano Prata",
        priceAmount: 20000,
      }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );
    expect(dbMock.adPlan.update).toHaveBeenCalledWith({
      where: { id: "plan-1" },
      data: { name: "Plano Prata", priceAmount: 20000 },
    });
    expect(res.status).toBe(200);
  });
});
