import "server-only";
import { addDaysToDate, parseLocalDateTime, startOfLocalDay, todayString } from "@/lib/dates";
import { DomainError, isUniqueViolation } from "@/server/errors";

const MIN_DATE = new Date("2000-01-01T00:00:00Z");

/**
 * Converte data/hora informada no fuso do negócio e rejeita datas futuras
 * (movimentos financeiros e de estoque só podem ser registrados depois de acontecerem).
 */
export function parseBusinessDateTime(value: string, tz: string, label: string, field?: string): Date {
  const date = parseLocalDateTime(value, tz);
  if (!date) throw new DomainError(`Informe ${label} corretamente.`, "INVALID_DATE", field);
  const limit = startOfLocalDay(addDaysToDate(todayString(tz), 1), tz);
  if (date.getTime() >= limit.getTime()) {
    throw new DomainError(`${capitalize(label)} não pode estar no futuro.`, "FUTURE_DATE", field);
  }
  if (date.getTime() < MIN_DATE.getTime()) {
    throw new DomainError(`Informe ${label} corretamente.`, "INVALID_DATE", field);
  }
  return date;
}

/**
 * Executa uma operação protegida por chave de idempotência. Se outra requisição com a
 * mesma chave venceu a corrida (violação de unicidade), devolve o registro já gravado.
 */
export async function runIdempotent<T>(
  key: string | undefined,
  run: () => Promise<T>,
  findExisting: () => Promise<T | null>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (key && isUniqueViolation(error)) {
      const existing = await findExisting();
      if (existing) return existing;
    }
    throw error;
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
