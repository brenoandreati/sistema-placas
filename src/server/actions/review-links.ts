"use server";

import { mapsSearchUrl } from "@/lib/google-review";
import type { GenerateReviewLinkInput } from "@/lib/validation/review-links";
import { deleteReviewLink, generateReviewLink, SearchLinkError } from "@/server/services/review-links";
import { runAction } from "./run";

export async function generateReviewLinkAction(input: GenerateReviewLinkInput) {
  return runAction("reviewlinks.write", async (actor) => {
    try {
      const link = await generateReviewLink(actor, input);
      return {
        kind: "link" as const,
        id: link.id,
        businessName: link.businessName,
        reviewUrl: link.reviewUrl,
        alreadyExisted: link.alreadyExisted,
      };
    } catch (error) {
      // Link da Busca do Google: a tela oferece abrir o negócio no Google Maps para copiar o link certo.
      if (error instanceof SearchLinkError) {
        const query = error.query || input.businessName?.trim() || "";
        return { kind: "search" as const, query, mapsUrl: query ? mapsSearchUrl(query) : null };
      }
      throw error;
    }
  });
}

export async function deleteReviewLinkAction(id: string) {
  return runAction(
    "reviewlinks.write",
    async (actor) => {
      await deleteReviewLink(actor, id);
      return undefined;
    },
    { message: "Link removido do histórico." },
  );
}
