import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payment/reconciliation", () => ({ reconcilePayments: vi.fn() }));
vi.mock("@/lib/alerts/reconciliation", () => ({ notifyReconciliationMismatches: vi.fn() }));

import { POST } from "@/app/api/cron/reconciliation/route";
import { reconcilePayments } from "@/lib/payment/reconciliation";
import { notifyReconciliationMismatches } from "@/lib/alerts/reconciliation";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/cron/reconciliation", { method: "POST", headers }) as any;
}

describe("POST /api/cron/reconciliation", () => {
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
    expect(reconcilePayments).not.toHaveBeenCalled();
  });

  it("roda a conciliação e não dispara alerta quando não há divergências", async () => {
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 3, mismatches: [] });

    const res = await POST(makeRequest({ "x-cron-secret": "test-secret" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ checked: 3, mismatches: [] });
    expect(notifyReconciliationMismatches).not.toHaveBeenCalled();
  });

  it("dispara o alerta quando há divergências", async () => {
    const mismatches = [{ paymentId: "p1", orderId: "o1", eventTitle: "Corrida", localStatus: "PENDING", gatewayStatus: "PAID" }];
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 1, mismatches });

    await POST(makeRequest({ "x-cron-secret": "test-secret" }));

    expect(notifyReconciliationMismatches).toHaveBeenCalledWith(mismatches);
  });
});
