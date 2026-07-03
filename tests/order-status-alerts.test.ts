import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getPaymentProviderSetting, getMercadoPagoAccessToken } from "@/lib/payment-settings";
import { notifyPaymentError } from "@/lib/alerts/payment-error";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment-settings", () => ({
  getPaymentProviderSetting: vi.fn(),
  getMercadoPagoAccessToken: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({ notifyOrderConfirmed: vi.fn() }));
vi.mock("@/lib/alerts/payment-error", () => ({ notifyPaymentError: vi.fn() }));

import { GET } from "@/app/api/orders/[id]/status/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("order status route alert hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    vi.mocked(getPaymentProviderSetting).mockResolvedValue("mercadopago");
    vi.mocked(getMercadoPagoAccessToken).mockResolvedValue("mp-token");
    global.fetch = vi.fn();
    dbMock.$transaction.mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(dbMock),
    );
  });

  it("avisa o atleta quando o Mercado Pago informa que o pagamento foi cancelado", async () => {
    dbMock.order.findFirst.mockResolvedValueOnce({
      id: "order-1",
      status: "PENDING",
      totalAmount: 10000,
      payments: [{ id: "payment-1", providerPaymentId: "mp-1", status: "PENDING" }],
      registrations: [],
    });
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "cancelled" }),
    });

    const res = await GET(
      new Request("http://localhost/api/orders/order-1/status") as any,
      { params: Promise.resolve({ id: "order-1" }) },
    );
    const body = await res.json();

    expect(body.status).toBe("CANCELLED");
    expect(notifyPaymentError).toHaveBeenCalledWith("payment-1");
  });

  it("não avisa quando o pagamento é aprovado", async () => {
    dbMock.order.findFirst.mockResolvedValueOnce({
      id: "order-1",
      status: "PENDING",
      totalAmount: 10000,
      payments: [{ id: "payment-1", providerPaymentId: "mp-1", status: "PENDING" }],
      registrations: [],
    });
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "approved" }),
    });

    await GET(
      new Request("http://localhost/api/orders/order-1/status") as any,
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(notifyPaymentError).not.toHaveBeenCalled();
  });
});
