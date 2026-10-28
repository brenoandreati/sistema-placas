import { z } from "zod";
import {
  optionalCnpj,
  optionalEmail,
  optionalPhone,
  optionalState,
  optionalText,
  optionalUrl,
  requiredText,
  uuid,
} from "./common";

export const customerSchema = z.object({
  businessName: requiredText("o nome do negócio", 150),
  contactName: requiredText("o nome do responsável", 120),
  legalName: optionalText(200),
  email: optionalEmail,
  phone: optionalPhone("Telefone"),
  whatsapp: optionalPhone("WhatsApp"),
  segment: optionalText(80),
  cnpj: optionalCnpj,
  address: optionalText(300),
  city: optionalText(100),
  state: optionalState,
  zipCode: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ?? "").replace(/\D/g, "") || undefined)
    .refine((v) => v === undefined || v.length === 8, "CEP deve ter 8 dígitos."),
  notes: optionalText(4000),
  googleReviewUrl: optionalUrl("URL de avaliações"),
  publicPlaceName: optionalText(150),
  plateCustomizationNotes: optionalText(2000),
});
export type CustomerInput = z.input<typeof customerSchema>;
export type CustomerData = z.output<typeof customerSchema>;

export const updateCustomerSchema = customerSchema.extend({ customerId: uuid });
export type UpdateCustomerInput = z.input<typeof updateCustomerSchema>;

/** Cadastro rápido feito de dentro do formulário de venda. */
export const quickCustomerSchema = customerSchema.pick({
  businessName: true,
  contactName: true,
  phone: true,
  email: true,
});
export type QuickCustomerInput = z.input<typeof quickCustomerSchema>;
