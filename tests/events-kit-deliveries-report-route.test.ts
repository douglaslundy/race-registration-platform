import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { getKitDeliveryProgress } from "@/lib/kit-delivery";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({
  checkApiPermission: vi.fn(),
  resolveActingScope: vi.fn(),
}));
vi.mock("@/lib/kit-delivery", () => ({ getKitDeliveryProgress: vi.fn() }));

import { GET as GET_REPORT } from "@/app/api/events/[id]/kit-deliveries/report/route";
import { GET as GET_EXPORT } from "@/app/api/events/[id]/kit-deliveries/report-export/route";

const authMock = vi.mocked(auth);
const checkApiPermissionMock = vi.mocked(checkApiPermission);
const resolveActingScopeMock = vi.mocked(resolveActingScope);
const dbMock = db as any;
const progressMock = vi.mocked(getKitDeliveryProgress);

function makeRequest() {
  return new Request("http://localhost/api/events/event-1/kit-deliveries/report") as any;
}

describe("GET /api/events/[id]/kit-deliveries/report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkApiPermissionMock.mockResolvedValue({ allowed: true, session: { user: { id: "organizer-1", role: "ORGANIZER" } } } as any);
    resolveActingScopeMock.mockResolvedValue({ actingAsAdmin: false, organizerId: "organizer-1" } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
  });

  it("retorna o progresso do evento", async () => {
    progressMock.mockResolvedValueOnce({ total: 5, delivered: 2, pending: [] });

    const res = await GET_REPORT(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ total: 5, delivered: 2, pending: [] });
  });

  it("retorna 404 quando o evento não é do organizador", async () => {
    dbMock.event.findFirst.mockResolvedValueOnce(null);
    const res = await GET_REPORT(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(404);
  });

  it("chama findFirst com eventId e organizerId quando não é admin", async () => {
    progressMock.mockResolvedValueOnce({ total: 0, delivered: 0, pending: [] });

    await GET_REPORT(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "event-1", organizerId: "organizer-1" },
    });
  });

  it("chama findUnique quando o usuário é admin", async () => {
    resolveActingScopeMock.mockResolvedValueOnce({ actingAsAdmin: true } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });
    progressMock.mockResolvedValueOnce({ total: 0, delivered: 0, pending: [] });

    await GET_REPORT(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "event-1" } });
  });
});

describe("GET /api/events/[id]/kit-deliveries/report-export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkApiPermissionMock.mockResolvedValue({ allowed: true, session: { user: { id: "organizer-1", role: "ORGANIZER" } } } as any);
    resolveActingScopeMock.mockResolvedValue({ actingAsAdmin: false, organizerId: "organizer-1" } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1", title: "Corrida Teste" });
  });

  it("gera CSV com cabeçalho e linhas dos pendentes", async () => {
    progressMock.mockResolvedValueOnce({
      total: 2,
      delivered: 1,
      pending: [{ id: "reg-2", athleteName: "Atleta B", bibNumber: "2", categoryName: "Geral", email: "b@example.com", phone: "11999990000" }],
    });

    const res = await GET_EXPORT(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(text).toContain("Nome,Número de peito,Categoria,E-mail,Telefone");
    expect(text).toContain("Atleta B");
  });

  it("retorna 404 quando o evento não é do organizador", async () => {
    dbMock.event.findFirst.mockResolvedValueOnce(null);
    const res = await GET_EXPORT(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(404);
  });

  it("chama findFirst com eventId e organizerId quando não é admin", async () => {
    progressMock.mockResolvedValueOnce({ total: 0, delivered: 0, pending: [] });

    await GET_EXPORT(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "event-1", organizerId: "organizer-1" },
      select: { id: true, title: true },
    });
  });

  it("chama findUnique quando o usuário é admin", async () => {
    resolveActingScopeMock.mockResolvedValueOnce({ actingAsAdmin: true } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1", title: "Corrida Teste" });
    progressMock.mockResolvedValueOnce({ total: 0, delivered: 0, pending: [] });

    await GET_EXPORT(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.event.findUnique).toHaveBeenCalledWith({
      where: { id: "event-1" },
      select: { id: true, title: true },
    });
  });

  it("gera nome do arquivo CSV com slug do evento", async () => {
    progressMock.mockResolvedValueOnce({ total: 0, delivered: 0, pending: [] });

    const res = await GET_EXPORT(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    const disposition = res.headers.get("Content-Disposition");
    expect(disposition).toBeDefined();
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("kits-pendentes-corrida-teste.csv");
  });
});
