import "server-only";
import {
  directReviewUrl,
  extractFirstUrl,
  isGoogleHost,
  isShortLinkHost,
  placeIdFromUrl,
  reviewUrlForPlaceId,
} from "@/lib/google-review";
import { generateReviewLinkSchema, type GenerateReviewLinkInput } from "@/lib/validation/review-links";
import type { Actor } from "@/server/context";
import { prisma } from "@/server/db";
import { DomainError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";

const MAX_REDIRECTS = 6;
const FETCH_TIMEOUT_MS = 8000;

const NOT_FOUND_HELP =
  "Não encontrei o negócio nesse link. No Google Maps, abra a página do negócio, toque em Compartilhar e cole aqui o " +
  "link copiado (começa com https://maps.app.goo.gl/).";

export interface ResolvedReviewLink {
  reviewUrl: string;
  placeId: string | null;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

function directOrPlace(url: URL): ResolvedReviewLink | null {
  const direct = directReviewUrl(url);
  if (direct) {
    const placeId = url.searchParams.get("placeid");
    return { reviewUrl: direct, placeId: direct.startsWith("https://search.google.com/") ? placeId : null };
  }
  const placeId = placeIdFromUrl(url.href);
  return placeId ? { reviewUrl: reviewUrlForPlaceId(placeId), placeId } : null;
}

/**
 * Descobre o link direto de avaliação a partir do que foi colado: link de avaliação pronto, endereço do Google Maps
 * ou link curto de compartilhamento (seguindo os redirecionamentos, só dentro de domínios do Google).
 */
export async function resolveReviewLink(text: string, fetchImpl: FetchLike = fetch): Promise<ResolvedReviewLink> {
  const raw = extractFirstUrl(text);
  let url: URL;
  try {
    url = new URL(raw ?? "");
  } catch {
    throw new DomainError("Cole o link do negócio no Google Maps (ex.: https://maps.app.goo.gl/…).", "INVALID_LINK");
  }
  if (!isGoogleHost(url.hostname)) {
    throw new DomainError("Esse link não é do Google. Cole o link do negócio no Google Maps.", "NOT_GOOGLE");
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const found = directOrPlace(url);
    if (found) return found;
    // Tela de consentimento de cookies: o destino real vem no parâmetro "continue".
    const next = url.hostname === "consent.google.com" ? url.searchParams.get("continue") : null;
    if (next && URL.canParse(next) && isGoogleHost(new URL(next).hostname)) {
      url = new URL(next);
      continue;
    }
    // Só links curtos são abertos; um endereço completo sem o lugar não vai revelar mais nada.
    if (!isShortLinkHost(url.hostname)) break;
    let response: Response;
    try {
      response = await fetchImpl(url.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "accept-language": "pt-BR,pt;q=0.9" },
      });
    } catch {
      throw new DomainError(
        "Não consegui abrir esse link agora. Confira se ele abre no celular e tente de novo.",
        "LINK_UNREACHABLE",
      );
    }
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (!location || !URL.canParse(location, url.href)) break;
    url = new URL(location, url);
    if (!isGoogleHost(url.hostname)) break;
  }
  throw new DomainError(NOT_FOUND_HELP, "PLACE_NOT_FOUND");
}

export interface ReviewLinkView {
  id: string;
  businessName: string;
  sourceUrl: string;
  reviewUrl: string;
  createdAt: string;
  updatedAt: string;
}

function toView(r: {
  id: string;
  businessName: string;
  sourceUrl: string;
  reviewUrl: string;
  createdAt: Date;
  updatedAt: Date;
}): ReviewLinkView {
  return {
    id: r.id,
    businessName: r.businessName,
    sourceUrl: r.sourceUrl,
    reviewUrl: r.reviewUrl,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Gera o link e guarda no histórico. O mesmo negócio gerado de novo atualiza o registro existente. */
export async function generateReviewLink(
  actor: Actor,
  input: GenerateReviewLinkInput,
  fetchImpl?: FetchLike,
): Promise<ReviewLinkView & { alreadyExisted: boolean }> {
  const data = generateReviewLinkSchema.parse(input);
  const resolved = await resolveReviewLink(data.sourceUrl, fetchImpl);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.reviewLink.findUnique({ where: { reviewUrl: resolved.reviewUrl } });
    const saved = existing
      ? await tx.reviewLink.update({
          where: { id: existing.id },
          data: { businessName: data.businessName, sourceUrl: data.sourceUrl },
        })
      : await tx.reviewLink.create({
          data: {
            businessName: data.businessName,
            sourceUrl: data.sourceUrl,
            reviewUrl: resolved.reviewUrl,
            placeId: resolved.placeId,
            createdById: actor.userId,
          },
        });
    await audit(tx, actor, {
      action: existing ? "review_link.update" : "review_link.create",
      entityType: "review_link",
      entityId: saved.id,
      summary: `Link de avaliação de ${saved.businessName} ${existing ? "gerado novamente" : "gerado"}`,
      metadata: { reviewUrl: saved.reviewUrl },
    });
    return { ...toView(saved), alreadyExisted: Boolean(existing) };
  });
}

export async function deleteReviewLink(actor: Actor, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const link = await tx.reviewLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundError("Link não encontrado.");
    await tx.reviewLink.delete({ where: { id } });
    await audit(tx, actor, {
      action: "review_link.delete",
      entityType: "review_link",
      entityId: id,
      summary: `Link de avaliação de ${link.businessName} excluído do histórico`,
      before: { ...toView(link) },
    });
  });
}

export async function listReviewLinks(search?: string, limit = 100): Promise<ReviewLinkView[]> {
  const term = search?.trim();
  const rows = await prisma.reviewLink.findMany({
    where: term ? { businessName: { contains: term, mode: "insensitive" } } : {},
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  return rows.map(toView);
}
