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
    dbMock.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 20000 }, _count: { id: 2 } }) // gross (order PAID)
      .mockResolvedValueOnce({ _sum: { amount: 3000 }, _count: { id: 1 } }) // cancelled (order CANCELLED)
      .mockResolvedValueOnce({ _sum: { amount: 5000 }, _count: { id: 1 } }); // refunds (payment status REFUNDED/CHARGEBACK)
    dbMock.order.aggregate.mockResolvedValueOnce({ _count: { id: 2 }, _sum: { platformFeeAmount: 2200 } });
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
    expect(csv).toContain('"Pagamentos cancelados"');
    expect(csv).toMatch(/R\$\s?30,00/);
    expect(csv).toContain('"Estornos"');
    expect(csv).toMatch(/R\$\s?50,00/);
    expect(csv).toContain('"Taxa da plataforma"');
    expect(csv).toMatch(/R\$\s?22,00/);
    expect(csv).toContain('"Eventos criados"');
    expect(csv).toContain('"3"');
  });

  it("passes the eventId filter through to the payment and order queries", async () => {
    dbMock.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { id: 0 } })
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { id: 0 } })
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { id: 0 } });
    dbMock.order.aggregate.mockResolvedValueOnce({ _count: { id: 0 }, _sum: { platformFeeAmount: 0 } });
    dbMock.event.count.mockResolvedValueOnce(0);
    dbMock.registration.count.mockResolvedValueOnce(0);

    await GET(
      new Request("http://localhost/api/admin/report/export?de=2026-01-01&ate=2026-01-31&eventId=evt-1", { method: "GET" }) as any,
    );

    expect(dbMock.payment.aggregate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ order: expect.objectContaining({ status: "PAID", eventId: "evt-1" }) }),
      }),
    );
    expect(dbMock.order.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PAID", eventId: "evt-1" }),
      }),
    );
  });
});
