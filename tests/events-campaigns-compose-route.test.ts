import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET as VARIABLES } from "@/app/api/events/[id]/campaigns/variables/route";
import { GET as ALERT_OPTIONS } from "@/app/api/events/[id]/campaigns/alert-options/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("GET /api/events/[id]/campaigns/variables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
  });

  it("inclui variáveis de Evento, já que a campanha tem um evento associado", async () => {
    const res = await VARIABLES(new Request("http://localhost") as any, { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    const names = data.variables.map((v: any) => v.name);
    expect(names).toContain("nome_evento");
    expect(names).toContain("nome_atleta");
  });

  it("bloqueia quando o organizador não tem campaignsEnabled", async () => {
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: false });

    const res = await VARIABLES(new Request("http://localhost") as any, { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/events/[id]/campaigns/alert-options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
    dbMock.messageTemplate.findFirst.mockResolvedValue(null);
  });

  it("só lista alertas WhatsApp voltados a atleta/comprador", async () => {
    const res = await ALERT_OPTIONS(new Request("http://localhost") as any, { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    const keys = data.options.map((o: any) => o.alertKey);
    expect(keys).toContain("ORDER_CONFIRMED");
    expect(keys).toContain("ABANDONED_CART");
    expect(keys).not.toContain("RECONCILIATION_MISMATCH");
    expect(keys).not.toContain("LOW_STOCK");
    expect(keys).not.toContain("DAILY_SUMMARY");
  });

  it("cada opção retorna o texto efetivo (renderizável) do alerta", async () => {
    const res = await ALERT_OPTIONS(new Request("http://localhost") as any, { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    const orderConfirmed = data.options.find((o: any) => o.alertKey === "ORDER_CONFIRMED");
    // Nota: o corpo WHATSAPP de ORDER_CONFIRMED (registry.ts) não usa {{nome_atleta}} — só a
    // variante EMAIL usa. Verificamos {{codigo_confirmacao}}, que está presente nos dois canais e
    // já é travado por outro teste existente (notifications.test.ts:458) com o texto exato.
    expect(orderConfirmed.body).toContain("{{codigo_confirmacao}}");
  });
});
