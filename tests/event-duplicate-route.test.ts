import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/events/[id]/duplicate/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/events/event-1/duplicate", { method: "POST" }) as any;
}

const baseEvent = {
  id: "event-1",
  organizerId: "org-1",
  title: "Corrida das Pedras",
  description: null,
  modality: "ROAD_RACE",
  startAt: new Date("2026-03-01T10:00:00.000Z"),
  kitPickupAt: null,
  venueName: null,
  addressLine: null,
  city: "São Paulo",
  state: "SP",
  country: "BR",
  bannerUrl: null,
  regulationUrl: null,
  organizerContact: null,
  maxParticipants: null,
  platformFeePercent: 500,
  pixServiceFeeDiscountPercent: 15,
  routes: [],
  categories: [],
  ticketBatches: [],
};

describe("event duplicate api", () => {
  let txMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.event.findUnique.mockResolvedValue(null); // slug uniqueness check
    txMock = {
      event: { create: vi.fn().mockResolvedValue({ id: "event-2" }) },
      eventRoute: { createMany: vi.fn() },
      eventCategory: { createMany: vi.fn() },
      ticketBatch: { createMany: vi.fn() },
    };
    dbMock.$transaction.mockImplementation(async (fn: any) => fn(txMock));
  });

  it("ORGANIZER titular duplica o próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1", userId: "user-1" });
    dbMock.event.findFirst.mockResolvedValueOnce(baseEvent);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.event.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "event-1", organizerId: "org-1" } }),
    );
    expect(res.status).toBe(201);
    expect(txMock.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pixServiceFeeDiscountPercent: 15 }),
      }),
    );
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(401);
  });

  it("retorna 404 quando o evento não pertence ao organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1", userId: "user-1" });
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(404);
  });

  // duplicate nunca teve bypass de admin (ver brief da Task 3, Step 9): ADMIN titular não
  // tem organizerId próprio, então resolveActingScope devolve organizerId: null e a rota
  // continua devolvendo 404 pra admin, exatamente como antes desta tarefa.
  it("ADMIN titular continua recebendo 404 (duplicate nunca teve bypass de admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.event.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "event-1", organizerId: "__none__" } }),
    );
    expect(res.status).toBe(404);
  });

  it("ASSISTANT criado por organizador com events.duplicate consegue duplicar evento do organizerId do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({
      createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } },
    });
    dbMock.event.findFirst.mockResolvedValueOnce(baseEvent);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.event.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "event-1", organizerId: "org-1" } }),
    );
    expect(res.status).toBe(201);
  });

  // Mesmo um ASSISTANT-de-admin (actingAsAdmin: true) não ganha bypass aqui — a rota só
  // olha scope.organizerId, nunca scope.actingAsAdmin (fidelidade ao comportamento
  // pré-existente, não é uma correção de bug).
  it("ASSISTANT criado por admin recebe 404 (sem bypass de admin, mesmo actingAsAdmin=true)", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.event.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "event-1", organizerId: "__none__" } }),
    );
    expect(res.status).toBe(404);
  });

  it("ASSISTANT sem events.duplicate é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(403);
  });
});
