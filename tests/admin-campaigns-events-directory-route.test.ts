import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET as EVENTS_DIRECTORY } from "@/app/api/admin/campaigns/events-directory/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(url: string) {
  return new Request(url) as any;
}

describe("GET /api/admin/campaigns/events-directory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.count.mockResolvedValue(0);
  });

  it("lista eventos paginados", async () => {
    dbMock.event.findMany.mockResolvedValueOnce([{ id: "event-1", title: "Corrida Exemplo" }]);
    dbMock.event.count.mockResolvedValueOnce(1);

    const res = await EVENTS_DIRECTORY(makeRequest("http://localhost/api/admin/campaigns/events-directory"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.rows).toEqual([{ id: "event-1", title: "Corrida Exemplo" }]);
    expect(data.total).toBe(1);
  });

  it("filtra por busca (título) quando q é informado", async () => {
    dbMock.event.findMany.mockResolvedValueOnce([]);

    await EVENTS_DIRECTORY(makeRequest("http://localhost/api/admin/campaigns/events-directory?q=corrida"));

    expect(dbMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { title: { contains: "corrida", mode: "insensitive" } },
      }),
    );
  });

  it("rejeita ORGANIZER", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await EVENTS_DIRECTORY(makeRequest("http://localhost/api/admin/campaigns/events-directory"));

    expect(res.status).toBe(403);
    expect(dbMock.event.findMany).not.toHaveBeenCalled();
  });
});
