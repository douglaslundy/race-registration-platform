import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/organizer/events/export/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("organizer events export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.event.findMany.mockResolvedValue([]);
  });

  it("ORGANIZER titular exporta os próprios eventos", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1", userId: "user-1" });

    const res = await GET();

    expect(dbMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizerId: "org-1" } }),
    );
    expect(res.status).toBe(200);
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it("retorna 404 quando não há perfil de organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(404);
    expect(dbMock.event.findMany).not.toHaveBeenCalled();
  });

  it("ASSISTANT criado por organizador com events.view exporta os eventos do organizerId do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({
      createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } },
    });

    const res = await GET();

    expect(dbMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizerId: "org-1" } }),
    );
    expect(res.status).toBe(200);
  });

  it("ASSISTANT órfão (sem organizerId resolvido) recebe 404", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-3", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: null });

    const res = await GET();

    expect(res.status).toBe(404);
    expect(dbMock.event.findMany).not.toHaveBeenCalled();
  });

  it("ASSISTANT sem events.view é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(403);
    expect(dbMock.event.findMany).not.toHaveBeenCalled();
  });
});
