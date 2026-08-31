import { describe, it, expect, vi } from "vitest";
import {
  resolveParticipantIdentity,
  participantSnapshotData,
  pickParticipantChanges,
} from "@/lib/registrations/participant-identity";

describe("participant-identity", () => {
  it("inscrição normal: identity vem do User + AthleteProfile", async () => {
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          name: "Ana",
          email: "ana@x.com",
          athleteProfile: { phone: "11", birthDate: new Date("1990-01-01"), gender: "F", cpf: "12345678901" },
        }),
      },
    } as any;
    const id = await resolveParticipantIdentity(tx, {}, "u1");
    expect(id).toEqual({
      name: "Ana",
      email: "ana@x.com",
      phone: "11",
      birthDate: new Date("1990-01-01"),
      gender: "F",
      cpf: "12345678901",
    });
  });

  it("proxy: identity vem do payload; email cai no email do user quando o proxy não informou", async () => {
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue({ name: "X", email: "placeholder@local", athleteProfile: null }) },
    } as any;
    const id = await resolveParticipantIdentity(
      tx,
      { proxyAthlete: { name: "Bruno", phone: "22", birthDate: "1985-05-05", cpf: "98765432100" } },
      "u2",
    );
    expect(id.name).toBe("Bruno");
    expect(id.email).toBe("placeholder@local");
    expect(id.gender).toBeNull();
    expect(id.cpf).toBe("98765432100");
  });

  it("participantSnapshotData normaliza o CPF e mapeia os nomes de coluna", () => {
    const d = participantSnapshotData({
      name: "A",
      email: "a@x",
      phone: null,
      birthDate: null,
      gender: null,
      cpf: "123.456.789-01",
    });
    expect(d).toEqual({
      participantName: "A",
      participantEmail: "a@x",
      participantPhone: null,
      participantBirthDate: null,
      participantGender: null,
      participantCpf: "12345678901",
    });
  });

  it("pickParticipantChanges retorna só o que mudou", () => {
    const r = pickParticipantChanges(
      { participantName: "A", participantCpf: "1" },
      { participantName: "B", participantCpf: "1" },
    );
    expect(r).toEqual({ before: { participantName: "A" }, after: { participantName: "B" } });
  });
});
