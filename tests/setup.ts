import { vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    event: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    ticketBatch: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    registration: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    order: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    payment: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    coupon: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    transferPayout: { findMany: vi.fn(), count: vi.fn() },
    refund: { aggregate: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    platformSetting: { findUnique: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    athleteProfile: { upsert: vi.fn() },
    organizerProfile: { upsert: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn({
      user: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      ticketBatch: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      event: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      order: { count: vi.fn() },
      registration: { count: vi.fn() },
      coupon: { findFirst: vi.fn(), update: vi.fn() },
      platformSetting: { findUnique: vi.fn(), upsert: vi.fn() },
      auditLog: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    })),
  },
}));
