import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "@/lib/checkout";
import { db } from "@/lib/db";

/**
 * Cobre a ÚNICA ligação que congela o snapshot numa inscrição nova: o spread de
 * `participantSnapshotData(resolveParticipantIdentity(...))` dentro do único
 * `tx.registration.create` de `createCheckout` (lib/checkout.ts). Os testes de
 * `checkout-participant-snapshot.test.ts` exercitam só os helpers isolados; aqui
 * o `createCheckout` roda de verdade e asseramos que os 6 `participant*` chegam
 * no `data` do `registration.create` — tanto no caso normal (conta/AthleteProfile)
 * quanto no caso proxy (payload do `input.proxyAthlete`).
 */

const dbMock = db as any;

const ticketBatch = {
  id: "batch-1",
  active: true,
  soldCount: 0,
  capacity: 10,
  priceAmount: 20000,
};

const baseEvent = {
  id: "event-1",
  status: "REGISTRATIONS_OPEN",
  platformFeePercent: 1100,
  allowProxyRegistration: true,
};

function createTx(overrides: Record<string, any> = {}) {
  return {
    ticketBatch: {
      findUnique: vi.fn().mockResolvedValue(ticketBatch),
      findMany: vi.fn().mockResolvedValue([ticketBatch]),
      update: vi.fn().mockResolvedValue({}),
    },
    event: {
      findUnique: vi.fn().mockResolvedValue(baseEvent),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "proxy-user-1", name: "Proxy Nome", email: "proxy@x.com" }),
    },
    athleteProfile: {
      findFirst: vi.fn().mockResolvedValue(null),
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
    order: {
      create: vi.fn().mockResolvedValue({ id: "order-1" }),
    },
    registration: {
      create: vi.fn().mockResolvedValue({ id: "reg-1" }),
    },
    ...overrides,
  };
}

describe("createCheckout → snapshot wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("caso normal: congela os 6 participant* a partir do User + AthleteProfile", async () => {
    const birthDate = new Date("1990-04-12");
    const tx = createTx();
    tx.user.findUnique.mockResolvedValue({
      name: "Conta Nome",
      email: "conta@x.com",
      athleteProfile: { phone: "11999", birthDate, gender: "M", cpf: "39053344705" },
    });

    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "user-1",
      athleteUserId: "user-1",
    });

    expect(tx.registration.create).toHaveBeenCalledTimes(1);
    const data = tx.registration.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      participantName: "Conta Nome",
      participantEmail: "conta@x.com",
      participantPhone: "11999",
      participantBirthDate: birthDate,
      participantGender: "M",
      participantCpf: "39053344705",
    });
    expect(data.athleteUserId).toBe("user-1");
  });

  it("caso proxy: congela os 6 participant* a partir do input.proxyAthlete (gender null)", async () => {
    const tx = createTx();
    // resolveParticipantIdentity ainda faz tx.user.findUnique(id) pro fallback de email;
    // o proxy informou email, então o resultado disso não importa.
    tx.user.findUnique.mockResolvedValue(null);

    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "user-1",
      athleteUserId: "user-1",
      proxyAthlete: {
        name: "Proxy Nome",
        email: "proxy@x.com",
        phone: "1188",
        birthDate: "1988-09-03",
        cpf: "390.533.447-05",
      },
    });

    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.registration.create).toHaveBeenCalledTimes(1);
    const data = tx.registration.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      participantName: "Proxy Nome",
      participantEmail: "proxy@x.com",
      participantPhone: "1188",
      participantGender: null,
      participantCpf: "39053344705",
    });
    expect(data.participantBirthDate).toBeInstanceOf(Date);
    expect((data.participantBirthDate as Date).toISOString()).toBe(new Date("1988-09-03").toISOString());
    expect(data.athleteUserId).toBe("proxy-user-1");
  });
});
