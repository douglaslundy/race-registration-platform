import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getMercadoPagoAccessToken } from "@/lib/payment-settings";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment-settings", () => ({ getMercadoPagoAccessToken: vi.fn() }));

import { GET } from "@/app/api/payments/mp-return/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(query: string) {
  return new Request(`http://localhost/api/payments/mp-return${query}`) as any;
}

describe("GET /api/payments/mp-return", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    global.fetch = vi.fn();
    dbMock.$transaction.mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(dbMock),
    );
  });

  it("redireciona sem gravar nada quando não há sessão, mesmo com status=approved forjado", async () => {
    authMock.mockResolvedValue(null as any);

    const res = await GET(makeRequest("?status=approved&order=order-1&payment_id=fake-123"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.example.com/dashboard/inscricoes");
    expect(dbMock.order.findFirst).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it("redireciona sem gravar nada quando o pedido não pertence ao usuário logado", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce(null);

    const res = await GET(makeRequest("?status=approved&order=order-de-outro-usuario&payment_id=fake-123"));

    expect(dbMock.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "order-de-outro-usuario", buyerUserId: "athlete-1" } }),
    );
    expect(res.headers.get("location")).toBe("https://app.example.com/dashboard/inscricoes");
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it("NÃO marca o pedido como pago só porque a query string diz status=approved — reconsulta a API real do Mercado Pago primeiro", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce({
      id: "order-1",
      status: "PENDING",
      registrations: [{ id: "reg-1" }],
    });
    vi.mocked(getMercadoPagoAccessToken).mockResolvedValue("mp-token");
    // O gateway diz que o pagamento real ainda está pendente/rejeitado, apesar da query string
    // forjada dizendo "approved".
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "in_process" }) });

    const res = await GET(makeRequest("?status=approved&order=order-1&payment_id=fake-123"));

    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.registration.update).not.toHaveBeenCalled();
    expect(dbMock.payment.updateMany).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://app.example.com/dashboard/inscricoes?payment_pending=1");
  });

  it("marca o pedido como pago quando a API real do Mercado Pago confirma o pagamento", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce({
      id: "order-1",
      status: "PENDING",
      registrations: [{ id: "reg-1" }],
    });
    vi.mocked(getMercadoPagoAccessToken).mockResolvedValue("mp-token");
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "approved" }) });

    const res = await GET(makeRequest("?status=approved&order=order-1&payment_id=real-mp-id"));

    expect(dbMock.order.update).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { status: "PAID" } });
    expect(dbMock.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CONFIRMED" } });
    expect(dbMock.payment.updateMany).toHaveBeenCalledWith({
      where: { orderId: "order-1", status: "PENDING" },
      data: { status: "PAID", paidAt: expect.any(Date), providerPaymentId: "real-mp-id" },
    });
    expect(res.headers.get("location")).toBe("https://app.example.com/dashboard/inscricoes/reg-1?confirmed=1");
  });

  it("não faz nenhuma escrita nova quando o pedido já estava pago (idempotente)", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce({
      id: "order-1",
      status: "PAID",
      registrations: [{ id: "reg-1" }],
    });

    const res = await GET(makeRequest("?status=approved&order=order-1&payment_id=real-mp-id"));

    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://app.example.com/dashboard/inscricoes/reg-1?confirmed=1");
  });

  it("redireciona pro banner de falha (cosmético, sem gravar nada) quando status=failure", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce({
      id: "order-1",
      status: "PENDING",
      registrations: [{ id: "reg-1" }],
    });

    const res = await GET(makeRequest("?status=failure&order=order-1"));

    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://app.example.com/dashboard/inscricoes?payment_failed=1");
  });
});
