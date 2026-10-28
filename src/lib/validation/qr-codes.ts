import { z } from "zod";
import { MAX_QR_BATCH, normalizeQrCode } from "@/lib/qr";
import { optionalText, optionalUrl, uuid } from "./common";

export const createQrBatchSchema = z.object({
  quantity: z.coerce
    .number({ error: "Informe a quantidade." })
    .int("A quantidade deve ser um número inteiro.")
    .min(1, "Gere ao menos 1 QR code.")
    .max(MAX_QR_BATCH, `Gere no máximo ${MAX_QR_BATCH} QR codes por vez.`),
  notes: optionalText(200),
});
export type CreateQrBatchInput = z.input<typeof createQrBatchSchema>;

export const qrCodeParam = z.string({ error: "Código inválido." }).transform((v, ctx) => {
  const code = normalizeQrCode(v);
  if (!code) {
    ctx.addIssue({ code: "custom", message: "Código inválido." });
    return z.NEVER;
  }
  return code;
});

/** Sem link de destino, o QR code volta a ficar "não ativado". */
export const updateQrCodeSchema = z.object({
  code: qrCodeParam,
  destinationUrl: optionalUrl("Link de destino").refine(
    (v) => v === undefined || v.length <= 2000,
    "Link muito longo (máximo de 2.000 caracteres).",
  ),
  customerId: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v : undefined))
    .pipe(uuid.optional()),
  label: optionalText(120),
});
export type UpdateQrCodeInput = z.input<typeof updateQrCodeSchema>;

/** Só o domínio (https://exemplo.com.br): os QR codes apontam para {domínio}/q/{código}. */
export const qrBaseUrlSchema = z.object({
  qrBaseUrl: optionalUrl("Endereço")
    .refine((v) => {
      if (v === undefined) return true;
      const url = new URL(v);
      return (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash && !url.username;
    }, "Informe só o domínio, sem caminho. Ex.: https://suaplaca.com.br")
    .transform((v) => (v === undefined ? undefined : new URL(v).origin)),
});
export type QrBaseUrlInput = z.input<typeof qrBaseUrlSchema>;
