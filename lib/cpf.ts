export function normalizeCpf(raw: string): string {
  return raw.replace(/\D/g, "");
}

function calculateCheckDigit(digits: number[], length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += digits[i] * (length + 1 - i);
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

export function isValidCpf(raw: string): boolean {
  const cpf = normalizeCpf(raw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split("").map(Number);
  const dv1 = calculateCheckDigit(digits, 9);
  const dv2 = calculateCheckDigit(digits, 10);

  return dv1 === digits[9] && dv2 === digits[10];
}
