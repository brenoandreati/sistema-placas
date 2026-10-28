import { Prisma } from "@/generated/prisma/client";

// Aritmética monetária exata com decimal.js (via Prisma.Decimal).
// Nunca usar números de ponto flutuante para somar ou multiplicar valores.

export type Dec = Prisma.Decimal;
export const Decimal = Prisma.Decimal;

type DecInput = Prisma.Decimal | string | number | null | undefined;

export function dec(value: DecInput): Dec {
  if (value === null || value === undefined) return new Decimal(0);
  return new Decimal(value.toString());
}

export function fromCents(cents: number): Dec {
  if (!Number.isInteger(cents)) throw new Error("Valor em centavos deve ser inteiro");
  return new Decimal(cents).div(100);
}

export function toCents(value: DecInput): number {
  return dec(value).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Arredonda para centavos (meio para cima). */
export function round2(value: DecInput): Dec {
  return dec(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Custos unitários usam 4 casas decimais (custo médio ponderado). */
export function round4(value: DecInput): Dec {
  return dec(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** Converte para number (reais) apenas para exibição/serialização. */
export function num(value: DecInput): number {
  return round2(value).toNumber();
}

export function numOrNull(value: DecInput): number | null {
  return value === null || value === undefined ? null : dec(value).toNumber();
}

export function sum(values: DecInput[]): Dec {
  return values.reduce<Dec>((acc, v) => acc.add(dec(v)), new Decimal(0));
}

export function maxDec(a: Dec, b: Dec): Dec {
  return a.greaterThan(b) ? a : b;
}
