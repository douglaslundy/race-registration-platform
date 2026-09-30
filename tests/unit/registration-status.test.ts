import { describe, expect, it } from "vitest";
import { getRegistrationDisplayStatusKey } from "@/lib/registration-status";

describe("getRegistrationDisplayStatusKey", () => {
  it("mantém CONFIRMED quando o evento ainda não aconteceu", () => {
    const eventStartAt = new Date("2099-01-01T00:00:00Z");
    const now = new Date("2026-01-01T00:00:00Z");
    expect(getRegistrationDisplayStatusKey("CONFIRMED", eventStartAt, now)).toBe("CONFIRMED");
  });

  it("vira COMPLETED quando CONFIRMED e o evento já aconteceu", () => {
    const eventStartAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-02T00:00:00Z");
    expect(getRegistrationDisplayStatusKey("CONFIRMED", eventStartAt, now)).toBe("COMPLETED");
  });

  it("vira COMPLETED no exato instante em que o evento começa", () => {
    const eventStartAt = new Date("2026-01-01T08:00:00Z");
    expect(getRegistrationDisplayStatusKey("CONFIRMED", eventStartAt, eventStartAt)).toBe("COMPLETED");
  });

  it("nunca muda outros status mesmo com o evento já tendo acontecido", () => {
    const eventStartAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-02T00:00:00Z");
    expect(getRegistrationDisplayStatusKey("PENDING_PAYMENT", eventStartAt, now)).toBe("PENDING_PAYMENT");
    expect(getRegistrationDisplayStatusKey("CANCELLED", eventStartAt, now)).toBe("CANCELLED");
    expect(getRegistrationDisplayStatusKey("TRANSFERRED", eventStartAt, now)).toBe("TRANSFERRED");
    expect(getRegistrationDisplayStatusKey("WAITLISTED", eventStartAt, now)).toBe("WAITLISTED");
    expect(getRegistrationDisplayStatusKey("CANCELLATION_REQUESTED", eventStartAt, now)).toBe("CANCELLATION_REQUESTED");
  });
});
