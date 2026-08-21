import type { EventStatus } from "@prisma/client";

export type BatchStatus = "ACTIVE" | "SOLD_OUT" | "CLOSED" | "UPCOMING" | "INACTIVE";

export type BatchForStatus = {
  id: string;
  soldCount: number;
  capacity: number;
  startAt: Date;
  endAt: Date;
  active: boolean;
  activationMode: string;
};

export function getBatchStatus(batch: BatchForStatus, allBatches: BatchForStatus[]): BatchStatus {
  const now = new Date();

  if (batch.soldCount >= batch.capacity) return "SOLD_OUT";
  if (batch.endAt < now) return "CLOSED";
  // startAt é um limite absoluto em qualquer modo de ativação — nenhum lote fica ACTIVE
  // antes da própria data de início, nem mesmo em modo MANUAL.
  if (batch.startAt > now) return "UPCOMING";

  if (batch.activationMode === "DATE") {
    return "ACTIVE";
  }

  if (batch.activationMode === "AFTER_PREVIOUS") {
    const sorted = [...allBatches].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    const idx = sorted.findIndex((b) => b.id === batch.id);
    if (idx <= 0) {
      return "ACTIVE";
    }
    const prev = sorted[idx - 1];
    const prevStatus = getBatchStatus(prev, allBatches);
    if (prevStatus === "SOLD_OUT" || prevStatus === "CLOSED") return "ACTIVE";
    return "UPCOMING";
  }

  // MANUAL
  return batch.active ? "ACTIVE" : "INACTIVE";
}

export function isBatchAvailable(batch: BatchForStatus, allBatches: BatchForStatus[]): boolean {
  return getBatchStatus(batch, allBatches) === "ACTIVE";
}

/**
 * Status "efetivo" de um evento pra fins de exibição (badge + botão de inscrição), reconciliando
 * `Event.status` (campo persistido, só muda por ação explícita de admin/organizador ou pelas rotas
 * de aprovação/arquivamento — nunca é recalculado automaticamente a partir dos lotes) com a
 * disponibilidade REAL dos lotes (calculada em tempo real por `getBatchStatus`).
 *
 * Bug que isso corrige: com `status="REGISTRATIONS_OPEN"` só no banco mas todos os lotes esgotados
 * (soldCount >= capacity em todos), o card de evento mostrava as DUAS mensagens ao mesmo tempo —
 * badge "Inscrições abertas" (lido direto de `event.status`) e, embaixo, o botão desabilitado
 * "Inscrições fechadas"/"Esgotado" (calculado a partir dos lotes) — contraditório pro usuário.
 *
 * Só reinterpreta o status quando o valor persistido é `REGISTRATIONS_OPEN` (os demais status —
 * DRAFT, UNDER_REVIEW, PUBLISHED, REGISTRATIONS_CLOSED, COMPLETED, CANCELLED — já são explícitos e
 * não dependem do estado dos lotes). A badge e o botão de CTA devem sempre consultar ESTE valor, e
 * nunca `event.status` cru, pra nunca mais divergirem entre si.
 */
export function getEventDisplayStatus(
  status: EventStatus,
  batches: BatchForStatus[],
): EventStatus {
  if (status !== "REGISTRATIONS_OPEN") return status;
  if (batches.length === 0) return status;

  const statuses = batches.map((b) => getBatchStatus(b, batches));
  if (statuses.includes("ACTIVE")) return status;
  // INACTIVE (lote MANUAL desativado pelo organizador, mas ainda dentro da janela de datas) entra
  // no mesmo balde que UPCOMING: não é "fechado" de verdade, é "ainda não aberto" — tratar como
  // fechado seria regressão (antes desta função existir, esse caso indevidamente aparecia como
  // aberto; jogar pra "Encerrado" é indevido também, e pior pro organizador).
  if (statuses.includes("UPCOMING") || statuses.includes("INACTIVE")) return "PUBLISHED";
  if (statuses.includes("SOLD_OUT")) return "SOLD_OUT";
  return "REGISTRATIONS_CLOSED";
}
