import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/reconciliation", () => ({ reconcilePayments: vi.fn() }));

import { POST } from "@/app/api/admin/reconciliation/route";
import { reconcilePayments } from "@/lib/payment/reconciliation";

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("POST /api/admin/reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(reconcilePayments).not.toHaveBeenCalled();
  });

  it("roda a conciliação sem filtro de organizador e retorna o resultado", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 5, mismatches: [] });

    const res = await POST();
    const body = await res.json();

    expect(reconcilePayments).toHaveBeenCalledWith();
    expect(body).toEqual({ checked: 5, mismatches: [] });
  });

  it("assistente de admin com a permissão concilia a plataforma inteira", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 5, mismatches: [] });

    const res = await POST();

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST();

    expect(res.status).toBe(403);
    expect(reconcilePayments).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST();

    expect(res.status).toBe(403);
  });
});
