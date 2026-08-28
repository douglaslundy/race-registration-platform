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
        serviceFeeOriginalAmount: 1000,
        pixDiscountPercent: 20,
        pixDiscountAmount: 200,
        paymentFeeAmount: 800,
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
    expect(csv).toContain("Taxa de serviço (original)");
    expect(csv).toMatch(/R\$\s?10,00/);
    expect(csv).toContain("Desconto PIX na Taxa de Serviço");
    expect(csv).toContain("Desconto PIX (%)");
    expect(csv).toContain("20%");
    expect(csv).toContain("Taxa de serviço (líquida)");
    expect(csv).toMatch(/R\$\s?8,00/);
  });

  it("retorna 403 pra organizador titular (não é admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);

    const res = await GET(
      new Request("http://localhost/api/admin/payments/pay-1/export") as any,
      { params: Promise.resolve({ id: "pay-1" }) },
    );

    expect(res.status).toBe(403);
    expect(dbMock.payment.findUnique).not.toHaveBeenCalled();
  });

  it("assistente de admin com a permissão exporta qualquer pagamento", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      orderId: "order-1",
      status: "PAID",
      method: "PIX",
      amount: 5000,
      provider: "mercadopago",
      providerPaymentId: "mp-1",
      idempotencyKey: "idem-1",
      paidAt: new Date("2026-01-01"),
      expiresAt: null,
      order: {
        buyer: { name: "Atleta", email: "atleta@example.com" },
        coupon: null,
        registrations: [],
        totalAmount: 5000,
        subtotalAmount: 5000,
        discountAmount: 0,
        platformFeeAmount: 0,
      },
      refunds: [],
    });

    const res = await GET(
      new Request("http://localhost/api/admin/payments/pay-1/export") as any,
      { params: Promise.resolve({ id: "pay-1" }) },
    );

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await GET(
      new Request("http://localhost/api/admin/payments/pay-1/export") as any,
      { params: Promise.resolve({ id: "pay-1" }) },
    );

    expect(res.status).toBe(403);
    expect(dbMock.payment.findUnique).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await GET(
      new Request("http://localhost/api/admin/payments/pay-1/export") as any,
      { params: Promise.resolve({ id: "pay-1" }) },
    );

    expect(res.status).toBe(403);
  });
});
