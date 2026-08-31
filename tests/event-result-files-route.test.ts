import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";

vi.mock("@/lib/auth/rbac", () => ({
  checkApiPermission: vi.fn(),
  resolveActingScope: vi.fn(),
}));

import { POST, PATCH } from "@/app/api/events/[id]/result-files/route";

const checkPermMock = vi.mocked(checkApiPermission);
const resolveScopeMock = vi.mocked(resolveActingScope);
const dbMock = db as any;
const ctx = { params: Promise.resolve({ id: "event-1" }) };

function makeReq(body: unknown, method = "POST") {
  return new Request("http://localhost/api/events/event-1/result-files", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/events/[id]/result-files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkPermMock.mockResolvedValue({ allowed: true, session: { user: { id: "u-1", role: "ORGANIZER" } } } as any);
    resolveScopeMock.mockResolvedValue({ actingAsAdmin: false, organizerId: "org-1" } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1", organizerId: "org-1" });
  });

  it("bloqueia sem permissão", async () => {
    checkPermMock.mockResolvedValueOnce({ allowed: false, response: new Response("no", { status: 403 }) } as any);
    const res = await POST(makeReq({ label: "Geral", fileUrl: "https://x/a.pdf", fileName: "a.pdf" }), ctx);
    expect(res.status).toBe(403);
    expect(dbMock.eventResultFile?.create).not.toHaveBeenCalled();
  });

  it("404 quando o evento é de outro organizador", async () => {
    dbMock.event.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ label: "Geral", fileUrl: "https://x/a.pdf", fileName: "a.pdf" }), ctx);
    expect(res.status).toBe(404);
  });

  it("400 com label vazio", async () => {
    const res = await POST(makeReq({ label: "  ", fileUrl: "https://x/a.pdf", fileName: "a.pdf" }), ctx);
    expect(res.status).toBe(400);
  });

  it("400 com fileUrl que não é URL", async () => {
    const res = await POST(makeReq({ label: "Geral", fileUrl: "não-url", fileName: "a.pdf" }), ctx);
    expect(res.status).toBe(400);
  });

  it("cria o registro com createdById da sessão → 201", async () => {
    dbMock.eventResultFile = { create: vi.fn().mockResolvedValue({ id: "rf-1", label: "Geral Masculino", fileUrl: "https://x/a.pdf", fileName: "a.pdf", createdAt: new Date("2026-08-31T12:00:00Z") }) };
    const res = await POST(makeReq({ label: "Geral Masculino", fileUrl: "https://x/a.pdf", fileName: "a.pdf" }), ctx);
    expect(res.status).toBe(201);
    expect(dbMock.eventResultFile.create).toHaveBeenCalledWith({
      data: { eventId: "event-1", label: "Geral Masculino", fileUrl: "https://x/a.pdf", fileName: "a.pdf", createdById: "u-1" },
    });
  });

  it("admin titular usa event.findUnique", async () => {
    resolveScopeMock.mockResolvedValueOnce({ actingAsAdmin: true, organizerId: null } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });
    dbMock.eventResultFile = { create: vi.fn().mockResolvedValue({ id: "rf-1", label: "x", fileUrl: "https://x/a.pdf", fileName: "a.pdf", createdAt: new Date() }) };
    const res = await POST(makeReq({ label: "x", fileUrl: "https://x/a.pdf", fileName: "a.pdf" }), ctx);
    expect(res.status).toBe(201);
    expect(dbMock.event.findUnique).toHaveBeenCalled();
  });
});

describe("PATCH /api/events/[id]/result-files (resultsSubtitle)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkPermMock.mockResolvedValue({ allowed: true, session: { user: { id: "u-1", role: "ORGANIZER" } } } as any);
    resolveScopeMock.mockResolvedValue({ actingAsAdmin: false, organizerId: "org-1" } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1", organizerId: "org-1" });
    dbMock.event.update = vi.fn().mockResolvedValue({});
  });

  it("grava o subtítulo trimado", async () => {
    const res = await PATCH(makeReq({ resultsSubtitle: "  5KM  " }, "PATCH"), ctx);
    expect(res.status).toBe(200);
    expect(dbMock.event.update).toHaveBeenCalledWith({ where: { id: "event-1" }, data: { resultsSubtitle: "5KM" } });
  });

  it("string vazia vira null", async () => {
    const res = await PATCH(makeReq({ resultsSubtitle: "   " }, "PATCH"), ctx);
    expect(res.status).toBe(200);
    expect(dbMock.event.update).toHaveBeenCalledWith({ where: { id: "event-1" }, data: { resultsSubtitle: null } });
  });

  it("bloqueia sem permissão", async () => {
    checkPermMock.mockResolvedValueOnce({ allowed: false, response: new Response("no", { status: 403 }) } as any);
    const res = await PATCH(makeReq({ resultsSubtitle: "5KM" }, "PATCH"), ctx);
    expect(res.status).toBe(403);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });
});
