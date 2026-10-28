import { encode } from "uqr";

export interface QrDrawing {
  /** Lado do desenho em módulos (inclui a margem). */
  size: number;
  /** Módulos escuros como um único path SVG. */
  path: string;
}

/**
 * Desenha o QR code com correção de erros "M" (tolera ~15% de dano: riscos, sujeira, reflexo na placa),
 * elevada automaticamente quando cabe no mesmo tamanho. A margem em branco é medida em módulos.
 */
export function drawQr(text: string, border = 2): QrDrawing {
  const qr = encode(text, { ecc: "M", boostEcc: true, border });
  let path = "";
  qr.data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      path += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  });
  return { size: qr.size, path };
}

/** Arquivo SVG avulso (para levar o QR para a arte da placa em outro programa). */
export function qrSvgFile(text: string): string {
  const { size, path } = drawQr(text, 4);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 10}" height="${size * 10}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>\n`
  );
}
