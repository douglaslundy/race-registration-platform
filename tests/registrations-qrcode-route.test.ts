import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET } from "@/app/api/registrations/[id]/qrcode/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(query = "") {
  return new Request(`http://localhost/api/registrations/reg-1/qrcode${query}`) as any;
}

const registrationFixture = {
  id: "reg-1",
  proxyAthleteDisplayName: null,
  bibNumber: "1234",
  athlete: { name: "Maria Exemplo" },
  event: { title: "Corrida Exemplo" },
};

describe("GET /api/registrations/[id]/qrcode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "org-1" });
    dbMock.registration.findFirst.mockResolvedValue(registrationFixture);
  });

  it("retorna 403 para quem não tem a permissão", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a inscrição não pertence a um evento deste organizador", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(404);
  });

  it("escopa a busca ao organizador logado", async () => {
    await GET(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-1", event: { organizerId: "org-1" } } }),
    );
  });

  it("admin titular vê qualquer inscrição (sem escopo de organizerId)", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } } as any);

    await GET(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "reg-1" } }));
  });

  it("por padrão (sem format) retorna PNG com o content-type e nome de arquivo corretos", async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="qrcode-reg-1.png"');
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("format=pdf retorna um PDF válido com o content-type correto", async () => {
    const res = await GET(makeRequest("?format=pdf"), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="qrcode-reg-1.pdf"');
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("usa proxyAthleteDisplayName no PDF quando a inscrição é por procuração", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      ...registrationFixture,
      proxyAthleteDisplayName: "Atleta Convidado",
    });

    const res = await GET(makeRequest("?format=pdf"), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
  });
});
