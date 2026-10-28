import { z } from "zod";
import { PERIOD_PRESETS } from "@/lib/dates";
import {
  MAX_CENTS,
  dateString,
  idempotencyKey,
  localDateTime,
  optionalText,
  positiveCents,
  reason,
  requiredText,
  uuid,
} from "./common";

export const withdrawalSchema = z.object({
  amountCents: positiveCents("Valor da retirada"),
  withdrawnAt: localDateTime("a data da retirada"),
  paymentMethodId: uuid,
  categoryId: uuid,
  description: requiredText("a descrição", 200),
  notes: optionalText(1000),
  cashAccountId: uuid.optional().nullable(),
  negativeBalanceJustification: optionalText(500),
  idempotencyKey,
});
export type WithdrawalInput = z.input<typeof withdrawalSchema>;

export const reverseWithdrawalSchema = z.object({
  withdrawalId: uuid,
  reason: reason("o motivo do estorno"),
});
export type ReverseWithdrawalInput = z.input<typeof reverseWithdrawalSchema>;

export const expenseSchema = z.object({
  amountCents: positiveCents("Valor da despesa"),
  incurredAt: localDateTime("a data da despesa"),
  categoryId: uuid,
  description: requiredText("a descrição", 200),
  paymentMethodId: uuid.optional().nullable(),
  supplier: optionalText(120),
  notes: optionalText(1000),
  saleId: uuid.optional().nullable(),
  cashAccountId: uuid.optional().nullable(),
  idempotencyKey,
});
export type ExpenseInput = z.input<typeof expenseSchema>;

export const incomeSchema = z.object({
  kind: z.enum(["CAPITAL_CONTRIBUTION", "OTHER_INCOME"], "Escolha o tipo de entrada."),
  amountCents: positiveCents("Valor"),
  occurredAt: localDateTime("a data"),
  categoryId: uuid,
  description: requiredText("a descrição", 200),
  paymentMethodId: uuid.optional().nullable(),
  notes: optionalText(1000),
  cashAccountId: uuid.optional().nullable(),
  idempotencyKey,
});
export type IncomeInput = z.input<typeof incomeSchema>;

export const reverseTransactionSchema = z.object({
  transactionId: uuid,
  reason: reason("o motivo do estorno"),
});
export type ReverseTransactionInput = z.input<typeof reverseTransactionSchema>;

export const openingBalanceSchema = z.object({
  cashAccountId: uuid,
  amountCents: z.coerce
    .number({ error: "Valor inválido." })
    .int("Valor inválido.")
    .min(-MAX_CENTS, "Valor inválido.")
    .max(MAX_CENTS, "Valor inválido."),
  date: dateString("a data do saldo inicial"),
  reason: optionalText(500),
});
export type OpeningBalanceInput = z.input<typeof openingBalanceSchema>;

export const CATEGORY_GROUPS_EDITABLE = ["EXPENSE", "WITHDRAWAL", "CAPITAL_CONTRIBUTION", "OTHER_INCOME"] as const;

export const categorySchema = z.object({
  categoryId: uuid.optional(),
  name: requiredText("o nome da categoria", 80),
  group: z.enum(CATEGORY_GROUPS_EDITABLE, "Escolha o grupo."),
  isDirectCost: z.boolean().default(false),
  withdrawalKind: z.enum(["OWNER_DRAW", "PROFIT_DISTRIBUTION", "REIMBURSEMENT", "OTHER"]).optional().nullable(),
  active: z.boolean().default(true),
});
export type CategoryInput = z.input<typeof categorySchema>;

export const paymentMethodSchema = z.object({
  paymentMethodId: uuid.optional(),
  name: requiredText("o nome da forma de pagamento", 60),
  kind: z.enum(["PIX", "CASH", "CARD", "BANK_TRANSFER", "OTHER"]),
  active: z.boolean().default(true),
});
export type PaymentMethodInput = z.input<typeof paymentMethodSchema>;

export const TIMEZONES = [
  { value: "America/Sao_Paulo", label: "Brasília (America/Sao_Paulo)" },
  { value: "America/Manaus", label: "Amazonas (America/Manaus)" },
  { value: "America/Cuiaba", label: "Mato Grosso (America/Cuiaba)" },
  { value: "America/Fortaleza", label: "Nordeste (America/Fortaleza)" },
  { value: "America/Recife", label: "Pernambuco (America/Recife)" },
  { value: "America/Belem", label: "Pará (America/Belem)" },
  { value: "America/Rio_Branco", label: "Acre (America/Rio_Branco)" },
  { value: "America/Noronha", label: "Fernando de Noronha (America/Noronha)" },
] as const;

export const settingsSchema = z.object({
  businessName: requiredText("o nome do negócio", 150),
  displayName: requiredText("o nome exibido no painel", 60),
  timezone: z.enum(TIMEZONES.map((t) => t.value) as [string, ...string[]], "Fuso horário inválido."),
  defaultSalePriceCents: z.coerce.number().int().min(0).max(MAX_CENTS).nullable().optional(),
  defaultMinStock: z.coerce.number().int().min(0).max(1_000_000),
  defaultDueDays: z.coerce.number().int().min(0, "Prazo inválido.").max(365, "Use no máximo 365 dias."),
  recentWithdrawalDays: z.coerce.number().int().min(1).max(90),
  dashboardDefaultPeriod: z.enum(PERIOD_PRESETS.filter((p) => p !== "custom") as [string, ...string[]]),
  pageSize: z.coerce.number().int().refine((v) => [10, 20, 50, 100].includes(v), "Valor inválido."),
  allowNegativeBalance: z.boolean(),
});
export type SettingsInput = z.input<typeof settingsSchema>;

export const setupSchema = z.object({
  businessName: requiredText("o nome do negócio", 150),
  displayName: requiredText("o nome exibido no painel", 60),
  openingBalanceCents: z.coerce.number().int().min(-MAX_CENTS).max(MAX_CENTS),
  productName: requiredText("o nome do produto", 120),
  productSku: z
    .string()
    .trim()
    .min(1, "Informe o código SKU.")
    .max(40)
    .regex(/^[A-Za-z0-9._-]+$/, "Use apenas letras, números, ponto, hífen ou sublinhado.")
    .transform((v) => v.toUpperCase()),
  salePriceCents: positiveCents("Preço de venda"),
  unitCostCents: z.coerce.number().int().min(0).max(MAX_CENTS).nullable().optional(),
  initialQuantity: z.coerce.number().int().min(0).max(1_000_000),
  minStock: z.coerce.number().int().min(0).max(1_000_000),
});
export type SetupInput = z.input<typeof setupSchema>;
