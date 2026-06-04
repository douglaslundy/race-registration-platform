import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/payments/[id]/export/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("admin payment detail export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("exports a payment detail csv", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      orderId: "order-1",
      status: "PAID",
      method: "PIX",
      amount: 15000,
      provider: "mercadopago",
      providerPaymentId: "prov-123",
      idempotencyKey: "idem-123",
      paidAt: new Date("2026-01-10T10:00:00.000Z"),
      expiresAt: null,
      order: {
        buyer: { name: "Ana Silva", email: "ana@exemplo.com" },
        coupon: { code: "BEMVINDO10" },
        registrations: [{ event: { title: "Corrida das Pedras" } }],
        totalAmount: 15000,
        subtotalAmount: 15000,
        discountAmount: 0,
        platformFeeAmount: 1650,
      },
      refunds: [
        {
          amount: 5000,
          reason: "Cancelamento",
        },
      ],
    });

    const res = await GET(
      new Request("http://localhost/api/admin/payments/pay-1/export", { method: "GET" }) as any,
      { params: Promise.resolve({ id: "pay-1" }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("pagamento-pay-1.csv");
    const csv = await res.text();
    expect(csv).toContain('"Payment ID"');
    expect(csv).toContain('"pay-1"');
    expect(csv).toContain('"Corrida das Pedras"');
    expect(csv).toContain("Cancelamento");
  });
});
