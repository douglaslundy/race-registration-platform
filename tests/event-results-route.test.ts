import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST, PATCH } from "@/app/api/events/[id]/results/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeImportRequest(csvText: string) {
  const formData = new FormData();
  formData.append("file", new File([csvText], "results.csv", { type: "text/csv" }));
  return new Request("http://localhost/api/events/event-1/results", {
    method: "POST",
    body: formData,
  }) as any;
}

function makeEmptyImportRequest() {
  return new Request("http://localhost/api/events/event-1/results", {
    method: "POST",
    body: new FormData(),
  }) as any;
}

function makePublishRequest(importId: string) {
  return new Request("http://localhost/api/events/event-1/results", {
    method: "PATCH",
    body: JSON.stringify({ importId }),
    headers: { "Content-Type": "application/json" },
  }) as any;
}

const ctx = { params: Promise.resolve({ id: "event-1" }) };

describe("event results import/publish api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "org-1", userId: "user-1" });
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1", organizerId: "org-1" });
    dbMock.resultImport.create.mockResolvedValue({ id: "import-1" });
    dbMock.raceResult.createMany.mockResolvedValue({ count: 1 });
    dbMock.auditLog.create.mockResolvedValue({ id: "log-1" });
    dbMock.resultImport.update.mockResolvedValue({ id: "import-1", published: true });
  });

  describe("POST (import)", () => {
    it("rejects when there is no session", async () => {
      authMock.mockResolvedValueOnce(null as any);
      const res = await POST(makeImportRequest("bib_number,athlete_name\n1,Ana\n"), ctx);
      expect(res.status).toBe(401);
    });

    it("rejects when the caller role is not organizer or admin", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "user-1", role: "ATHLETE" } } as any);
      const res = await POST(makeImportRequest("bib_number,athlete_name\n1,Ana\n"), ctx);
      expect(res.status).toBe(403);
    });

    it("rejects when no file is sent", async () => {
      const res = await POST(makeEmptyImportRequest(), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/não enviado/i);
    });

    it("rejects an empty CSV", async () => {
      const res = await POST(makeImportRequest("bib_number,athlete_name\n"), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/vazio/i);
    });

    it("rejects a CSV missing a required column", async () => {
      const res = await POST(makeImportRequest("bib_number,route\n1,10km\n"), ctx);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/obrigatórias/i);
      expect(data.error).toMatch(/athlete_name/);
    });

    it("returns 404 when the event does not exist or is outside the organizer's scope", async () => {
      dbMock.event.findFirst.mockResolvedValueOnce(null);
      const res = await POST(makeImportRequest("bib_number,athlete_name\n1,Ana\n"), ctx);
      expect(res.status).toBe(404);
    });

    it("parses athlete names containing a quoted comma correctly", async () => {
      const csv = 'bib_number,athlete_name,route\n101,"Silva, João",10km\n';
      const res = await POST(makeImportRequest(csv), ctx);

      expect(res.status).toBe(200);
      expect(dbMock.raceResult.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            bibNumber: "101",
            athleteName: "Silva, João",
            route: "10km",
          }),
        ],
      });
    });

    it("creates a ResultImport, RaceResult rows, and an audit log entry on success", async () => {
      const csv =
        "bib_number,athlete_name,route,category,gender,gross_time,net_time,placement_general,placement_category,placement_gender\n" +
        "101,Ana Silva,10km,Geral,F,00:45:00,00:44:30,1,1,1\n" +
        "102,Bruno Costa,10km,Geral,M,00:46:00,00:45:10,2,1,1\n";

      const res = await POST(makeImportRequest(csv), ctx);

      expect(res.status).toBe(200);
      expect(dbMock.resultImport.create).toHaveBeenCalledWith({
        data: {
          eventId: "event-1",
          importedBy: "user-1",
          fileName: "results.csv",
          rowCount: 2,
        },
      });
      expect(dbMock.raceResult.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            importId: "import-1",
            eventId: "event-1",
            bibNumber: "101",
            athleteName: "Ana Silva",
            route: "10km",
            category: "Geral",
            gender: "F",
            grossTime: "00:45:00",
            netTime: "00:44:30",
            placementGeneral: 1,
            placementCategory: 1,
            placementGender: 1,
          }),
          expect.objectContaining({
            bibNumber: "102",
            athleteName: "Bruno Costa",
            placementGeneral: 2,
          }),
        ],
      });
      expect(dbMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          action: "RESULTS_IMPORTED",
          entityType: "ResultImport",
          entityId: "import-1",
          metadata: { rowCount: 2, fileName: "results.csv" },
        }),
      });

      const data = await res.json();
      expect(data).toEqual({ importId: "import-1", rowCount: 2 });
    });

    it("admin titular importa em qualquer evento (bypass)", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1", organizerId: "org-99" });

      const res = await POST(makeImportRequest("bib_number,athlete_name\n1,Ana\n"), ctx);

      expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "event-1" } });
      expect(res.status).toBe(200);
    });

    it("assistente de organizador com a permissão importa no evento do criador", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
      dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
      dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

      const res = await POST(makeImportRequest("bib_number,athlete_name\n1,Ana\n"), ctx);

      expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "event-1", organizerId: "org-1" } });
      expect(res.status).toBe(200);
    });

    it("assistente sem a permissão é barrado com 403", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
      dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

      const res = await POST(makeImportRequest("bib_number,athlete_name\n1,Ana\n"), ctx);

      expect(res.status).toBe(403);
      expect(dbMock.resultImport.create).not.toHaveBeenCalled();
    });
  });

  describe("PATCH (publish)", () => {
    it("rejects when there is no session or an invalid role", async () => {
      authMock.mockResolvedValueOnce(null as any);
      const res = await PATCH(makePublishRequest("import-1"), ctx);
      expect(res.status).toBe(401);
    });

    it("marks the import as published", async () => {
      const res = await PATCH(makePublishRequest("import-1"), ctx);

      expect(res.status).toBe(200);
      expect(dbMock.resultImport.update).toHaveBeenCalledWith({
        where: { id: "import-1", eventId: "event-1" },
        data: { published: true, publishedAt: expect.any(Date) },
      });
      expect(await res.json()).toEqual({ ok: true });
    });

    it("organizador titular recebe 404 ao tentar publicar import de evento de outro organizador (fix de posse)", async () => {
      dbMock.event.findFirst.mockResolvedValueOnce(null);

      const res = await PATCH(makePublishRequest("import-1"), ctx);

      expect(res.status).toBe(404);
      expect(dbMock.resultImport.update).not.toHaveBeenCalled();
    });

    it("admin titular publica em qualquer evento (bypass)", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1", organizerId: "org-99" });

      const res = await PATCH(makePublishRequest("import-1"), ctx);

      expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "event-1" } });
      expect(res.status).toBe(200);
    });

    it("assistente de organizador com a permissão publica no evento do criador", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
      dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
      dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

      const res = await PATCH(makePublishRequest("import-1"), ctx);

      expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "event-1", organizerId: "org-1" } });
      expect(res.status).toBe(200);
    });

    it("assistente sem a permissão é barrado com 403", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
      dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

      const res = await PATCH(makePublishRequest("import-1"), ctx);

      expect(res.status).toBe(403);
      expect(dbMock.resultImport.update).not.toHaveBeenCalled();
    });
  });
});
