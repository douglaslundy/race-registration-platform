import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/events/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("event create api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({
      id: "org-1",
      userId: "user-1",
    });
    dbMock.event.create.mockResolvedValue({ id: "event-1" });
    dbMock.auditLog.create.mockResolvedValue({ id: "log-1" });
  });

  it("stores unlimited capacity when maxParticipants is 0", async () => {
    const res = await POST(
      new Request("http://localhost/api/events", {
        method: "POST",
        body: JSON.stringify({
          title: "Corrida da Serra",
          modality: "ROAD_RACE",
          startAt: "2026-06-20T10:00:00.000Z",
          city: "São Paulo",
          state: "SP",
          maxParticipants: 0,
        }),
        headers: { "Content-Type": "application/json" },
      }) as any,
    );

    expect(res.status).toBe(201);
    expect(dbMock.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          maxParticipants: null,
        }),
      }),
    );
  });

  it("retorna 403 sem sessão autenticada com role permitida", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);

    const res = await POST(
      new Request("http://localhost/api/events", {
        method: "POST",
        body: JSON.stringify({
          title: "Corrida da Serra",
          modality: "ROAD_RACE",
          startAt: "2026-06-20T10:00:00.000Z",
          city: "São Paulo",
          state: "SP",
        }),
        headers: { "Content-Type": "application/json" },
      }) as any,
    );

    expect(res.status).toBe(403);
    expect(dbMock.event.create).not.toHaveBeenCalled();
  });

  it("ASSISTANT criado por organizador com events.create consegue criar, escopado ao organizerId do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({
      createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-9" } },
    });
    dbMock.event.create.mockResolvedValueOnce({ id: "event-2" });

    const res = await POST(
      new Request("http://localhost/api/events", {
        method: "POST",
        body: JSON.stringify({
          title: "Corrida da Serra",
          modality: "ROAD_RACE",
          startAt: "2026-06-20T10:00:00.000Z",
          city: "São Paulo",
          state: "SP",
        }),
        headers: { "Content-Type": "application/json" },
      }) as any,
    );

    expect(res.status).toBe(201);
    expect(dbMock.event.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizerId: "org-9" }) }),
    );
  });

  it("ASSISTANT sem events.create é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await POST(
      new Request("http://localhost/api/events", {
        method: "POST",
        body: JSON.stringify({
          title: "Corrida da Serra",
          modality: "ROAD_RACE",
          startAt: "2026-06-20T10:00:00.000Z",
          city: "São Paulo",
          state: "SP",
        }),
        headers: { "Content-Type": "application/json" },
      }) as any,
    );

    expect(res.status).toBe(403);
    expect(dbMock.event.create).not.toHaveBeenCalled();
  });

  it("ADMIN titular continua recebendo 404 (sem OrganizerProfile próprio)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await POST(
      new Request("http://localhost/api/events", {
        method: "POST",
        body: JSON.stringify({
          title: "Corrida da Serra",
          modality: "ROAD_RACE",
          startAt: "2026-06-20T10:00:00.000Z",
          city: "São Paulo",
          state: "SP",
        }),
        headers: { "Content-Type": "application/json" },
      }) as any,
    );

    expect(res.status).toBe(404);
    expect(dbMock.event.create).not.toHaveBeenCalled();
  });
});
