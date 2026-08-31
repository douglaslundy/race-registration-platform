import { describe, it, expect, afterAll } from "vitest";
import { formatCurrency, slugify, calculateAge, formatDateOnly } from "@/lib/format";

/** Força o fuso do processo pra reproduzir produção (container roda TZ=America/Sao_Paulo, UTC-3).
 * Datas de nascimento são datas de calendário guardadas como meia-noite UTC; qualquer render que
 * dependa do fuso local as joga pro dia anterior. Node re-lê process.env.TZ a cada operação de Date. */
const ORIGINAL_TZ = process.env.TZ;
function withTZ(tz: string, fn: () => void) {
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("calculateAge", () => {
  it("calcula idade quando o aniversário já passou no ano de referência", () => {
    expect(calculateAge(new Date("1990-03-15"), new Date("2026-08-20"))).toBe(36);
  });

  it("calcula idade quando o aniversário ainda não chegou no ano de referência (não é só diferença de anos)", () => {
    expect(calculateAge(new Date("1990-12-15"), new Date("2026-08-20"))).toBe(35);
  });

  it("calcula idade no dia exato do aniversário", () => {
    expect(calculateAge(new Date("1990-08-20"), new Date("2026-08-20"))).toBe(36);
  });

  it("calcula idade um dia antes do aniversário (mesmo mês)", () => {
    expect(calculateAge(new Date("1990-08-21"), new Date("2026-08-20"))).toBe(35);
  });

  it("não desloca a data de nascimento pelo fuso local numa virada de mês", () => {
    withTZ("America/Sao_Paulo", () => {
      // nascido 01/03/2000 (salvo meia-noite UTC); referência 01/03/2026 → 26 anos exatos.
      // Com getters locais, ambos caem em 28/29-fev e o cálculo erra pra 25.
      expect(calculateAge(new Date("2000-03-01T00:00:00.000Z"), new Date("2026-03-01T00:00:00.000Z"))).toBe(26);
    });
  });
});

describe("formatDateOnly", () => {
  it("imprime o dia de calendário guardado, independente do fuso (bug: exportava 07/09 em vez de 08/09)", () => {
    withTZ("America/Sao_Paulo", () => {
      expect(formatDateOnly(new Date("1986-09-08T00:00:00.000Z"))).toBe("08/09/1986");
    });
  });

  it("funciona igual em fuso à frente de UTC", () => {
    withTZ("Asia/Tokyo", () => {
      expect(formatDateOnly(new Date("1986-09-08T00:00:00.000Z"))).toBe("08/09/1986");
    });
  });

  it("aceita string ISO date-only", () => {
    withTZ("America/Sao_Paulo", () => {
      expect(formatDateOnly("2000-01-01")).toBe("01/01/2000");
    });
  });

  it("respeita um pattern customizado", () => {
    withTZ("America/Sao_Paulo", () => {
      expect(formatDateOnly(new Date("1986-09-08T00:00:00.000Z"), "yyyy-MM-dd")).toBe("1986-09-08");
    });
  });
});

describe("formatCurrency", () => {
  it("formats BRL centavos correctly", () => {
    expect(formatCurrency(10000)).toBe("R$ 100,00");
  });

  it("handles zero", () => {
    expect(formatCurrency(0)).toBe("R$ 0,00");
  });

  it("handles odd cents", () => {
    expect(formatCurrency(9999)).toBe("R$ 99,99");
  });
});

describe("slugify", () => {
  it("converts portuguese text to slug", () => {
    expect(slugify("Corrida das Pedras 2025")).toBe("corrida-das-pedras-2025");
  });

  it("handles accents", () => {
    expect(slugify("São Paulo")).toBe("sao-paulo");
  });

  it("removes leading/trailing hyphens", () => {
    expect(slugify("  test  ")).toBe("test");
  });
});
