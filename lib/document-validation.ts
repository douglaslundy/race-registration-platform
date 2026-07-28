function onlyDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

function isValidCpf(raw: string): boolean {
  const cpf = onlyDigits(raw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split("").map(Number);
  const dv1 = calcCheckDigit(digits, 9);
  const dv2 = calcCheckDigit(digits, 10);
  return dv1 === digits[9] && dv2 === digits[10];
}

function isValidCnpj(raw: string): boolean {
  const cnpj = onlyDigits(raw);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const digits = cnpj.split("").map(Number);
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const dv1 = calcCnpjCheckDigit(digits.slice(0, 12), weights1);
  const dv2 = calcCnpjCheckDigit(digits.slice(0, 12).concat(dv1), weights2);
  return dv1 === digits[12] && dv2 === digits[13];
}

function calcCheckDigit(digits: number[], length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += digits[i] * (length + 1 - i);
  }
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

function calcCnpjCheckDigit(digits: number[], weights: number[]): number {
  const sum = digits.reduce((acc, digit, i) => acc + digit * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidDocument(raw: string): boolean {
  const digits = onlyDigits(raw);
  if (digits.length === 11) return isValidCpf(raw);
  if (digits.length === 14) return isValidCnpj(raw);
  return false;
}
