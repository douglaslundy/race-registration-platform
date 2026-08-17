import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { findRegistrationForKitDelivery } from "@/lib/kit-delivery";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({ checkApiPermission: vi.fn(), resolveActingScope: vi.fn() }));
vi.mock("@/lib/kit-delivery", () => ({ findRegistrationForKitDelivery: vi.fn() }));

import { GET } from "@/app/api/events/[id]/kit-deliveries/search/route";
import { POST } from "@/app/api/events/[id]/kit-deliveries/route";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";

const authMock = vi.mocked(auth);
const checkPermissionMock = vi.mocked(checkApiPermission);
const resolveScopeMock = vi.mocked(resolveActingScope);
const dbMock = db as any;
const findMock = vi.mocked(findRegistrationForKitDelivery);

function makeGetRequest(q: string) {
  const url = new URL(`http://localhost/api/events/event-1/kit-deliveries/search`);
  if (q) url.searchParams.set("q", q);
  const req = new Request(url) as any;
  req.nextUrl = url;
  return req;
}

function makePostRequest(body: unknown) {
  const req = new Request("http://localhost/api/events/event-1/kit-deliveries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
  req.nextUrl = new URL(req.url);
  return req;
}

describe("GET /api/events/[id]/kit-deliveries/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    checkPermissionMock.mockResolvedValue({ allowed: true, session: { user: { id: "organizer-1", role: "ORGANIZER" } } } as any);
    resolveScopeMock.mockResolvedValue({ organizerId: "organizer-1", actingAsAdmin: false } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
  });

  it("busca e retorna os resultados", async () => {
    findMock.mockResolvedValueOnce([{ id: "reg-1" } as any]);

    const res = await GET(makeGetRequest("João"), { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.results).toHaveLength(1);
    expect(findMock).toHaveBeenCalledWith("event-1", "João");
    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "event-1", organizerId: "organizer-1" },
    });
  });

  it("retorna vazio sem consultar o helper quando não há query", async () => {
    const res = await GET(makeGetRequest(""), { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(data.results).toEqual([]);
    expect(findMock).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o evento não é do organizador", async () => {
    dbMock.event.findFirst.mockResolvedValueOnce(null);
    const res = await GET(makeGetRequest("João"), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(404);
    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "event-1", organizerId: "organizer-1" },
    });
  });
});

describe("POST /api/events/[id]/kit-deliveries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    checkPermissionMock.mockResolvedValue({ allowed: true, session: { user: { id: "organizer-1", role: "ORGANIZER" } } } as any);
    resolveScopeMock.mockResolvedValue({ organizerId: "organizer-1", actingAsAdmin: false } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.registration = { findFirst: vi.fn() };
    dbMock.kitDelivery = { create: vi.fn() };
  });

  it("confirma a entrega com sucesso", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ id: "reg-1", eventId: "event-1", status: "CONFIRMED" });
    dbMock.kitDelivery.create.mockResolvedValueOnce({ id: "kd-1" });

    const res = await POST(
      makePostRequest({ registrationId: "reg-1", receivedByName: "João Silva" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(201);
    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "event-1", organizerId: "organizer-1" },
    });
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith({
      where: { id: "reg-1", eventId: "event-1", status: "CONFIRMED" },
    });
    expect(dbMock.kitDelivery.create).toHaveBeenCalledWith({
      data: {
        registrationId: "reg-1",
        deliveredByUserId: "organizer-1",
        receivedByName: "João Silva",
        receivedByDocument: null,
      },
    });
  });

  it("rejeita corpo inválido (sem receivedByName)", async () => {
    const res = await POST(
      makePostRequest({ registrationId: "reg-1" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando a inscrição não existe ou não está confirmada no evento", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await POST(
      makePostRequest({ registrationId: "reg-1", receivedByName: "João Silva" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );
    expect(res.status).toBe(404);
    expect(dbMock.kitDelivery.create).not.toHaveBeenCalled();
  });

  it("retorna 409 quando o kit já foi entregue por outro ponto (unique constraint)", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ id: "reg-1", eventId: "event-1", status: "CONFIRMED" });
    dbMock.kitDelivery.create.mockRejectedValueOnce({ code: "P2002" });

    const res = await POST(
      makePostRequest({ registrationId: "reg-1", receivedByName: "João Silva" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/já foi entregue/i);
  });
});
