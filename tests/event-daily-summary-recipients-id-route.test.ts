import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { DELETE } from "@/app/api/events/[id]/daily-summary-recipients/[recipientId]/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string, recipientId: string) {
  return { params: Promise.resolve({ id, recipientId }) };
}

describe("DELETE /api/events/[id]/daily-summary-recipients/[recipientId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna 404 quando o evento não pertence ao organizador autenticado", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(new Request("http://localhost") as any, makeContext("event-1", "r1"));
    expect(res.status).toBe(404);
    expect(dbMock.dailySummaryRecipient.delete).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o contato não pertence a esse evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", organizer: { userId: "org-1" } });
    dbMock.dailySummaryRecipient.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(new Request("http://localhost") as any, makeContext("event-1", "r1"));

    expect(dbMock.dailySummaryRecipient.findFirst).toHaveBeenCalledWith({ where: { id: "r1", eventId: "event-1" } });
    expect(res.status).toBe(404);
  });

  it("remove o contato quando pertence ao evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1", organizer: { userId: "org-1" } });
    dbMock.dailySummaryRecipient.findFirst.mockResolvedValueOnce({ id: "r1", eventId: "event-1" });

    const res = await DELETE(new Request("http://localhost") as any, makeContext("event-1", "r1"));
    const body = await res.json();

    expect(dbMock.dailySummaryRecipient.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
    expect(body).toEqual({ success: true });
  });
});
