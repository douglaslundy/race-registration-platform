import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { checkAnyApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { listKitDeliveries } from "@/lib/kit-delivery";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({
  checkApiPermission: vi.fn(),
  checkAnyApiPermission: vi.fn(),
  resolveActingScope: vi.fn(),
}));
vi.mock("@/lib/kit-delivery", () => ({ listKitDeliveries: vi.fn() }));

import { GET } from "@/app/api/events/[id]/kit-deliveries/list/route";

const checkPermMock = vi.mocked(checkAnyApiPermission);
const resolveScopeMock = vi.mocked(resolveActingScope);
const dbMock = db as any;
const listMock = vi.mocked(listKitDeliveries);

function makeRequest() {
  return new Request("http://localhost/api/events/event-1/kit-deliveries/list") as any;
}
const ctx = { params: Promise.resolve({ id: "event-1" }) };

describe("GET /api/events/[id]/kit-deliveries/list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkPermMock.mockResolvedValue({
      allowed: true,
      session: { user: { id: "organizer-1", role: "ORGANIZER" } },
    } as any);
    resolveScopeMock.mockResolvedValue({ actingAsAdmin: false, organizerId: "organizer-1" } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
  });

  it("bloqueia sem permissão de kit", async () => {
    checkPermMock.mockResolvedValueOnce({
      allowed: false,
      response: new Response(JSON.stringify({ error: "Sem permissão" }), { status: 403 }),
    } as any);

    const res = await GET(makeRequest(), ctx);
    expect(res.status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("404 quando o evento não é do organizador", async () => {
    dbMock.event.findFirst.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), ctx);
    expect(res.status).toBe(404);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("retorna { items } com a lista completa", async () => {
    listMock.mockResolvedValueOnce([
      {
        id: "reg-1", participantName: "Ana", participantCpf: "11144477735", bibNumber: "10",
        shirtSize: "M", categoryName: "Geral", notes: null, delivered: true,
        deliveredAt: new Date("2026-08-30T10:00:00.000Z"), deliveredByName: "Org", receivedByName: "Ana", receivedByDocument: null,
      },
    ]);

    const res = await GET(makeRequest(), ctx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ id: "reg-1", participantName: "Ana", delivered: true });
    expect(listMock).toHaveBeenCalledWith("event-1");
  });

  it("admin titular usa event.findUnique (bypass de organizerId)", async () => {
    resolveScopeMock.mockResolvedValueOnce({ actingAsAdmin: true, organizerId: null } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });
    listMock.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), ctx);
    expect(res.status).toBe(200);
    expect(dbMock.event.findUnique).toHaveBeenCalled();
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
  });
});
