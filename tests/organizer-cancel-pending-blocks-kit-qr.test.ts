import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// Ao contrário de tests/organizer-cancel-pending-registration-route.test.ts (que mocka
// cancelExpiredPayment pra testar só a lógica da rota em isolamento), este arquivo deixa
// cancelExpiredPayment rodar de verdade (só o $transaction do Prisma é mockado) pra provar,
// ponta a ponta, que o cancelamento manual do organizador realmente grava
// `Registration.status = "CANCELLED"` no banco — e portanto passa a falhar tanto no gate de QR
// code de "Minha inscrição" (`isConfirmed = registration.status === "CONFIRMED"`,
// app/dashboard/inscricoes/[id]/page.tsx) quanto no filtro `status: "CONFIRMED"` que
// findRegistrationForKitDelivery usa pro balcão físico de retirada (lib/kit-delivery.ts,
// já coberto por tests/lib-kit-delivery.test.ts).
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/alerts/payment-error", () => ({ notifyPaymentError: vi.fn() }));

import { POST } from "@/app/api/organizer/registrations/[id]/cancel-pending/route";
import { notifyPaymentError } from "@/lib/alerts/payment-error";
import { findRegistrationForKitDelivery } from "@/lib/kit-delivery";

const authMock = vi.mocked(auth);
const notifyPaymentErrorMock = vi.mocked(notifyPaymentError);
const dbMock = db as any;

const HOUR = 60 * 60 * 1000;

function makeRequest() {
  return new Request("http://localhost/api/organizer/registrations/reg-1/cancel-pending", {
    method: "POST",
  }) as any;
}

describe("cancelamento manual do organizador bloqueia o QR code de retirada de kit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "org-1" });
  });

  it("grava status CANCELLED na Registration, libera a vaga do lote e dispara a notificação de pagamento não identificado (cancelExpiredPayment real, sem mock)", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      id: "reg-1",
      status: "PENDING_PAYMENT",
      createdAt: new Date(Date.now() - 5 * HOUR),
      order: { id: "order-1", payments: [{ id: "payment-1", status: "PENDING" }] },
    });

    const registrationUpdate = vi.fn();
    const ticketBatchUpdate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        payment: {
          updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValueOnce({
            orderId: "order-1",
            order: { registrations: [{ id: "reg-1", ticketBatchId: "batch-1", status: "PENDING_PAYMENT" }] },
          }),
        },
        order: { update: vi.fn() },
        registration: { update: registrationUpdate },
        ticketBatch: { update: ticketBatchUpdate },
        auditLog: { create: vi.fn() },
      }),
    );

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    // A mesma inscrição vira CANCELLED — o gate `isConfirmed = status === "CONFIRMED"` da tela
    // "Minha inscrição" (app/dashboard/inscricoes/[id]/page.tsx) passa a ser falso, então o bloco
    // do QR code nem é renderizado.
    expect(registrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    // A vaga do lote é liberada — mesmo comportamento do cron de expiração automática.
    expect(ticketBatchUpdate).toHaveBeenCalledWith({ where: { id: "batch-1" }, data: { soldCount: { decrement: 1 } } });
    // O atleta é notificado (mesmo alerta PAYMENT_ERROR usado pelo cron de expiração).
    expect(notifyPaymentErrorMock).toHaveBeenCalledWith("payment-1");
  });

  it("findRegistrationForKitDelivery já filtra status: CONFIRMED — uma inscrição CANCELLED nunca aparece no balcão de retirada de kit", async () => {
    // Não recria a inscrição CANCELLED no banco (mockado) — só confirma que a query real usada
    // pelo balcão físico de retirada já exclui qualquer status diferente de CONFIRMED, incluindo o
    // CANCELLED que o cancelamento manual acima produz.
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await findRegistrationForKitDelivery("event-1", "reg-1");

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "CONFIRMED" }) }),
    );
  });
});
