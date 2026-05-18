import { vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    event: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    registration: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    order: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    payment: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));
