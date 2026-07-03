import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/alerts/abandoned-cart", () => ({
  checkAbandonedCarts: vi.fn(),
}));

import { POST } from "@/app/api/cron/abandoned-carts/route";
import { checkAbandonedCarts } from "@/lib/alerts/abandoned-cart";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/cron/abandoned-carts", {
    method: "POST",
    headers,
  }) as any;
}

describe("POST /api/cron/abandoned-carts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it("retorna 401 quando o segredo não é enviado", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(checkAbandonedCarts).not.toHaveBeenCalled();
  });

  it("retorna 401 quando o segredo enviado está errado", async () => {
    const res = await POST(makeRequest({ "x-cron-secret": "wrong" }));
    expect(res.status).toBe(401);
    expect(checkAbandonedCarts).not.toHaveBeenCalled();
  });

  it("retorna 401 quando CRON_SECRET não está configurado no ambiente", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(makeRequest({ "x-cron-secret": "anything" }));
    expect(res.status).toBe(401);
    expect(checkAbandonedCarts).not.toHaveBeenCalled();
  });

  it("chama checkAbandonedCarts e retorna o resultado quando o segredo bate", async () => {
    vi.mocked(checkAbandonedCarts).mockResolvedValueOnce({ checked: 5, notified: 2 });

    const res = await POST(makeRequest({ "x-cron-secret": "test-secret" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ checked: 5, notified: 2 });
  });
});
