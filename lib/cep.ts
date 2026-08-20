export function normalizeCep(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 8) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function isValidCep(cep: string): boolean {
  const digits = cep.replace(/\D/g, "");
  return digits.length === 8;
}

export interface CepAddress {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

interface ViaCepResponse {
  erro?: boolean;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
}

/** Busca endereço via ViaCEP (API pública, sem autenticação, chamada direto do cliente). Nunca
 * lança — erro de rede, timeout, CEP mal formado ou resposta { erro: true } (CEP inexistente)
 * todos retornam null; o chamador trata null como "autocomplete indisponível, preencher manual". */
export async function fetchAddressByCep(cep: string): Promise<CepAddress | null> {
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return null;

  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    if (!res.ok) return null;

    const data = (await res.json()) as ViaCepResponse;
    if (data.erro) return null;

    return {
      street: data.logradouro ?? "",
      neighborhood: data.bairro ?? "",
      city: data.localidade ?? "",
      state: data.uf ?? "",
    };
  } catch {
    return null;
  }
}
