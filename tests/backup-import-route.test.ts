import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/backup/import/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const authMock = vi.mocked(auth);
const dbMock = db as any;

const MODELS = [
  "raceResult", "resultImport", "refund", "payment", "registration", "order",
  "fileAsset", "auditLog", "transferPayout", "coupon", "ticketBatch",
  "eventCategory", "eventRoute", "event", "athleteProfile", "organizerProfile",
  "user", "platformSetting", "alertLog",
];

function makeRequest(body: Record<string, unknown[]>) {
  const file = new File([JSON.stringify(body)], "backup.json", { type: "application/json" });
  const formData = new FormData();
  formData.append("file", file);
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
