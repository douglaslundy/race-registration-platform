import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendAdvertiserRequestApprovedEmail: vi.fn() }));
vi.mock("@/lib/db", () => {
  const db: any = {
    adPurchase: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
  };
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  return { db };
});

import { POST } from "@/app/api/admin/anunciantes/[purchaseId]/approve/route";
import { sendAdvertiserRequestApprovedEmail } from "@/lib/email";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/admin/anunciantes/purchase-1/approve", { method: "POST" }) as any;
}

describe("POST /api/admin/anunciantes/[purchaseId]/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(), { params: Promise.resolve({ purchaseId: "purchase-1" }) });
    expect(res.status).toBe(403);
  });

  it("retorna 404 quando a compra não existe ou não está PENDING_APPROVAL", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ purchaseId: "purchase-1" }) });
    expect(res.status).toBe(404);
  });

  it("aprova: marca PAID com startAt/endAt, muda role pra ADVERTISER e envia e-mail", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({
      id: "purchase-1",
      status: "PENDING_APPROVAL",
      adPlan: { name: "Plano Básico", durationDays: 30 },
      advertiser: { userId: "user-1", user: { name: "Fulano", email: "fulano@example.com" } },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ purchaseId: "purchase-1" }) });

    expect(dbMock.adPurchase.update).toHaveBeenCalledWith({
      where: { id: "purchase-1" },
      data: expect.objectContaining({ status: "PAID" }),
    });
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { role: "ADVERTISER" },
    });
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(sendAdvertiserRequestApprovedEmail).toHaveBeenCalledWith({
      to: "fulano@example.com",
      name: "Fulano",
      planName: "Plano Básico",
    });
    expect(res.status).toBe(200);
  });
});
