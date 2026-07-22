import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "@/lib/checkout";
import { db } from "@/lib/db";

vi.mock("@/lib/proxy-athlete", () => ({
  generatePlaceholderEmail: vi.fn(() => "placeholder-uuid@sememail.internal"),
}));

const dbMock = db as any;

describe("createCheckout proxy athlete handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ticketBatch = {
    id: "batch-1",
    active: true,
    soldCount: 0,
    capacity: 10,
    priceAmount: 20000,
  };

  const event = {
    id: "event-1",
    status: "REGISTRATIONS_OPEN",
    platformFeePercent: 1100,
    allowProxyRegistration: true,
  };

  const proxyAthleteInput = {
    name: "Maria Atleta",
    birthDate: "1995-05-20",
    cpf: "111.444.777-35",
    phone: "35999998888",
  };

  function createTx(overrides: {
    eventOverride?: Record<string, unknown>;
    existingAthleteProfile?: Record<string, unknown> | null;
    emailTaken?: Record<string, unknown> | null;
    createdUser?: Record<string, unknown>;
  } = {}) {
    return {
      ticketBatch: {
        findUnique: vi.fn().mockResolvedValue(ticketBatch),
        findMany: vi.fn().mockResolvedValue([ticketBatch]),
        update: vi.fn().mockResolvedValue({}),
      },
      event: {
        findUnique: vi.fn().mockResolvedValue({ ...event, ...(overrides.eventOverride ?? {}) }),
      },
      eventRoute: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      eventCategory: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      coupon: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      athleteProfile: {
        findFirst: vi.fn().mockResolvedValue(overrides.existingAthleteProfile ?? null),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(overrides.emailTaken ?? null),
        create: vi.fn().mockResolvedValue(overrides.createdUser ?? { id: "new-athlete-1", name: "Maria Atleta" }),
      },
      order: {
        create: vi.fn().mockResolvedValue({ id: "order-1" }),
      },
      registration: {
        create: vi.fn().mockResolvedValue({ id: "reg-1" }),
      },
    };
  }

  it("rejeita proxyAthlete quando o evento não permite inscrição por procuração", async () => {
    const tx = createTx({ eventOverride: { allowProxyRegistration: false } });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "buyer-1",
        athleteUserId: "buyer-1",
        proxyAthlete: proxyAthleteInput,
      }),
    ).rejects.toThrow("Inscrição por procuração não está habilitada para este evento");
    expect(tx.athleteProfile.findFirst).not.toHaveBeenCalled();
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it("cria uma conta nova pro atleta quando o CPF não bate com nenhuma conta existente", async () => {
    const tx = createTx({ existingAthleteProfile: null });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "buyer-1",
      athleteUserId: "buyer-1",
      proxyAthlete: proxyAthleteInput,
    });

    expect(tx.athleteProfile.findFirst).toHaveBeenCalledWith({ where: { cpf: "11144477735" } });
    expect(tx.user.create).toHaveBeenCalledWith({
      data: {
        name: "Maria Atleta",
        email: "placeholder-uuid@sememail.internal",
        role: "ATHLETE",
        passwordHash: null,
        athleteProfile: {
          create: { cpf: "11144477735", birthDate: new Date("1995-05-20"), phone: "35999998888" },
        },
      },
    });
    expect(tx.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ athleteUserId: "new-athlete-1" }) }),
    );
    expect(result.proxyAthleteInvite).toBeUndefined();
  });

  it("reaproveita a conta existente quando o CPF já está cadastrado (Fase B), sem criar conta nova", async () => {
    const tx = createTx({ existingAthleteProfile: { userId: "existing-athlete-1", cpf: "11144477735" } });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "buyer-1",
      athleteUserId: "buyer-1",
      proxyAthlete: proxyAthleteInput,
    });

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ athleteUserId: "existing-athlete-1" }) }),
    );
  });

  it("usa o e-mail informado quando fornecido, e retorna proxyAthleteInvite", async () => {
    const tx = createTx({
      existingAthleteProfile: null,
      emailTaken: null,
      createdUser: { id: "new-athlete-2", name: "Maria Atleta" },
    });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "buyer-1",
      athleteUserId: "buyer-1",
      proxyAthlete: { ...proxyAthleteInput, email: "maria@example.com" },
    });

    expect(tx.user.findUnique).toHaveBeenCalledWith({ where: { email: "maria@example.com" }, select: { id: true } });
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: "maria@example.com" }) }),
    );
    expect(result.proxyAthleteInvite).toEqual({
      userId: "new-athlete-2",
      name: "Maria Atleta",
      email: "maria@example.com",
    });
  });

  it("rejeita quando o e-mail informado já pertence a outra conta", async () => {
    const tx = createTx({ existingAthleteProfile: null, emailTaken: { id: "other-user" } });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "buyer-1",
        athleteUserId: "buyer-1",
        proxyAthlete: { ...proxyAthleteInput, email: "jatem@example.com" },
      }),
    ).rejects.toThrow("Este e-mail já está em uso por outra conta");
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it("quando o CPF informado é do próprio comprador, a inscrição fica igual a uma normal (mesmo athleteUserId)", async () => {
    const tx = createTx({ existingAthleteProfile: { userId: "buyer-1", cpf: "11144477735" } });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "buyer-1",
      athleteUserId: "buyer-1",
      proxyAthlete: proxyAthleteInput,
    });

    expect(tx.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ athleteUserId: "buyer-1" }) }),
    );
  });

  it("sem proxyAthlete, comportamento idêntico a uma inscrição normal (não consulta athleteProfile por CPF)", async () => {
    const tx = createTx();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "buyer-1",
      athleteUserId: "buyer-1",
    });

    expect(tx.athleteProfile.findFirst).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ athleteUserId: "buyer-1" }) }),
    );
  });
});
