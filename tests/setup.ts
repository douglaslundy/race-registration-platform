import { vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    event: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    ticketBatch: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    registration: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    order: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
    payment: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    coupon: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    transferPayout: { findMany: vi.fn(), count: vi.fn() },
    resultImport: { count: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    refund: { aggregate: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    fileAsset: { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    platformSetting: { findUnique: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    athleteProfile: { upsert: vi.fn() },
    organizerProfile: { upsert: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn({
      user: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      ticketBatch: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      order: { count: vi.fn() },
      registration: { count: vi.fn() },
      coupon: { findFirst: vi.fn(), update: vi.fn() },
      fileAsset: { deleteMany: vi.fn(), findMany: vi.fn() },
      platformSetting: { findUnique: vi.fn(), upsert: vi.fn() },
      auditLog: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
      event: { delete: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    })),
  },
}));
