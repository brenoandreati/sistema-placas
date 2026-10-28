import { z } from "zod";
import { isDateString } from "@/lib/dates";
import { onlyDigits } from "@/lib/format";

// Schemas compartilhados entre formulários (cliente) e server actions (servidor).
// Valores monetários trafegam como centavos inteiros para evitar erros de ponto flutuante.

export const MAX_CENTS = 99_999_999_999; // R$ 999.999.999,99

export const uuid = z.uuid("Identificador inválido.");

export const cents = (label = "Valor") =>
  z.coerce
    .number({ error: `${label} inválido.` })
    .int(`${label} inválido.`)
    .min(0, `${label} não pode ser negativo.`)
    .max(MAX_CENTS, `${label} acima do permitido.`);

export const positiveCents = (label = "Valor") =>
  cents(label).refine((v) => v > 0, `${label} deve ser maior que zero.`);

export const quantity = (label = "Quantidade") =>
  z.coerce
    .number({ error: `${label} inválida.` })
    .int(`${label} deve ser um número inteiro.`)
    .min(1, `${label} deve ser maior que zero.`)
    .max(1_000_000, `${label} acima do permitido.`);

/** Texto opcional: string vazia vira undefined. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres.`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : undefined));

export const requiredText = (label: string, max = 200, min = 1) =>
  z
    .string({ error: `Informe ${label}.` })
    .trim()
    .min(min, min > 1 ? `${capitalize(label)} deve ter ao menos ${min} caracteres.` : `Informe ${label}.`)
    .max(max, `Use no máximo ${max} caracteres.`);

export const reason = (label = "o motivo") => requiredText(label, 500, 5);

export const localDateTime = (label = "a data") =>
  z
    .string({ error: `Informe ${label}.` })
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, `Informe ${label} corretamente.`);

export const dateString = (label = "a data") =>
  z.string({ error: `Informe ${label}.` }).refine(isDateString, `Informe ${label} corretamente.`);

export const optionalDate = (label = "a data") =>
  z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || isDateString(v), `Informe ${label} corretamente.`);

export const idempotencyKey = z.string().min(8).max(100).optional();

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .nullable()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || z.email().safeParse(v).success, "E-mail inválido.");

/** Telefone brasileiro: DDD + número (10 ou 11 dígitos). Armazenado só com dígitos. */
export const optionalPhone = (label = "Telefone") =>
  z
    .string()
    .optional()
    .nullable()
    .transform((v) => {
      const digits = onlyDigits(v);
      return digits.length === 13 && digits.startsWith("55") ? digits.slice(2) : digits || undefined;
    })
    .refine(
      (v) => v === undefined || /^[1-9]{2}9?\d{8}$/.test(v),
      `${label} inválido. Use DDD + número, ex.: (11) 98765-4321.`,
    );

export function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base: string, weights: number[]) => {
    const total = base.split("").reduce((acc, digit, i) => acc + Number(digit) * weights[i], 0);
    const rest = total % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = calc(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

export const optionalCnpj = z
  .string()
  .optional()
  .nullable()
  .transform((v) => onlyDigits(v) || undefined)
  .refine((v) => v === undefined || isValidCnpj(v), "CNPJ inválido.");

export const optionalUrl = (label = "URL") =>
  z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : undefined))
    .refine((v) => {
      if (v === undefined) return true;
      try {
        const url = new URL(v);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    }, `${label} inválida. Cole o endereço completo, começando com https://`);

export const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export const optionalState = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .nullable()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || (BRAZILIAN_STATES as readonly string[]).includes(v), "UF inválida.");

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Resultado padronizado das server actions. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };
