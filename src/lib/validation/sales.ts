import { z } from "zod";
import {
  cents,
  idempotencyKey,
  localDateTime,
  optionalDate,
  optionalText,
  positiveCents,
  quantity,
  reason,
  uuid,
} from "./common";

export const saleItemSchema = z.object({
  productId: uuid,
  quantity: quantity(),
  unitPriceCents: cents("Preço unitário"),
});

export const SALE_STATUSES = ["REGISTERED", "PREPARING", "SHIPPED", "DELIVERED"] as const;

export const createSaleSchema = z
  .object({
    customerId: uuid,
    items: z
      .array(saleItemSchema)
      .min(1, "Adicione ao menos um produto.")
      .max(20, "Use no máximo 20 itens por venda."),
    saleDate: localDateTime("a data da venda"),
    paymentMethodId: uuid,
    paymentStatus: z.enum(["PENDING", "PARTIAL", "PAID"], "Escolha o status do pagamento."),
    amountReceivedCents: cents("Valor recebido").optional(),
    discountCents: cents("Desconto").default(0),
    shippingCents: cents("Frete").default(0),
    dueDate: optionalDate("o vencimento"),
    status: z.enum(SALE_STATUSES).default("REGISTERED"),
    notes: optionalText(2000),
    trackingCode: optionalText(80),
    deliveryAddress: optionalText(300),
    expectedDeliveryDate: optionalDate("a previsão de entrega"),
    idempotencyKey,
  })
  .superRefine((value, ctx) => {
    const ids = value.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["items"], message: "O mesmo produto aparece mais de uma vez." });
    }
    if (value.paymentStatus === "PARTIAL" && !value.amountReceivedCents) {
      ctx.addIssue({
        code: "custom",
        path: ["amountReceivedCents"],
        message: "Informe quanto foi recebido.",
      });
    }
  });
export type CreateSaleInput = z.input<typeof createSaleSchema>;

export const updateSaleSchema = z.object({
  saleId: uuid,
  customerId: uuid,
  saleDate: localDateTime("a data da venda"),
  status: z.enum(SALE_STATUSES),
  paymentMethodId: uuid,
  discountCents: cents("Desconto"),
  shippingCents: cents("Frete"),
  dueDate: optionalDate("o vencimento"),
  notes: optionalText(2000),
  trackingCode: optionalText(80),
  deliveryAddress: optionalText(300),
  expectedDeliveryDate: optionalDate("a previsão de entrega"),
});
export type UpdateSaleInput = z.input<typeof updateSaleSchema>;

export const updateSaleStatusSchema = z.object({
  saleId: uuid,
  status: z.enum(SALE_STATUSES),
});

export const registerPaymentSchema = z.object({
  saleId: uuid,
  amountCents: positiveCents("Valor recebido"),
  paymentMethodId: uuid,
  paidAt: localDateTime("a data do recebimento"),
  cashAccountId: uuid.optional().nullable(),
  notes: optionalText(1000),
  idempotencyKey,
});
export type RegisterPaymentInput = z.input<typeof registerPaymentSchema>;

export const refundPaymentSchema = z.object({
  paymentId: uuid,
  amountCents: positiveCents("Valor do estorno"),
  paidAt: localDateTime("a data do estorno"),
  reason: reason("o motivo do estorno"),
  idempotencyKey,
});
export type RefundPaymentInput = z.input<typeof refundPaymentSchema>;

export const cancelSaleSchema = z.object({
  saleId: uuid,
  reason: reason("o motivo do cancelamento"),
  /** Unidades de cada item que voltam ao estoque (placas em condição de revenda). */
  returns: z.array(
    z.object({
      saleItemId: uuid,
      returnQuantity: z.coerce.number().int().min(0, "Quantidade inválida."),
    }),
  ),
  /** O que fazer com valores já recebidos. */
  refundMode: z.enum(["REFUND_NOW", "REFUND_LATER"]).default("REFUND_NOW"),
  refundDate: localDateTime("a data do estorno").optional(),
});
export type CancelSaleInput = z.input<typeof cancelSaleSchema>;

/** Devolução ao cliente de valores pendentes de uma venda cancelada. */
export const settleRefundSchema = z.object({
  saleId: uuid,
  amountCents: positiveCents("Valor devolvido"),
  paidAt: localDateTime("a data da devolução"),
  reason: reason("a observação da devolução"),
  idempotencyKey,
});
export type SettleRefundInput = z.input<typeof settleRefundSchema>;
