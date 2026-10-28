// Formatação compartilhada entre servidor e cliente (pt-BR).

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimal2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

export function formatBRL(value: number): string {
  // Evita "-R$ 0,00" para zeros negativos vindos de arredondamento.
  return brl.format(Object.is(value, -0) ? 0 : value);
}

/** Valor com sinal explícito (+/−), usado no livro-caixa. */
export function formatSignedBRL(value: number): string {
  if (value === 0) return formatBRL(0);
  return `${value > 0 ? "+" : "−"} ${formatBRL(Math.abs(value))}`;
}

export function formatAmount(value: number): string {
  return decimal2.format(value);
}

export function formatInteger(value: number): string {
  return integer.format(value);
}

export function formatPercent(ratio: number): string {
  return percent.format(ratio);
}

export function formatCents(cents: number): string {
  return formatBRL(cents / 100);
}

export function centsToNumber(cents: number): number {
  return Math.round(cents) / 100;
}

export function numberToCents(value: number): number {
  return Math.round(value * 100);
}

/** Converte "1.234,56", "1234.56" ou "R$ 10" em centavos. Retorna null quando inválido. */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[^\d,.-]/g, "").trim();
  if (!cleaned) return null;
  let normalized = cleaned;
  if (cleaned.includes(",")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function formatOrderNumber(n: number): string {
  return `PED-${String(n).padStart(5, "0")}`;
}

export function formatRecordNumber(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(5, "0")}`;
}

export function onlyDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function formatPhone(digits: string | null | undefined): string {
  const d = onlyDigits(digits);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 13 && d.startsWith("55")) return `+55 ${formatPhone(d.slice(2))}`;
  return d;
}

export function formatCnpj(digits: string | null | undefined): string {
  const d = onlyDigits(digits);
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Link do WhatsApp (wa.me) para um telefone brasileiro. */
export function whatsappLink(digits: string | null | undefined): string | null {
  const d = onlyDigits(digits);
  if (d.length < 10) return null;
  const full = d.length <= 11 ? `55${d}` : d;
  return `https://wa.me/${full}`;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${formatInteger(count)} ${count === 1 ? singular : plural}`;
}

/** Variação percentual entre dois valores; null quando não há base de comparação. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}
