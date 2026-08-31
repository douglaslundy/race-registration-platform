import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

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

  it("C1 — nunca grava no banco a partir do payment_id forjado da query string: pedido pendente continua pendente", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce({
      id: "order-1",
      status: "PENDING",
      registrations: [{ id: "reg-1" }],
    });

    // payment_id de um pagamento real aprovado, forjado contra um pedido não pago
    const res = await GET(makeRequest("?status=approved&order=order-1&payment_id=real-mp-id"));

    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.registration.update).not.toHaveBeenCalled();
    expect(dbMock.payment.updateMany).not.toHaveBeenCalled();
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/dashboard/inscricoes/reg-1?payment_pending=1",
    );
  });

  it("não faz nenhuma escrita quando o pedido já estava pago (redireciona pra confirmação)", async () => {
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
