import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { checkAnyApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { listKitDeliveries } from "@/lib/kit-delivery";
import { generateKitDeliveryListPdf } from "@/lib/kit-delivery/list-pdf";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({
  checkApiPermission: vi.fn(),
  checkAnyApiPermission: vi.fn(),
  resolveActingScope: vi.fn(),
}));
vi.mock("@/lib/kit-delivery", () => ({ listKitDeliveries: vi.fn() }));
vi.mock("@/lib/kit-delivery/list-pdf", () => ({ generateKitDeliveryListPdf: vi.fn() }));

import { GET } from "@/app/api/events/[id]/kit-deliveries/list/pdf/route";

const checkPermMock = vi.mocked(checkAnyApiPermission);
const resolveScopeMock = vi.mocked(resolveActingScope);
const dbMock = db as any;
const listMock = vi.mocked(listKitDeliveries);
const pdfMock = vi.mocked(generateKitDeliveryListPdf);

function makeRequest(qs = "") {
  return new Request(`http://localhost/api/events/event-1/kit-deliveries/list/pdf${qs}`) as any;
}
const ctx = { params: Promise.resolve({ id: "event-1" }) };

function item(overrides: Record<string, unknown>) {
  return {
    id: "reg",
    participantName: "Nome",
    participantCpf: null,
    bibNumber: null,
    shirtSize: null,
    categoryName: null,
    notes: null,
    delivered: false,
    deliveredAt: null,
    deliveredByName: null,
    receivedByName: null,
    receivedByDocument: null,
    ...overrides,
  };
}

describe("GET /api/events/[id]/kit-deliveries/list/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkPermMock.mockResolvedValue({
      allowed: true,
      session: { user: { id: "organizer-1", role: "ORGANIZER" } },
    } as any);
    resolveScopeMock.mockResolvedValue({ actingAsAdmin: false, organizerId: "organizer-1" } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1", title: "Corrida" });
    listMock.mockResolvedValue([
      item({ id: "a", participantName: "Ana", delivered: true, deliveredByName: "Carlos" }),
      item({ id: "b", participantName: "Bruno", delivered: false }),
    ]);
    pdfMock.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));
  });

  it("bloqueia sem permissão de kit", async () => {
    checkPermMock.mockResolvedValueOnce({
      allowed: false,
      response: new Response(JSON.stringify({ error: "Sem permissão" }), { status: 403 }),
    } as any);
    const res = await GET(makeRequest(), ctx);
    expect(res.status).toBe(403);
    expect(pdfMock).not.toHaveBeenCalled();
  });

  it("404 quando o evento não é do organizador", async () => {
    dbMock.event.findFirst.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), ctx);
    expect(res.status).toBe(404);
    expect(pdfMock).not.toHaveBeenCalled();
  });

  it("retorna PDF inline", async () => {
    const res = await GET(makeRequest(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("inline");
  });

  it("aplica filtro de assistente e status vindos da query antes de gerar o PDF", async () => {
    await GET(makeRequest("?status=delivered&assistant=Carlos"), ctx);
    const arg = pdfMock.mock.calls[0][0];
    expect(arg.items.map((i) => i.participantName)).toEqual(["Ana"]);
    expect(arg.deliveredCount).toBe(1);
    expect(arg.pendingCount).toBe(0);
    expect(arg.filtersLabel).toContain("Carlos");
  });

  it("ordena pendentes primeiro quando sort=pending-first", async () => {
    await GET(makeRequest("?sort=pending-first"), ctx);
    const arg = pdfMock.mock.calls[0][0];
    expect(arg.items.map((i) => i.participantName)).toEqual(["Bruno", "Ana"]);
  });

  it("admin titular usa event.findUnique", async () => {
    resolveScopeMock.mockResolvedValueOnce({ actingAsAdmin: true, organizerId: null } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1", title: "Corrida" });
    const res = await GET(makeRequest(), ctx);
    expect(res.status).toBe(200);
    expect(dbMock.event.findUnique).toHaveBeenCalled();
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
  });
});
