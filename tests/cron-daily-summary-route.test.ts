import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/alerts/daily-summary", () => ({
  getYesterdayBrasiliaWindow: vi.fn(),
  sendAdminDailySummaries: vi.fn(),
  sendOrganizerDailySummaries: vi.fn(),
  sendEventDailySummaries: vi.fn(),
}));

import { POST } from "@/app/api/cron/daily-summary/route";
import {
  getYesterdayBrasiliaWindow,
  sendAdminDailySummaries,
  sendOrganizerDailySummaries,
  sendEventDailySummaries,
} from "@/lib/alerts/daily-summary";

const ORIGINAL_SECRET = process.env.CRON_SECRET;
const dayStart = new Date("2026-07-12T03:00:00.000Z");
const dayEnd = new Date("2026-07-13T03:00:00.000Z");

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/cron/daily-summary", { method: "POST", headers }) as any;
}

describe("POST /api/cron/daily-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
    vi.mocked(getYesterdayBrasiliaWindow).mockReturnValue({ dayStart, dayEnd });
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it("retorna 401 quando o segredo não bate", async () => {
    const res = await POST(makeRequest({ "x-cron-secret": "wrong" }));
    expect(res.status).toBe(401);
    expect(sendAdminDailySummaries).not.toHaveBeenCalled();
    expect(sendOrganizerDailySummaries).not.toHaveBeenCalled();
    expect(sendEventDailySummaries).not.toHaveBeenCalled();
  });

  it("chama os três envios com a janela do dia anterior e retorna os totais", async () => {
    vi.mocked(sendAdminDailySummaries).mockResolvedValueOnce({ sent: 3, failed: 0 });
    vi.mocked(sendOrganizerDailySummaries).mockResolvedValueOnce({ sent: 5, failed: 1 });
    vi.mocked(sendEventDailySummaries).mockResolvedValueOnce({ sent: 2, failed: 0 });

    const res = await POST(makeRequest({ "x-cron-secret": "test-secret" }));
    const body = await res.json();

    expect(sendAdminDailySummaries).toHaveBeenCalledWith(dayStart, dayEnd);
    expect(sendOrganizerDailySummaries).toHaveBeenCalledWith(dayStart, dayEnd);
    expect(sendEventDailySummaries).toHaveBeenCalledWith(dayStart, dayEnd);
    expect(body).toEqual({ adminsSent: 3, adminsFailed: 0, organizersSent: 5, organizersFailed: 1, eventsSent: 2, eventsFailed: 0 });
  });
});
