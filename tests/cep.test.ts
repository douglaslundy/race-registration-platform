import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCep, isValidCep, fetchAddressByCep } from "@/lib/cep";

describe("normalizeCep", () => {
  it("formata 8 dígitos como 00000-000", () => {
    expect(normalizeCep("01310100")).toBe("01310-100");
  });

  it("remove pontuação/máscara antes de formatar", () => {
    expect(normalizeCep("01310-100")).toBe("01310-100");
  });

  it("devolve só os dígitos quando o tamanho não é 8 (entrada parcial)", () => {
    expect(normalizeCep("0131")).toBe("0131");
  });
});

describe("isValidCep", () => {
  it("aceita 8 dígitos, com ou sem máscara", () => {
    expect(isValidCep("01310-100")).toBe(true);
    expect(isValidCep("01310100")).toBe(true);
  });

  it("rejeita tamanho errado", () => {
    expect(isValidCep("0131")).toBe(false);
    expect(isValidCep("013101000")).toBe(false);
  });

  it("rejeita string vazia", () => {
    expect(isValidCep("")).toBe(false);
  });
});

describe("fetchAddressByCep", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("retorna o endereço quando o ViaCEP responde com sucesso", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        logradouro: "Praça da Sé",
        bairro: "Sé",
        localidade: "São Paulo",
        uf: "SP",
      }),
    } as Response);

    const result = await fetchAddressByCep("01001-000");

    expect(global.fetch).toHaveBeenCalledWith("https://viacep.com.br/ws/01001000/json/");
    expect(result).toEqual({ street: "Praça da Sé", neighborhood: "Sé", city: "São Paulo", state: "SP" });
  });

  it("retorna null quando o ViaCEP responde { erro: true } (CEP inexistente)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ erro: true }),
    } as Response);

    const result = await fetchAddressByCep("00000-000");

    expect(result).toBeNull();
  });

  it("retorna null quando a resposta HTTP não é ok", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({ ok: false } as Response);

    const result = await fetchAddressByCep("01001-000");

    expect(result).toBeNull();
  });

  it("retorna null quando o fetch lança (erro de rede/timeout), sem propagar o erro", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("network error"));

    const result = await fetchAddressByCep("01001-000");

    expect(result).toBeNull();
  });

  it("retorna null sem chamar fetch quando o CEP não tem 8 dígitos", async () => {
    const result = await fetchAddressByCep("123");

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("retorna null quando a resposta HTTP é ok mas o corpo não é JSON válido", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token in JSON");
      },
    } as unknown as Response);

    const result = await fetchAddressByCep("01001-000");

    expect(result).toBeNull();
  });
});
