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
});
