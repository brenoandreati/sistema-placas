import { z } from "zod";
import { cents, idempotencyKey, localDateTime, optionalText, quantity, reason, requiredText, uuid } from "./common";

export const productSchema = z.object({
  name: requiredText("o nome do produto", 120),
  sku: z
    .string({ error: "Informe o código SKU." })
    .trim()
    .min(1, "Informe o código SKU.")
    .max(40, "Use no máximo 40 caracteres.")
    .regex(/^[A-Za-z0-9._-]+$/, "Use apenas letras, números, ponto, hífen ou sublinhado.")
    .transform((v) => v.toUpperCase()),
  description: optionalText(1000),
  category: optionalText(80),
  salePriceCents: cents("Preço de venda"),
  minStock: z.coerce.number().int("Estoque mínimo inválido.").min(0, "Estoque mínimo inválido.").max(1_000_000),
  active: z.boolean().default(true),
});
export type ProductInput = z.input<typeof productSchema>;

export const createProductSchema = productSchema.extend({
  initialQuantity: z.coerce.number().int().min(0, "Quantidade inválida.").max(1_000_000).default(0),
  /** Custo unitário de aquisição, se conhecido. */
  initialUnitCostCents: cents("Custo unitário").nullable().optional(),
  /** Se verdadeiro, registra a saída de caixa referente à compra do estoque inicial. */
  initialPaidNow: z.boolean().default(false),
  initialPaymentMethodId: uuid.optional(),
});
export type CreateProductInput = z.input<typeof createProductSchema>;

export const updateProductSchema = productSchema.extend({ productId: uuid });
export type UpdateProductInput = z.input<typeof updateProductSchema>;

export const stockEntrySchema = z
  .object({
    productId: uuid,
    quantity: quantity("Quantidade recebida"),
    unitCostCents: cents("Custo unitário").nullable().optional(),
    entryDate: localDateTime("a data da entrada"),
    supplier: optionalText(120),
    documentNumber: optionalText(60),
    notes: optionalText(1000),
    paidNow: z.boolean().default(false),
    paymentMethodId: uuid.optional().nullable(),
    cashAccountId: uuid.optional().nullable(),
    idempotencyKey,
  })
  .superRefine((value, ctx) => {
    if (value.paidNow && (value.unitCostCents === null || value.unitCostCents === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["unitCostCents"],
        message: "Informe o custo unitário para registrar o pagamento no caixa.",
      });
    }
    if (value.paidNow && !value.paymentMethodId) {
      ctx.addIssue({ code: "custom", path: ["paymentMethodId"], message: "Escolha a forma de pagamento." });
    }
  });
export type StockEntryInput = z.input<typeof stockEntrySchema>;

export const stockAdjustmentSchema = z.object({
  productId: uuid,
  direction: z.enum(["IN", "OUT"], "Escolha o tipo de ajuste."),
  quantity: quantity(),
  reason: reason("a justificativa do ajuste"),
  notes: optionalText(1000),
  occurredAt: localDateTime("a data do ajuste"),
});
export type StockAdjustmentInput = z.input<typeof stockAdjustmentSchema>;

export const setAverageCostSchema = z.object({
  productId: uuid,
  unitCostCents: cents("Custo unitário"),
  reason: reason("a justificativa"),
  /** Aplica o custo também às vendas já registradas sem custo conhecido. */
  applyToUnknownSales: z.boolean().default(false),
});
export type SetAverageCostInput = z.input<typeof setAverageCostSchema>;
