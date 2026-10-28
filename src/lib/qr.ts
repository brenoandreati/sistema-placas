// QR codes dinâmicos: o QR impresso guarda só {endereço}/q/{código}. O destino fica no banco
// e pode ser cadastrado ou trocado a qualquer momento, sem reimprimir a placa.

/** Sem 0/O e 1/I/L: o código impresso embaixo do QR não deixa dúvida na leitura. */
export const QR_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const QR_CODE_LENGTH = 6;
export const MAX_QR_BATCH = 500;

/** Lados do QR impresso, em centímetros. */
export const QR_PRINT_SIZES = ["2", "2.5", "3", "4", "5", "6"] as const;
export type QrPrintSize = (typeof QR_PRINT_SIZES)[number];

/** Normaliza um código digitado ou vindo da URL; nulo se não tiver o formato de um código. */
export function normalizeQrCode(value: string | null | undefined): string | null {
  const code = (value ?? "").trim().toUpperCase();
  return /^[0-9A-Z]{4,16}$/.test(code) ? code : null;
}

/** Endereço gravado no QR code. */
export function qrPublicUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/q/${code}`;
}
