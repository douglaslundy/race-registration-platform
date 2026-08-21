import { describe, expect, it } from "vitest";
import { canCancelPendingRegistration, PENDING_CANCELLATION_THRESHOLD_HOURS } from "@/lib/registrations/pending-cancellation";

const HOUR = 60 * 60 * 1000;
const PENDING_PAYMENT = { status: "PENDING" };

describe("canCancelPendingRegistration", () => {
  it("retorna false quando o status não é PENDING_PAYMENT, mesmo há muito tempo criada", () => {
    const old = new Date(Date.now() - 10 * HOUR);
    expect(canCancelPendingRegistration({ status: "CONFIRMED", createdAt: old }, PENDING_PAYMENT)).toBe(false);
    expect(canCancelPendingRegistration({ status: "CANCELLED", createdAt: old }, PENDING_PAYMENT)).toBe(false);
    expect(canCancelPendingRegistration({ status: "CANCELLATION_REQUESTED", createdAt: old }, PENDING_PAYMENT)).toBe(false);
  });

  it(`retorna false quando PENDING_PAYMENT mas com menos de ${PENDING_CANCELLATION_THRESHOLD_HOURS}h de criada`, () => {
    const recent = new Date(Date.now() - (PENDING_CANCELLATION_THRESHOLD_HOURS * HOUR - 60_000));
    expect(canCancelPendingRegistration({ status: "PENDING_PAYMENT", createdAt: recent }, PENDING_PAYMENT)).toBe(false);
  });

  it("retorna false bem no limiar, um pouco antes de completar as 4h", () => {
    const almostThere = new Date(Date.now() - HOUR * 3.99);
    expect(canCancelPendingRegistration({ status: "PENDING_PAYMENT", createdAt: almostThere }, PENDING_PAYMENT)).toBe(false);
  });

  it(`retorna true quando PENDING_PAYMENT e com mais de ${PENDING_CANCELLATION_THRESHOLD_HOURS}h de criada`, () => {
    const old = new Date(Date.now() - (PENDING_CANCELLATION_THRESHOLD_HOURS * HOUR + 60_000));
    expect(canCancelPendingRegistration({ status: "PENDING_PAYMENT", createdAt: old }, PENDING_PAYMENT)).toBe(true);
  });

  it("retorna true exatamente nas 4h (limite inclusivo)", () => {
    const exact = new Date(Date.now() - PENDING_CANCELLATION_THRESHOLD_HOURS * HOUR);
    expect(canCancelPendingRegistration({ status: "PENDING_PAYMENT", createdAt: exact }, PENDING_PAYMENT)).toBe(true);
  });

  it("retorna false quando a inscrição já seria elegível por status+idade, mas o último Payment não está PENDING (caso 'vaga fantasma', tratado à parte)", () => {
    const old = new Date(Date.now() - (PENDING_CANCELLATION_THRESHOLD_HOURS * HOUR + 60_000));
    expect(canCancelPendingRegistration({ status: "PENDING_PAYMENT", createdAt: old }, { status: "EXPIRED" })).toBe(false);
    expect(canCancelPendingRegistration({ status: "PENDING_PAYMENT", createdAt: old }, { status: "CANCELLED" })).toBe(false);
    expect(canCancelPendingRegistration({ status: "PENDING_PAYMENT", createdAt: old }, null)).toBe(false);
    expect(canCancelPendingRegistration({ status: "PENDING_PAYMENT", createdAt: old }, undefined)).toBe(false);
  });
});
