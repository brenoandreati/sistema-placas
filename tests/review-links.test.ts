// Gerador de link direto de avaliação do Google a partir do link do negócio no Google Maps.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { extractFirstUrl, featureIdToPlaceId, placeIdFromUrl, REVIEW_URL_PREFIX } from "@/lib/google-review";
import type { Actor } from "@/server/context";
import { disconnectDb, prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import {
  deleteReviewLink,
  generateReviewLink,
  listReviewLinks,
  resolveReviewLink,
  SearchLinkError,
} from "@/server/services/review-links";
import { resetDatabase } from "./helpers";

let actor: Actor;

beforeEach(async () => {
  actor = await resetDatabase();
});

afterAll(async () => {
  await disconnectDb();
});

// Google Sydney: Place ID publicado pelo Google e o feature id que aparece nas URLs do Maps.
const SYDNEY_PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const SYDNEY_MAPS_URL =
  "https://www.google.com/maps/place/Google+Sydney/@-33.866489,151.1958561,17z/data=!3m1!4b1!4m6!3m5" +
  "!1s0x6b12ae37b47f5b37:0x8eaddfcd1b32ca52!8m2!3d-33.866489!4d151.195856!16s%2Fg%2F1tf2x2xw?entry=ttu";
const SYDNEY_REVIEW_URL = REVIEW_URL_PREFIX + SYDNEY_PLACE_ID;

/** Simula a internet: cada endereço responde com um redirecionamento (ou 200 quando não está no mapa). */
function fakeFetch(redirects: Record<string, string>) {
  return vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (url) =>
    redirects[url]
      ? new Response(null, { status: 302, headers: { location: redirects[url] } })
      : new Response("<html></html>", { status: 200 }),
  );
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await promise.catch((e: DomainError) => expect(e.code).toBe(code));
}

describe("conversão", () => {
  it("converte o feature id do Google Maps no Place ID", () => {
    expect(featureIdToPlaceId("0x6b12ae37b47f5b37", "0x8eaddfcd1b32ca52")).toBe(SYDNEY_PLACE_ID);
  });

  it("encontra o lugar nos formatos de endereço do Google Maps", () => {
    expect(placeIdFromUrl(SYDNEY_MAPS_URL)).toBe(SYDNEY_PLACE_ID);
    expect(placeIdFromUrl(SYDNEY_MAPS_URL.replace(":0x", "%3A0x"))).toBe(SYDNEY_PLACE_ID);
    expect(placeIdFromUrl("https://www.google.com/maps?ftid=0x6b12ae37b47f5b37:0x8eaddfcd1b32ca52")).toBe(
      SYDNEY_PLACE_ID,
    );
    expect(placeIdFromUrl(`https://www.google.com/maps/search/?api=1&query=x&query_place_id=${SYDNEY_PLACE_ID}`)).toBe(
      SYDNEY_PLACE_ID,
    );
    expect(placeIdFromUrl(`https://www.google.com/maps/place/?q=place_id:${SYDNEY_PLACE_ID}`)).toBe(SYDNEY_PLACE_ID);
    expect(placeIdFromUrl("https://www.google.com/maps/search/padaria/@-23.5,-46.6,13z")).toBeNull();
    expect(placeIdFromUrl("https://www.google.com/maps/@-23.5,-46.6,13z")).toBeNull();
  });

  it("acha o link no meio do texto compartilhado pelo celular", () => {
    expect(extractFirstUrl("Padaria Pão Dourado\nhttps://maps.app.goo.gl/AbC123?g_st=iw")).toBe(
      "https://maps.app.goo.gl/AbC123?g_st=iw",
    );
    expect(extractFirstUrl("veja (https://maps.app.goo.gl/AbC123).")).toBe("https://maps.app.goo.gl/AbC123");
    expect(extractFirstUrl("maps.app.goo.gl/AbC123")).toBe("https://maps.app.goo.gl/AbC123");
    expect(extractFirstUrl("Padaria Pão Dourado")).toBeNull();
  });
});

describe("resolução do link colado", () => {
  it("segue o link curto de compartilhamento até o endereço do lugar", async () => {
    const fetch = fakeFetch({
      "https://maps.app.goo.gl/AbC123?g_st=iw": SYDNEY_MAPS_URL,
    });
    await expect(resolveReviewLink("Google Sydney https://maps.app.goo.gl/AbC123?g_st=iw", fetch)).resolves.toEqual({
      reviewUrl: SYDNEY_REVIEW_URL,
      placeId: SYDNEY_PLACE_ID,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("passa por mais de um redirecionamento e pela tela de consentimento", async () => {
    const consent = `https://consent.google.com/ml?continue=${encodeURIComponent(SYDNEY_MAPS_URL)}&gl=BR`;
    const fetch = fakeFetch({
      "https://goo.gl/maps/xyz": "https://maps.app.goo.gl/AbC123",
      "https://maps.app.goo.gl/AbC123": consent,
    });
    await expect(resolveReviewLink("https://goo.gl/maps/xyz", fetch)).resolves.toMatchObject({
      reviewUrl: SYDNEY_REVIEW_URL,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("aceita link de avaliação pronto sem abrir nada", async () => {
    const fetch = fakeFetch({});
    await expect(resolveReviewLink(SYDNEY_REVIEW_URL, fetch)).resolves.toEqual({
      reviewUrl: SYDNEY_REVIEW_URL,
      placeId: SYDNEY_PLACE_ID,
    });
    await expect(resolveReviewLink("https://g.page/r/CVLKMhvN362OEAE/review", fetch)).resolves.toEqual({
      reviewUrl: "https://g.page/r/CVLKMhvN362OEAE/review",
      placeId: null,
    });
    await expect(resolveReviewLink(SYDNEY_MAPS_URL, fetch)).resolves.toMatchObject({ placeId: SYDNEY_PLACE_ID });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("explica quando o link não leva a um negócio", async () => {
    const fetch = fakeFetch({ "https://maps.app.goo.gl/fora": "https://exemplo.com/maps/!1s0x1:0x2" });
    await expectCode(resolveReviewLink("https://maps.app.goo.gl/fora", fetch), "PLACE_NOT_FOUND");
    await expectCode(resolveReviewLink("https://maps.app.goo.gl/sem-redirecionar", fetch), "PLACE_NOT_FOUND");
    await expectCode(
      resolveReviewLink("https://www.google.com/maps/search/padaria/@-23.5,-46.6,13z", fetch),
      "PLACE_NOT_FOUND",
    );
    await expectCode(resolveReviewLink("https://exemplo.com/minha-padaria", fetch), "NOT_GOOGLE");
    await expectCode(resolveReviewLink("Padaria Pão Dourado", fetch), "INVALID_LINK");
    // Só links curtos do Google são abertos: nada de buscar endereços de fora.
    expect(fetch.mock.calls.map((c) => new URL(c[0]).hostname)).toEqual(["maps.app.goo.gl", "maps.app.goo.gl"]);
  });

  it("reconhece link da Busca do Google (share.google) e devolve o nome pesquisado", async () => {
    // Caminho real de um link share.google (28/10/2026): passa por /share.google e termina numa pesquisa.
    const fetch = fakeFetch({
      "https://share.google/HlsiU0CI51OsIXTw6": "https://www.google.com/share.google?q=HlsiU0CI51OsIXTw6",
      "https://www.google.com/share.google?q=HlsiU0CI51OsIXTw6":
        "https://www.google.com/search?sca_esv=381dd&kgmid=/g/11btz1tyv9&q=Peso+Suplementos&source=sh/x/loc/uni/m1/1",
    });
    const error = await resolveReviewLink("https://share.google/HlsiU0CI51OsIXTw6", fetch).catch((e) => e);
    expect(error).toBeInstanceOf(SearchLinkError);
    expect(error).toMatchObject({ code: "SEARCH_LINK", query: "Peso Suplementos" });
    // A página de pesquisa em si não é aberta (só funciona num navegador).
    expect(fetch).toHaveBeenCalledTimes(2);

    const direct = await resolveReviewLink("https://www.google.com/search?q=Padaria+Central", fetch).catch((e) => e);
    expect(direct).toMatchObject({ code: "SEARCH_LINK", query: "Padaria Central" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("avisa quando o link não abre", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expectCode(resolveReviewLink("https://maps.app.goo.gl/AbC123", failing), "LINK_UNREACHABLE");
  });
});

describe("histórico", () => {
  it("guarda o link gerado, atualiza ao gerar de novo e registra na auditoria", async () => {
    const fetch = fakeFetch({ "https://maps.app.goo.gl/AbC123": SYDNEY_MAPS_URL });
    const first = await generateReviewLink(
      actor,
      { businessName: "Google Sydney", sourceUrl: "https://maps.app.goo.gl/AbC123" },
      fetch,
    );
    expect(first).toMatchObject({ reviewUrl: SYDNEY_REVIEW_URL, alreadyExisted: false });

    const again = await generateReviewLink(actor, { businessName: "Google Austrália", sourceUrl: SYDNEY_MAPS_URL });
    expect(again).toMatchObject({ id: first.id, businessName: "Google Austrália", alreadyExisted: true });
    expect(await prisma.reviewLink.count()).toBe(1);
    expect((await listReviewLinks("austr")).map((l) => l.businessName)).toEqual(["Google Austrália"]);

    await deleteReviewLink(actor, first.id);
    expect(await listReviewLinks()).toEqual([]);
    const actions = (
      await prisma.auditLog.findMany({ where: { entityType: "review_link" }, orderBy: { createdAt: "asc" } })
    ).map((l) => l.action);
    expect(actions).toEqual(["review_link.create", "review_link.update", "review_link.delete"]);
  });

  it("não grava nada quando o link é inválido", async () => {
    await expect(
      generateReviewLink(actor, { businessName: "Padaria", sourceUrl: "https://exemplo.com" }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(generateReviewLink(actor, { businessName: "", sourceUrl: SYDNEY_MAPS_URL })).rejects.toThrow();
    expect(await prisma.reviewLink.count()).toBe(0);
  });
});
