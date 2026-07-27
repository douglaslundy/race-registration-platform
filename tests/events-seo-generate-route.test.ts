import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(), getAppName: vi.fn() }));
vi.mock("@/lib/ai", () => ({ getAiProvider: vi.fn() }));

import { POST } from "@/app/api/events/[id]/seo/generate/route";
import { auth } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { getAiProvider } from "@/lib/ai";

const authMock = vi.mocked(auth);
const dbMock = db as any;

const EVENT = {
  id: "event-1",
  organizerId: "organizer-1",
  title: "Corrida da Serra",
  description: "Uma corrida linda.",
  city: "Belo Horizonte",
  state: "MG",
  modality: "TRAIL_RUN",
  startAt: new Date("2026-09-01T09:00:00Z"),
};

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/events/event-1/seo/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/events/[id]/seo/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findUnique.mockResolvedValue(EVENT);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-1" });
    dbMock.event.findFirst.mockResolvedValue(EVENT);
    vi.mocked(getSetting).mockResolvedValue(null);
  });

  it("retorna 403 para quem não pode editar eventos", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest({ field: "metaTitle" }), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(403);
  });

  it("retorna 400 com field inválido", async () => {
    const res = await POST(makeRequest({ field: "banana" }), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando o evento não existe", async () => {
    dbMock.event.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ field: "metaTitle" }), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(404);
  });

  it("retorna 502 quando o provedor de IA falha", async () => {
    vi.mocked(getAiProvider).mockResolvedValueOnce({
      generateText: vi.fn().mockRejectedValueOnce(new Error("Chave de API do Claude não configurada")),
    });
    const res = await POST(makeRequest({ field: "metaTitle" }), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Chave de API do Claude não configurada");
  });

  it("retorna 200 com o texto gerado e truncado", async () => {
    vi.mocked(getAiProvider).mockResolvedValueOnce({
      generateText: vi.fn().mockResolvedValueOnce("a".repeat(100)),
    });
    const res = await POST(makeRequest({ field: "metaTitle" }), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toHaveLength(70);
  });
});
