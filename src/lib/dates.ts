import { TZDate } from "@date-fns/tz";
import { addDays, addMonths, addYears, differenceInCalendarDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export const PERIOD_PRESETS = ["today", "7d", "30d", "month", "year", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  month: "Mês atual",
  year: "Ano atual",
  custom: "Personalizado",
};

/** Intervalo semiaberto [start, end) em instantes UTC. */
export interface DateRange {
  start: Date;
  end: Date;
}

export interface Period extends DateRange {
  preset: PeriodPreset;
  label: string;
  /** Datas (yyyy-MM-dd, no fuso do negócio) do primeiro e do último dia incluídos. */
  from: string;
  to: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function isPeriodPreset(value: unknown): value is PeriodPreset {
  return typeof value === "string" && (PERIOD_PRESETS as readonly string[]).includes(value);
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Meia-noite do dia `yyyy-MM-dd` no fuso informado. */
export function startOfLocalDay(dateString: string, tz: string): Date {
  const [y, m, d] = dateString.split("-").map(Number);
  return new Date(new TZDate(y, m - 1, d, 0, 0, 0, tz).getTime());
}

/** Data (yyyy-MM-dd) do instante informado no fuso do negócio. */
export function toLocalDateString(date: Date, tz: string): string {
  return format(new TZDate(date.getTime(), tz), "yyyy-MM-dd");
}

export function todayString(tz: string, now: Date = new Date()): string {
  return toLocalDateString(now, tz);
}

/** Valor para <input type="datetime-local"> no fuso do negócio. */
export function toLocalDateTimeInput(date: Date, tz: string): string {
  return format(new TZDate(date.getTime(), tz), "yyyy-MM-dd'T'HH:mm");
}

/** Converte "yyyy-MM-ddTHH:mm" (horário local do negócio) em instante UTC. */
export function parseLocalDateTime(value: string, tz: string): Date | null {
  const match = DATETIME_RE.exec(value);
  if (!match) {
    if (isDateString(value)) return startOfLocalDay(value, tz);
    return null;
  }
  const [, y, mo, d, h, mi, s] = match;
  const result = new TZDate(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0), tz);
  const time = result.getTime();
  return Number.isNaN(time) ? null : new Date(time);
}

/** Datas sem horário (colunas DATE) são representadas como meia-noite UTC. */
export function dateOnlyToDb(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`);
}

export function dbDateToString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysToDateString(dateString: string, days: number): string {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export { addDaysToDateString as addDaysToDate };

/**
 * Resolve um período de filtro no fuso do negócio.
 * "Mês atual" e "Ano atual" vão do primeiro dia até hoje (inclusive).
 */
export function resolvePeriod(
  preset: PeriodPreset,
  tz: string,
  custom?: { from?: string | null; to?: string | null },
  now: Date = new Date(),
): Period {
  const today = todayString(tz, now);
  let from = today;
  let to = today;

  switch (preset) {
    case "today":
      break;
    case "7d":
      from = addDaysToDateString(today, -6);
      break;
    case "30d":
      from = addDaysToDateString(today, -29);
      break;
    case "month":
      from = `${today.slice(0, 7)}-01`;
      break;
    case "year":
      from = `${today.slice(0, 4)}-01-01`;
      break;
    case "custom": {
      const f = custom?.from && isDateString(custom.from) ? custom.from : addDaysToDateString(today, -29);
      const t = custom?.to && isDateString(custom.to) ? custom.to : today;
      from = f <= t ? f : t;
      to = f <= t ? t : f;
      break;
    }
  }

  const start = startOfLocalDay(from, tz);
  const end = startOfLocalDay(addDaysToDateString(to, 1), tz);
  const label =
    preset === "custom" ? `${formatDateString(from)} a ${formatDateString(to)}` : PERIOD_LABELS[preset];
  return { preset, label, start, end, from, to };
}

/**
 * Período anterior equivalente, usado nas comparações.
 * Para mês/ano atual compara com o mesmo número de dias do mês/ano anterior.
 */
export function previousPeriod(period: Period, tz: string): Period {
  const days = differenceInCalendarDays(new Date(`${period.to}T00:00:00Z`), new Date(`${period.from}T00:00:00Z`)) + 1;
  let from: string;
  if (period.preset === "month") {
    from = format(addMonths(new Date(`${period.from}T12:00:00Z`), -1), "yyyy-MM-dd");
  } else if (period.preset === "year") {
    from = format(addYears(new Date(`${period.from}T12:00:00Z`), -1), "yyyy-MM-dd");
  } else {
    from = addDaysToDateString(period.from, -days);
  }
  const to = addDaysToDateString(from, days - 1);
  return {
    preset: "custom",
    label: `${formatDateString(from)} a ${formatDateString(to)}`,
    start: startOfLocalDay(from, tz),
    end: startOfLocalDay(addDaysToDateString(to, 1), tz),
    from,
    to,
  };
}

export function periodLengthInDays(period: Pick<Period, "from" | "to">): number {
  return (
    differenceInCalendarDays(new Date(`${period.to}T00:00:00Z`), new Date(`${period.from}T00:00:00Z`)) + 1
  );
}

/** Lista as chaves de agrupamento (dia ou mês) cobertas pelo período. */
export function periodBuckets(period: Pick<Period, "from" | "to">, granularity: "day" | "month"): string[] {
  const keys: string[] = [];
  if (granularity === "day") {
    let cursor = period.from;
    while (cursor <= period.to) {
      keys.push(cursor);
      cursor = addDaysToDateString(cursor, 1);
    }
    return keys;
  }
  let cursor = new Date(`${period.from.slice(0, 7)}-01T12:00:00Z`);
  const last = period.to.slice(0, 7);
  while (format(cursor, "yyyy-MM") <= last) {
    keys.push(format(cursor, "yyyy-MM"));
    cursor = addMonths(cursor, 1);
  }
  return keys;
}

export function bucketGranularity(period: Pick<Period, "from" | "to">): "day" | "month" {
  return periodLengthInDays(period) > 62 ? "month" : "day";
}

// ───────────── Formatação ─────────────

export function formatDateString(dateString: string): string {
  const [y, m, d] = dateString.split("-");
  return `${d}/${m}/${y}`;
}

export function formatDate(date: Date | string, tz: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(new TZDate(d.getTime(), tz), "dd/MM/yyyy");
}

export function formatDateTime(date: Date | string, tz: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(new TZDate(d.getTime(), tz), "dd/MM/yyyy HH:mm");
}

export function formatLongDate(date: Date, tz: string): string {
  return format(new TZDate(date.getTime(), tz), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
}

export function formatBucketLabel(key: string, granularity: "day" | "month"): string {
  if (granularity === "day") {
    const [, m, d] = key.split("-");
    return `${d}/${m}`;
  }
  const date = new Date(`${key}-01T12:00:00Z`);
  const label = format(date, "MMM/yy", { locale: ptBR });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function daysBetweenDateStrings(from: string, to: string): number {
  return differenceInCalendarDays(new Date(`${to}T00:00:00Z`), new Date(`${from}T00:00:00Z`));
}

export function addDaysToNow(days: number): Date {
  return addDays(new Date(), days);
}
