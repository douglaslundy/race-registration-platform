import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/events/export/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("admin events export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("exports filtered events as csv", async () => {
    dbMock.event.findMany.mockResolvedValueOnce([
      {
        title: "Corrida das Pedras",
        slug: "corrida-das-pedras",
        status: "PUBLISHED",
        modality: "ROAD_RACE",
        city: "São Paulo",
        state: "SP",
        startAt: new Date("2026-03-01T10:00:00.000Z"),
        _count: { registrations: 42 },
        organizer: { user: { name: "Organizador Um", email: "org@exemplo.com" } },
        orders: [{ totalAmount: 50000 }],
      },
    ]);

    const res = await GET(
      new Request("http://localhost/api/admin/events/export?status=PUBLISHED&q=corrida&sort=title&dir=asc", { method: "GET" }) as any,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("eventos.csv");
    expect(dbMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ AND: expect.any(Array) }),
        orderBy: expect.arrayContaining([expect.objectContaining({ title: "asc" })]),
      }),
    );

    const csv = await res.text();
    expect(csv).toContain('"Corrida das Pedras"');
    expect(csv).toContain('"Organizador Um"');
    expect(csv).toContain('"PUBLISHED"');
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);

    const res = await GET(new Request("http://localhost/api/admin/events/export", { method: "GET" }) as any);

    expect(res.status).toBe(401);
  });

  it("ASSISTANT com events.view concedido consegue exportar", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.event.findMany.mockResolvedValueOnce([]);

    const res = await GET(new Request("http://localhost/api/admin/events/export", { method: "GET" }) as any);

    expect(dbMock.assistantPermission.findUnique).toHaveBeenCalledWith({
      where: { userId_actionKey: { userId: "assistant-1", actionKey: "events.view" } },
    });
    expect(res.status).toBe(200);
  });

  it("ASSISTANT sem events.view é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost/api/admin/events/export", { method: "GET" }) as any);

    expect(res.status).toBe(403);
    expect(dbMock.event.findMany).not.toHaveBeenCalled();
  });
});
