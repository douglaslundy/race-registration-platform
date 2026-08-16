import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, POST } from "@/app/api/events/[id]/social-links/route";
import { PATCH, DELETE } from "@/app/api/events/[id]/social-links/[linkId]/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/events/event-1/social-links", {
    method: body ? "POST" : "GET",
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as any;
}

describe("GET/POST /api/events/[id]/social-links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
  });

  it("lista as redes sociais do evento", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([{ id: "link-1", platform: "Instagram" }]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.socialLinks).toHaveLength(1);
  });

  it("cria uma rede social nova", async () => {
    dbMock.eventSocialLink.create.mockResolvedValueOnce({ id: "link-1" });

    const res = await POST(
      makeRequest({ platform: "Instagram", url: "https://instagram.com/corrida", message: "Segue a gente!", maxSends: 2 }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(201);
    expect(dbMock.eventSocialLink.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventId: "event-1", platform: "Instagram" }) }),
    );
  });

  it("rejeita corpo inválido (sem url)", async () => {
    const res = await POST(
      makeRequest({ platform: "Instagram", message: "Segue a gente!" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando o evento não é do organizador", async () => {
    dbMock.event.findFirst.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(404);
  });
});

describe("PATCH/DELETE /api/events/[id]/social-links/[linkId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.eventSocialLink.findFirst.mockResolvedValue({ id: "link-1", eventId: "event-1" });
  });

  it("edita uma rede social existente", async () => {
    dbMock.eventSocialLink.update.mockResolvedValueOnce({ id: "link-1", active: false });

    const res = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ active: false }) }) as any,
      { params: Promise.resolve({ id: "event-1", linkId: "link-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.eventSocialLink.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "link-1" }, data: expect.objectContaining({ active: false }) }),
    );
  });

  it("remove uma rede social", async () => {
    const res = await DELETE(
      new Request("http://localhost", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "event-1", linkId: "link-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.eventSocialLink.delete).toHaveBeenCalledWith({ where: { id: "link-1" } });
  });

  it("retorna 404 quando a rede social não pertence ao evento", async () => {
    dbMock.eventSocialLink.findFirst.mockResolvedValueOnce(null);
    const res = await DELETE(
      new Request("http://localhost", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "event-1", linkId: "link-999" }) },
    );
    expect(res.status).toBe(404);
  });
});
