import { z } from "zod";
import { requiredText } from "./common";

export const generateReviewLinkSchema = z.object({
  businessName: requiredText("o nome do negócio", 150),
  sourceUrl: z
    .string({ error: "Cole o link do negócio no Google." })
    .trim()
    .min(1, "Cole o link do negócio no Google.")
    .max(4000, "Link muito longo."),
});
export type GenerateReviewLinkInput = z.input<typeof generateReviewLinkSchema>;
