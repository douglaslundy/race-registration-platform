import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/payments/export/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("admin payments export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("exports payments as csv with filters", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([
      {
        method: "PIX",
        status: "PAID",
        amount: 15000,
        createdAt: new Date("2026-01-05T10:00:00.000Z"),
        order: {
          buyer: { name: "Ana Silva", email: "ana@exemplo.com" },
          registrations: [{ event: { title: "Corrida das Pedras" } }],
        },
      },
    ]);

    const res = await GET(
      new Request("http://localhost/api/admin/payments/export?status=PAID&method=PIX&q=ana&sort=amount&dir=asc", { method: "GET" }) as any,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("pagamentos.csv");
    expect(dbMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ status: "PAID" }),
            expect.objectContaining({ method: "PIX" }),
          ]),
        }),
        orderBy: expect.arrayContaining([expect.objectContaining({ amount: "asc" })]),
      }),
    );

    const csv = await res.text();
    expect(csv).toContain('"Corrida das Pedras"');
    expect(csv).toContain('"Ana Silva"');
    expect(csv).toContain('"PAID"');
  });

  it("retorna 403 pra organizador titular (não é admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);

    const res = await GET(new Request("http://localhost/api/admin/payments/export") as any);

    expect(res.status).toBe(403);
    expect(dbMock.payment.findMany).not.toHaveBeenCalled();
  });

  it("assistente de admin com a permissão exporta todos os pagamentos", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.payment.findMany.mockResolvedValueOnce([]);

    const res = await GET(new Request("http://localhost/api/admin/payments/export") as any);

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await GET(new Request("http://localhost/api/admin/payments/export") as any);

    expect(res.status).toBe(403);
    expect(dbMock.payment.findMany).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost/api/admin/payments/export") as any);

    expect(res.status).toBe(403);
  });
});
