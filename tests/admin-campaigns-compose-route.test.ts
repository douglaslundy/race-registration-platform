import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET as VARIABLES } from "@/app/api/admin/campaigns/variables/route";
import { GET as ALERT_OPTIONS } from "@/app/api/admin/campaigns/alert-options/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("GET /api/admin/campaigns/variables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("não inclui variáveis de Evento numa campanha de plataforma", async () => {
    const res = await VARIABLES(new Request("http://localhost") as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    const names = data.variables.map((v: any) => v.name);
    expect(names).not.toContain("nome_evento");
    expect(names).toContain("nome_atleta");
  });

  it("rejeita ORGANIZER", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await VARIABLES(new Request("http://localhost") as any);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/campaigns/alert-options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.messageTemplate.findFirst.mockResolvedValue(null);
  });

  it("só lista alertas WhatsApp voltados a atleta/comprador", async () => {
    const res = await ALERT_OPTIONS(new Request("http://localhost") as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    const keys = data.options.map((o: any) => o.alertKey);
    expect(keys).toContain("ORDER_CONFIRMED");
    expect(keys).not.toContain("RECONCILIATION_MISMATCH");
  });
});
