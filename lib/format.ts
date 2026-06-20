import { format as formatDateFns } from "date-fns";

export function formatCurrency(amountCents: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(amountCents / 100);
}

export function formatDate(date: Date | string, pattern = "dd/MM/yyyy"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatDateFns(d, pattern);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function calculatePlatformFee(amountCents: number, feeBps: number): number {
  return Math.round((amountCents * feeBps) / 10000);
}
