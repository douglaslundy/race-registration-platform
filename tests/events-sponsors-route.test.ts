import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, POST } from "@/app/api/events/[id]/sponsors/route";
import { PATCH, DELETE } from "@/app/api/events/[id]/sponsors/[sponsorId]/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/events/event-1/sponsors", {
    method: body ? "POST" : "GET",
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as any;
}

describe("GET/POST /api/events/[id]/sponsors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
  });

  it("lista os patrocinadores do evento", async () => {
    dbMock.eventSponsor.findMany.mockResolvedValueOnce([{ id: "sponsor-1", name: "ACME" }]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sponsors).toHaveLength(1);
  });

  it("cria um patrocinador novo", async () => {
    dbMock.eventSponsor.create.mockResolvedValueOnce({ id: "sponsor-1" });

    const res = await POST(
      makeRequest({ name: "ACME", url: "https://acme.com", message: "Confira a ACME!" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(201);
    expect(dbMock.eventSponsor.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventId: "event-1", name: "ACME" }) }),
    );
  });

  it("rejeita corpo inválido (sem url)", async () => {
    const res = await POST(
      makeRequest({ name: "ACME", message: "Confira a ACME!" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando o evento não é do organizador", async () => {
    dbMock.event.findFirst.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(404);
  });

  it("cria um patrocinador como ADMIN, mesmo sem ser o organizador do evento", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });
    dbMock.eventSponsor.create.mockResolvedValueOnce({ id: "sponsor-1" });

    const res = await POST(
      makeRequest({ name: "ACME", url: "https://acme.com", message: "Confira a ACME!" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(201);
    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "event-1" } });
    expect(dbMock.eventSponsor.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventId: "event-1", name: "ACME" }) }),
    );
  });
});

describe("PATCH/DELETE /api/events/[id]/sponsors/[sponsorId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.eventSponsor.findFirst.mockResolvedValue({ id: "sponsor-1", eventId: "event-1" });
  });

  it("edita um patrocinador existente", async () => {
    dbMock.eventSponsor.update.mockResolvedValueOnce({ id: "sponsor-1", active: false });

    const res = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ active: false }) }) as any,
      { params: Promise.resolve({ id: "event-1", sponsorId: "sponsor-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.eventSponsor.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sponsor-1" }, data: expect.objectContaining({ active: false }) }),
    );
  });

  it("remove um patrocinador", async () => {
    const res = await DELETE(
      new Request("http://localhost", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "event-1", sponsorId: "sponsor-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.eventSponsor.delete).toHaveBeenCalledWith({ where: { id: "sponsor-1" } });
  });

  it("retorna 404 quando o patrocinador não pertence ao evento", async () => {
    dbMock.eventSponsor.findFirst.mockResolvedValueOnce(null);
    const res = await DELETE(
      new Request("http://localhost", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "event-1", sponsorId: "sponsor-999" }) },
    );
    expect(res.status).toBe(404);
  });

  it("edita um patrocinador como ADMIN, mesmo sem ser o organizador do evento", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });
    dbMock.eventSponsor.findFirst.mockResolvedValueOnce({ id: "sponsor-1", eventId: "event-1" });
    dbMock.eventSponsor.update.mockResolvedValueOnce({ id: "sponsor-1" });

    const res = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ active: false }) }) as any,
      { params: Promise.resolve({ id: "event-1", sponsorId: "sponsor-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "event-1" } });
  });

  it("remove um patrocinador como ADMIN, mesmo sem ser o organizador do evento", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });
    dbMock.eventSponsor.findFirst.mockResolvedValueOnce({ id: "sponsor-1", eventId: "event-1" });

    const res = await DELETE(
      new Request("http://localhost", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "event-1", sponsorId: "sponsor-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "event-1" } });
    expect(dbMock.eventSponsor.delete).toHaveBeenCalledWith({ where: { id: "sponsor-1" } });
  });
});
