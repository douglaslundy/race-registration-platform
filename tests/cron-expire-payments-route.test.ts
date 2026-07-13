import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payment/expire-payments", () => ({
  expirePendingPayments: vi.fn(),
  expireAbandonedOrders: vi.fn(),
}));

import { POST } from "@/app/api/cron/expire-payments/route";
import { expirePendingPayments, expireAbandonedOrders } from "@/lib/payment/expire-payments";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/cron/expire-payments", { method: "POST", headers }) as any;
}

describe("POST /api/cron/expire-payments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it("retorna 401 quando o segredo não bate", async () => {
    const res = await POST(makeRequest({ "x-cron-secret": "wrong" }));
    expect(res.status).toBe(401);
    expect(expirePendingPayments).not.toHaveBeenCalled();
    expect(expireAbandonedOrders).not.toHaveBeenCalled();
  });

  it("roda os dois mecanismos sem filtro e soma o resultado", async () => {
    vi.mocked(expirePendingPayments).mockResolvedValueOnce({ checked: 2, expired: 1 });
    vi.mocked(expireAbandonedOrders).mockResolvedValueOnce({ checked: 3, expired: 2 });

    const res = await POST(makeRequest({ "x-cron-secret": "test-secret" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(expirePendingPayments).toHaveBeenCalledWith();
    expect(expireAbandonedOrders).toHaveBeenCalledWith();
    expect(body).toEqual({ checked: 5, expired: 3 });
  });
});
