import { db } from "./db";
import { getEventDisplayStatus, type BatchForStatus } from "./batch-status";
import type { EventStatus } from "@prisma/client";

export class BibNumberError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const CLOSED_STATUSES = ["REGISTRATIONS_CLOSED", "COMPLETED"];

/** Usa o status EFETIVO (lotes + data): o `status` persistido continua REGISTRATIONS_OPEN depois
 * que os lotes acabam ou a data passa, e o evento aparece como "Encerrado" pro organizador. */
export function areBibNumbersAvailable(event: {
  generateBibNumbers: boolean;
  status: EventStatus;
  startAt: Date;
  ticketBatches: BatchForStatus[];
}): boolean {
  return (
    event.generateBibNumbers &&
    CLOSED_STATUSES.includes(getEventDisplayStatus(event.status, event.ticketBatches, event.startAt))
  );
}
/** Numera os inscritos CONFIRMED do evento de 1..N pela ordem cronológica de inscrição
 * (`createdAt`, desempate por id). Pendentes/cancelados ficam sem número. Só roda com o evento
 * marcado para gerar número de peito, com inscrições encerradas e antes de qualquer entrega de
 * kit (renumerar depois invalidaria peitos já entregues). Reexecutar refaz a numeração. */
export async function generateBibNumbers(eventId: string): Promise<{ total: number }> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { generateBibNumbers: true, status: true, startAt: true, ticketBatches: true },
  });
  if (!event) throw new BibNumberError("Evento não encontrado", 404);
  if (!event.generateBibNumbers) {
    throw new BibNumberError("Este evento não está configurado para gerar número de peito", 409);
  }
  if (!areBibNumbersAvailable(event)) {
    throw new BibNumberError("Encerre as inscrições do evento antes de gerar os números de peito", 409);
  }
  const delivered = await db.kitDelivery.count({ where: { registration: { eventId } } });
  if (delivered > 0) {
    throw new BibNumberError("Já existem kits entregues; não é possível renumerar", 409);
  }

  const [, total] = await db.$transaction([
    db.$executeRaw`UPDATE "registrations" SET "bibNumber" = NULL
      WHERE "eventId" = ${eventId} AND "status" <> 'CONFIRMED' AND "bibNumber" IS NOT NULL`,
    db.$executeRaw`UPDATE "registrations" r SET "bibNumber" = x.n::text
      FROM (
        SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS n
        FROM "registrations" WHERE "eventId" = ${eventId} AND "status" = 'CONFIRMED'
      ) x WHERE r."id" = x."id"`,
  ]);
  return { total };
}
