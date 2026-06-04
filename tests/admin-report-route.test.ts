import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/report/export/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("admin report export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("exports the financial summary as csv", async () => {
    dbMock.payment.aggregate.mockResolvedValueOnce({
      _sum: { amount: 20000 },
      _count: { id: 2 },
    });
    dbMock.order.groupBy.mockResolvedValueOnce([
      { status: "PAID", _count: { id: 2 }, _sum: { totalAmount: 20000 } },
    ]);
    dbMock.refund.aggregate.mockResolvedValueOnce({
      _sum: { amount: 5000 },
      _count: { id: 1 },
    });
    dbMock.event.count.mockResolvedValueOnce(3);
    dbMock.registration.count.mockResolvedValueOnce(4);

    const res = await GET(
      new Request("http://localhost/api/admin/report/export?de=2026-01-01&ate=2026-01-31", { method: "GET" }) as any,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("relatorio-financeiro.csv");

    const csv = await res.text();
    expect(csv).toContain('"Receita bruta"');
    expect(csv).toMatch(/R\$\s?200,00/);
    expect(csv).toContain('"Estornos"');
    expect(csv).toMatch(/R\$\s?50,00/);
    expect(csv).toContain('"Eventos criados"');
    expect(csv).toContain('"3"');
  });
});
