import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET } from "@/app/api/events/[id]/coupons/preview/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return new Request(`http://localhost/api/events/ev-1/coupons/preview?${params.toString()}`) as any;
}

function makeContext(id = "ev-1") {
  return { params: Promise.resolve({ id }) };
}

const batch = { id: "batch-1", priceAmount: 20000 };

describe("GET /api/events/[id]/coupons/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "ev-1" });
    dbMock.ticketBatch.findFirst.mockResolvedValue(batch);
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await GET(makeRequest({ code: "X", ticketBatchId: "batch-1" }), makeContext());
    expect(res.status).toBe(401);
  });

  it("retorna 400 sem código", async () => {
    const res = await GET(makeRequest({ ticketBatchId: "batch-1" }), makeContext());
    expect(res.status).toBe(400);
  });

  it("retorna 400 sem ticketBatchId", async () => {
    const res = await GET(makeRequest({ code: "X" }), makeContext());
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando o código não corresponde a nenhum cupom", async () => {
    dbMock.coupon.findFirst.mockResolvedValue(null);
    const res = await GET(makeRequest({ code: "NOPE", ticketBatchId: "batch-1" }), makeContext());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Cupom inválido");
  });

  it("retorna 404 quando o cupom encontrado está inativo (mesma mensagem genérica de antes)", async () => {
    dbMock.coupon.findFirst.mockResolvedValueOnce({
      id: "coupon-1",
      discountType: "PERCENT",
      discountValue: 10,
      maxUses: null,
      usedCount: 0,
      active: false,
      expiresAt: null,
    });
    const res = await GET(makeRequest({ code: "OFF", ticketBatchId: "batch-1" }), makeContext());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Cupom inválido");
  });

  it("retorna erro específico de cupom vencido (não mais 404 genérico), sem aplicar desconto", async () => {
    dbMock.coupon.findFirst.mockResolvedValueOnce({
      id: "coupon-1",
      discountType: "PERCENT",
      discountValue: 10,
      maxUses: null,
      usedCount: 0,
      active: true,
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const res = await GET(makeRequest({ code: "EXPIRED10", ticketBatchId: "batch-1" }), makeContext());
    const body = await res.json();
    expect(body.error).toBe("Cupom vencido");
    expect(res.status).not.toBe(200);
  });

  it("retorna 409 quando o cupom está esgotado", async () => {
    dbMock.coupon.findFirst.mockResolvedValueOnce({
      id: "coupon-1",
      discountType: "PERCENT",
      discountValue: 10,
      maxUses: 5,
      usedCount: 5,
      active: true,
      expiresAt: null,
    });
    const res = await GET(makeRequest({ code: "USED", ticketBatchId: "batch-1" }), makeContext());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Cupom esgotado");
  });

  it("aplica o desconto percentual no caminho feliz", async () => {
    dbMock.coupon.findFirst.mockResolvedValueOnce({
      id: "coupon-1",
      code: "PROMO10",
      discountType: "PERCENT",
      discountValue: 10,
      maxUses: null,
      usedCount: 0,
      active: true,
      expiresAt: null,
    });
    const res = await GET(makeRequest({ code: "PROMO10", ticketBatchId: "batch-1" }), makeContext());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ code: "PROMO10", discountAmount: 2000, subtotalAmount: 18000 });
  });
});
