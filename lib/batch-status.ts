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

  if (batch.activationMode === "DATE") {
    return batch.startAt <= now ? "ACTIVE" : "UPCOMING";
  }

  if (batch.activationMode === "AFTER_PREVIOUS") {
    const sorted = [...allBatches].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    const idx = sorted.findIndex((b) => b.id === batch.id);
    if (idx <= 0) {
      return batch.startAt <= now ? "ACTIVE" : "UPCOMING";
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
