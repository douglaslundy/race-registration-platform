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

/**
 * Formata uma DATA DE CALENDÁRIO (sem hora relevante) — data de nascimento, prazo, etc. — usando
 * sempre os componentes **UTC** do valor, nunca o fuso do processo/navegador.
 *
 * Datas de nascimento são gravadas como meia-noite UTC (`1986-09-08T00:00:00.000Z`). `formatDate`
 * usa `date-fns/format`, que lê o fuso local: em produção o container roda `TZ=America/Sao_Paulo`
 * (UTC-3), e o navegador do usuário idem, então `08/09` virava `07/09` no CSV/XLSX/PDF e na tela.
 * Este helper reinterpreta os componentes UTC como se fossem locais antes de formatar, então o
 * dia impresso é exatamente o que está no banco em qualquer fuso.
 */
export function formatDateOnly(date: Date | string, pattern = "dd/MM/yyyy"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const asUtcWallClock = new Date(d.getTime() + d.getTimezoneOffset() * 60_000);
  return formatDateFns(asUtcWallClock, pattern);
}

/** `Date` → `yyyy-MM-dd` a partir dos componentes UTC — pra preencher `<input type="date">` sem
 * deslocar o dia pelo fuso local (senão salvar a edição corrompe a data no banco). */
export function toDateInputValue(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** Calcula a idade em anos completos numa data de referência, considerando mês/dia — não é
 * simplesmente a diferença entre os anos (alguém nascido em dezembro não "completa" o ano corrente
 * até o mês de dezembro chegar). Compara os componentes **UTC** dos dois lados: a data de
 * nascimento é uma data de calendário em meia-noite UTC e não pode ser deslocada pelo fuso local. */
export function calculateAge(birthDate: Date, referenceDate: Date = new Date()): number {
  let age = referenceDate.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = referenceDate.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getUTCDate() < birthDate.getUTCDate())) {
    age--;
  }
  return age;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
