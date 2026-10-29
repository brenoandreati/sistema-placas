// Link direto de avaliação do Google: https://search.google.com/local/writereview?placeid={Place ID}
//
// Os links de lugar do Google Maps trazem o "feature id" do negócio como dois números hexadecimais de 64 bits
// (`!1s0x…:0x…` ou `ftid=0x…:0x…`). Um Place ID "ChIJ…" é esse mesmo par, empacotado em uma mensagem protobuf de
// dois campos fixed64 (little-endian) e codificado em base64url, então a conversão dispensa a API paga do Google.
// O formato é observado, não documentado pelo Google: se mudar, o gerador avisa que não encontrou o negócio.

export const REVIEW_URL_PREFIX = "https://search.google.com/local/writereview?placeid=";

const PLACE_ID = /^[A-Za-z0-9_-]{16,300}$/;

export function reviewUrlForPlaceId(placeId: string): string {
  return REVIEW_URL_PREFIX + placeId;
}

/** Primeiro endereço web dentro do texto colado (o compartilhamento do celular costuma vir com o nome junto). */
export function extractFirstUrl(text: string): string | null {
  const match = /https?:\/\/[^\s<>"']+/i.exec(text);
  if (match) return match[0].replace(/[).,;!?]+$/, "");
  const bare =
    /\b(?:maps\.app\.goo\.gl|goo\.gl|g\.page|g\.co|share\.google|(?:www\.)?google\.[a-z.]+)\/[^\s<>"']*/i.exec(text);
  return bare ? `https://${bare[0].replace(/[).,;!?]+$/, "")}` : null;
}

/** Domínios do Google aceitos (o gerador só abre links desses endereços). */
export function isGoogleHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    /(^|\.)google\.(com|com\.[a-z]{2}|[a-z]{2})$/.test(host) ||
    ["maps.app.goo.gl", "goo.gl", "g.co", "g.page", "share.google"].includes(host)
  );
}

/** Links curtos que só revelam o destino depois de seguir o redirecionamento. */
export function isShortLink(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  // share.google passa por www.google.com/share.google?q=… antes de chegar ao destino.
  return (
    ["maps.app.goo.gl", "goo.gl", "g.co", "g.page", "share.google"].includes(host) ||
    (isGoogleHost(host) && url.pathname === "/share.google")
  );
}

/**
 * Pesquisa do Google (destino dos links share.google, compartilhados pela Busca): devolve o termo pesquisado
 * ("" se não houver); nulo se não for uma pesquisa. Esses links não trazem o lugar do Maps.
 */
export function googleSearchQuery(url: URL): string | null {
  if (!isGoogleHost(url.hostname) || url.pathname !== "/search") return null;
  return url.searchParams.get("q")?.trim() ?? "";
}

/** Pesquisa no Google Maps pelo nome (URL oficial do Maps; no celular abre o app). */
export function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function hexToLittleEndian(hex: string): number[] {
  // BigInt(...) em vez de literais 0xffn: o tsconfig compila para ES2017.
  let value = BigInt(hex);
  const mask = BigInt(0xff);
  const byte = BigInt(8);
  const bytes: number[] = [];
  for (let i = 0; i < 8; i++) {
    bytes.push(Number(value & mask));
    value >>= byte;
  }
  return bytes;
}

/** Converte o feature id do Google Maps (`0x…:0x…`) no Place ID equivalente ("ChIJ…"). */
export function featureIdToPlaceId(highHex: string, lowHex: string): string {
  const bytes = [0x0a, 0x12, 0x09, ...hexToLittleEndian(highHex), 0x11, ...hexToLittleEndian(lowHex)];
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Já é um link direto de avaliação? Devolve-o normalizado. */
export function directReviewUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host === "search.google.com" && url.pathname === "/local/writereview") {
    const placeId = url.searchParams.get("placeid");
    return placeId && PLACE_ID.test(placeId) ? reviewUrlForPlaceId(placeId) : null;
  }
  // Link de "pedir avaliações" do Perfil da Empresa no Google: já abre direto a avaliação.
  if (host === "g.page" && /^\/r\/[A-Za-z0-9_-]+\/review\/?$/.test(url.pathname)) {
    return `https://g.page${url.pathname.replace(/\/$/, "")}`;
  }
  return null;
}

/** Place ID de um endereço do Google Maps (parâmetro explícito ou feature id); nulo se o link não aponta um lugar. */
export function placeIdFromUrl(url: string): string | null {
  const text = safeDecode(safeDecode(url));
  const explicit =
    /[?&](?:placeid|place_id|query_place_id)=([A-Za-z0-9_-]{16,300})/.exec(text) ??
    /place_id:([A-Za-z0-9_-]{16,300})/.exec(text);
  if (explicit) return explicit[1];
  const feature = /(?:!1s|[?&]ftid=)(0x[0-9a-f]{1,16}):(0x[0-9a-f]{1,16})/i.exec(text);
  return feature ? featureIdToPlaceId(feature[1], feature[2]) : null;
}
