import { z } from "zod";
import { FOLLOW_UP_RESULT_STATUSES, FOLLOW_UP_TYPES } from "@/lib/follow-ups";
import { dateString, idempotencyKey, optionalPhone, optionalText, requiredText, uuid } from "./common";

const optionalTime = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v.slice(0, 5) : undefined))
  .refine((v) => v === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), "Informe o horário corretamente.");

const followUpType = z.enum(FOLLOW_UP_TYPES, "Escolha o tipo de retorno.");

/**
 * Dados de um retorno. O cliente pode ser um já cadastrado (`existing`) ou um potencial cliente novo (`new`),
 * cadastrado junto, sem exigir venda.
 */
const followUpFields = z.object({
  customerMode: z.enum(["existing", "new"]),
  customerId: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v : undefined))
    .pipe(uuid.optional()),
  businessName: optionalText(150),
  contactName: optionalText(120),
  phone: optionalPhone("Telefone"),
  date: dateString("a data do retorno"),
  time: optionalTime,
  type: followUpType,
  reason: requiredText("o motivo do retorno", 300),
  notes: optionalText(2000),
});

function checkCustomer(
  v: { customerMode: "existing" | "new"; customerId?: string; businessName?: string; contactName?: string },
  ctx: z.RefinementCtx,
) {
  if (v.customerMode === "existing" && !v.customerId) {
    ctx.addIssue({ code: "custom", path: ["customerId"], message: "Selecione o cliente." });
  }
  if (v.customerMode === "new") {
    if (!v.businessName) {
      ctx.addIssue({ code: "custom", path: ["businessName"], message: "Informe o nome do estabelecimento." });
    }
    if (!v.contactName) {
      ctx.addIssue({ code: "custom", path: ["contactName"], message: "Informe o nome do responsável." });
    }
  }
}

export const createFollowUpSchema = followUpFields.extend({ idempotencyKey }).superRefine(checkCustomer);
export type CreateFollowUpInput = z.input<typeof createFollowUpSchema>;
export type FollowUpData = z.output<typeof createFollowUpSchema>;

export const updateFollowUpSchema = followUpFields.extend({ id: uuid }).superRefine(checkCustomer);
export type UpdateFollowUpInput = z.input<typeof updateFollowUpSchema>;

/** Resultado do contato; opcionalmente já agenda o próximo retorno. */
export const followUpResultSchema = z
  .object({
    id: uuid,
    status: z.enum(FOLLOW_UP_RESULT_STATUSES, "Escolha o resultado."),
    outcome: optionalText(2000),
    nextDate: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? v : undefined)),
    nextTime: optionalTime,
    nextType: followUpType.optional(),
    nextReason: optionalText(300),
  })
  .superRefine((v, ctx) => {
    if (v.nextDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(v.nextDate)) {
      ctx.addIssue({ code: "custom", path: ["nextDate"], message: "Informe a data do próximo retorno." });
    }
  });
export type FollowUpResultInput = z.input<typeof followUpResultSchema>;

export const rescheduleFollowUpSchema = z.object({
  id: uuid,
  date: dateString("a nova data"),
  time: optionalTime,
  note: optionalText(1000),
});
export type RescheduleFollowUpInput = z.input<typeof rescheduleFollowUpSchema>;

export const cancelFollowUpSchema = z.object({
  id: uuid,
  reason: optionalText(500),
});
export type CancelFollowUpInput = z.input<typeof cancelFollowUpSchema>;
