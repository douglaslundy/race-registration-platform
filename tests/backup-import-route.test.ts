import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/backup/import/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/security/sensitive-action-verification", () => ({
  verifySensitiveActionCode: vi.fn(),
  requestSensitiveActionCode: vi.fn(),
}));

import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const verifyCodeMock = vi.mocked(verifySensitiveActionCode);

const MODELS = [
  "raceResult", "resultImport", "refund", "payment", "registration", "order",
  "fileAsset", "auditLog", "transferPayout", "coupon", "ticketBatch",
  "eventCategory", "eventRoute", "event", "paymentAccount", "athleteProfile", "organizerProfile",
  "user", "platformSetting", "alertLog",
];

function makeRequest(body: Record<string, unknown[]>) {
  const file = new File([JSON.stringify(body)], "backup.json", { type: "application/json" });
  const formData = new FormData();
  formData.append("file", file);
  formData.append("verificationId", "v-1");
  formData.append("code", "123456");
  return new Request("http://localhost/api/admin/backup/import", {
    method: "POST",
    body: formData,
  }) as any;
}

describe("admin backup import api", () => {
  let callOrder: string[];
  let tx: Record<string, { deleteMany: ReturnType<typeof vi.fn>; createMany: ReturnType<typeof vi.fn> }>;

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    verifyCodeMock.mockResolvedValue({ ok: true });

    callOrder = [];
    tx = {};
    for (const model of MODELS) {
      tx[model] = {
        deleteMany: vi.fn(async () => {
          callOrder.push(`delete:${model}`);
          return { count: 0 };
        }),
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
          callOrder.push(`create:${model}`);
          return { count: data.length };
        }),
      };
    }
    dbMock.$transaction = vi.fn(async (fn: any) => fn(tx));
  });

  it("rejects when the caller is not an admin", async () => {
    authMock.mockResolvedValueOnce(null as any);
    const res = await POST(makeRequest({ users: [] }));
    expect(res.status).toBe(403);
  });

  it("rejects when no file is sent", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/backup/import", { method: "POST", body: new FormData() }) as any,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/não enviado/i);
  });

  it("rejects invalid JSON", async () => {
    const formData = new FormData();
    formData.append("file", new File(["not json"], "backup.json", { type: "application/json" }));
    const res = await POST(
      new Request("http://localhost/api/admin/backup/import", { method: "POST", body: formData }) as any,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/inválido ou corrompido/i);
  });

  it("rejects a file with none of the expected table keys", async () => {
    const res = await POST(makeRequest({ somethingElse: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/não parece ser um backup válido/i);
  });

  it("wipes every table before inserting, in FK-safe order, and reports counts", async () => {
    const res = await POST(
      makeRequest({
        users: [
          { id: "u1", email: "a@a.com", name: "A", role: "ADMIN", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
        ],
        events: [
          {
            id: "e1", organizerId: "org-1", title: "T", slug: "t", modality: "RUNNING", status: "DRAFT",
            startAt: "2026-01-01T00:00:00.000Z", city: "X", state: "SP", createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        transferPayouts: [
          {
            id: "tp1", eventId: "e1", organizerId: "org-1", grossAmount: 100, platformFee: 10,
            netAmount: 90, status: "PENDING", createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        orders: [
          {
            id: "o1", buyerUserId: "u1", eventId: "e1", subtotalAmount: 100, platformFeeAmount: 10,
            paymentFeeAmount: 5, totalAmount: 115, payoutId: "tp1", status: "PAID", createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        registrations: [
          {
            id: "r1", eventId: "e1", athleteUserId: "u1", ticketBatchId: "tb1", orderId: "o1",
            status: "CONFIRMED", createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        payments: [
          {
            id: "p1", orderId: "o1", provider: "sandbox", method: "PIX", status: "PAID", amount: 115,
            idempotencyKey: "idem-1", createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tables.find((t: any) => t.table === "users").restored).toBe(1);
    expect(data.tables.find((t: any) => t.table === "events").restored).toBe(1);
    expect(data.tables.find((t: any) => t.table === "transferPayouts").restored).toBe(1);
    expect(data.totalRestored).toBe(6);

    expect(callOrder.indexOf("delete:registration")).toBeLessThan(callOrder.indexOf("delete:event"));
    expect(callOrder.indexOf("delete:payment")).toBeLessThan(callOrder.indexOf("delete:order"));
    expect(callOrder.indexOf("delete:raceResult")).toBeLessThan(callOrder.indexOf("delete:resultImport"));
    expect(callOrder.indexOf("delete:organizerProfile")).toBeLessThan(callOrder.indexOf("delete:user"));
    expect(callOrder.indexOf("delete:order")).toBeLessThan(callOrder.indexOf("delete:transferPayout"));
    expect(callOrder.indexOf("delete:user")).toBeLessThan(callOrder.indexOf("create:user"));
    expect(callOrder.indexOf("create:user")).toBeLessThan(callOrder.indexOf("create:event"));
    expect(callOrder.indexOf("create:event")).toBeLessThan(callOrder.indexOf("create:registration"));
    expect(callOrder.indexOf("create:transferPayout")).toBeLessThan(callOrder.indexOf("create:order"));
    expect(callOrder.indexOf("create:order")).toBeLessThan(callOrder.indexOf("create:payment"));

    expect(tx.order.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ payoutId: "tp1" })]) }),
    );
  });

  it("restores the PIX service fee discount fields faithfully from a new-format backup", async () => {
    const res = await POST(
      makeRequest({
        events: [
          {
            id: "e1", organizerId: "org-1", title: "T", slug: "t", modality: "RUNNING", status: "DRAFT",
            startAt: "2026-01-01T00:00:00.000Z", city: "X", state: "SP", createdAt: "2026-01-01T00:00:00.000Z",
            pixServiceFeeDiscountPercent: 0,
          },
        ],
        orders: [
          {
            id: "o1", buyerUserId: "u1", eventId: "e1", subtotalAmount: 10000, platformFeeAmount: 500,
            paymentFeeAmount: 800, serviceFeeOriginalAmount: 1000, pixDiscountPercent: 20, pixDiscountAmount: 200,
            totalAmount: 11300, status: "PAID", createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    expect(tx.event.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ pixServiceFeeDiscountPercent: 0 })]),
      }),
    );
    expect(tx.order.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            serviceFeeOriginalAmount: 1000,
            pixDiscountPercent: 20,
            pixDiscountAmount: 200,
          }),
        ]),
      }),
    );
  });

  it("falls back to paymentFeeAmount / null for pre-feature backups missing the PIX discount fields", async () => {
    const res = await POST(
      makeRequest({
        events: [
          {
            id: "e1", organizerId: "org-1", title: "T", slug: "t", modality: "RUNNING", status: "DRAFT",
            startAt: "2026-01-01T00:00:00.000Z", city: "X", state: "SP", createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        orders: [
          {
            id: "o1", buyerUserId: "u1", eventId: "e1", subtotalAmount: 10000, platformFeeAmount: 500,
            paymentFeeAmount: 900, totalAmount: 11400, status: "PAID", createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    expect(tx.event.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ pixServiceFeeDiscountPercent: null })]),
      }),
    );
    expect(tx.order.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            serviceFeeOriginalAmount: 900,
            pixDiscountPercent: 0,
            pixDiscountAmount: 0,
          }),
        ]),
      }),
    );
  });

  it("preserves the athlete's address fields on restore", async () => {
    const res = await POST(
      makeRequest({
        users: [
          { id: "u1", email: "a@a.com", name: "A", role: "ATHLETE", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
        ],
        athleteProfiles: [
          {
            id: "ap1",
            userId: "u1",
            postalCode: "01310-100",
            street: "Av. Paulista",
            number: "1000",
            complement: "Apto 12",
            neighborhood: "Bela Vista",
            city: "São Paulo",
            state: "SP",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tables.find((t: any) => t.table === "athleteProfiles").restored).toBe(1);

    expect(tx.athleteProfile.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            postalCode: "01310-100",
            street: "Av. Paulista",
            number: "1000",
            complement: "Apto 12",
            neighborhood: "Bela Vista",
          }),
        ]),
      }),
    );
  });

  it("restores payment_accounts and keeps paymentAccountId on events and payments", async () => {
    const res = await POST(
      makeRequest({
        paymentAccounts: [
          {
            id: "acc_1", label: "Conta MP 1", provider: "mercadopago", accessToken: "TOK-1",
            webhookSecret: "WHS-1", publicKey: "PUB-1", isDefault: true, archivedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        events: [
          {
            id: "e1", organizerId: "org-1", title: "T", slug: "t", modality: "RUNNING", status: "DRAFT",
            startAt: "2026-01-01T00:00:00.000Z", city: "X", state: "SP", createdAt: "2026-01-01T00:00:00.000Z",
            paymentAccountId: "acc_1",
          },
        ],
        orders: [
          {
            id: "o1", buyerUserId: "u1", eventId: "e1", subtotalAmount: 100, platformFeeAmount: 10,
            paymentFeeAmount: 5, totalAmount: 115, status: "PAID", createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        payments: [
          {
            id: "p1", orderId: "o1", provider: "mercadopago", method: "PIX", status: "PAID", amount: 115,
            idempotencyKey: "idem-1", paymentAccountId: "acc_1", createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tables.find((t: any) => t.table === "paymentAccounts").restored).toBe(1);

    expect(callOrder.indexOf("delete:payment")).toBeLessThan(callOrder.indexOf("delete:paymentAccount"));
    expect(callOrder.indexOf("delete:event")).toBeLessThan(callOrder.indexOf("delete:paymentAccount"));
    expect(callOrder.indexOf("create:paymentAccount")).toBeLessThan(callOrder.indexOf("create:event"));
    expect(callOrder.indexOf("create:paymentAccount")).toBeLessThan(callOrder.indexOf("create:payment"));

    expect(tx.paymentAccount.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ id: "acc_1", accessToken: "TOK-1", webhookSecret: "WHS-1", isDefault: true }),
        ]),
      }),
    );
    expect(tx.event.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ paymentAccountId: "acc_1" })]),
      }),
    );
    expect(tx.payment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ paymentAccountId: "acc_1" })]),
      }),
    );
  });

  it("rolls back and reports a single error when a table insert fails", async () => {
    tx.event.createMany.mockRejectedValueOnce(new Error("dado malformado"));

    const res = await POST(
      makeRequest({
        users: [
          { id: "u1", email: "a@a.com", name: "A", role: "ADMIN", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
        ],
        events: [
          {
            id: "e1", organizerId: "org-1", title: "T", slug: "t", modality: "RUNNING", status: "DRAFT",
            startAt: "2026-01-01T00:00:00.000Z", city: "X", state: "SP", createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toMatch(/nenhum dado foi alterado/i);
    expect(data.error).toMatch(/dado malformado/);
  });
});
