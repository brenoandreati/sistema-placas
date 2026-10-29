"use server";

import type { GenerateReviewLinkInput } from "@/lib/validation/review-links";
import { deleteReviewLink, generateReviewLink } from "@/server/services/review-links";
import { runAction } from "./run";

export async function generateReviewLinkAction(input: GenerateReviewLinkInput) {
  return runAction("reviewlinks.write", async (actor) => {
    const link = await generateReviewLink(actor, input);
    return {
      id: link.id,
      businessName: link.businessName,
      reviewUrl: link.reviewUrl,
      alreadyExisted: link.alreadyExisted,
    };
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
