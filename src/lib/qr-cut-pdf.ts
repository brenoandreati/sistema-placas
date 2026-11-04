import { qrMatrix } from "@/lib/qr-svg";

/**
 * PDF vetorial para imprimir e recortar na plotter (Roland VersaWorks e afins): QR codes em preto (K 100%) e, em
 * volta de cada um, um quadrado contínuo na cor especial "CutContour", que o VersaWorks lê como caminho de corte e
 * não imprime. A janela de impressão do navegador não gera cores especiais, por isso o PDF é montado aqui.
 */

/** Nome da cor especial do caminho de corte (o VersaWorks diferencia maiúsculas). */
export const CUT_SPOT_COLOR = "CutContour";

export interface CutSheetOptions {
  /** Lado do QR code impresso, em mm (inclui a margem branca do desenho). */
  sizeMm: number;
  /** Código escrito embaixo do QR code. */
  showText: boolean;
  /** Folga entre o QR code (e o código escrito) e a linha de corte, em mm. */
  marginMm: number;
  /** Espaço livre entre as linhas de corte de peças vizinhas, em mm. */
  gapMm: number;
}

export interface CutSheetItem {
  code: string;
  /** Endereço gravado no QR code. */
  url: string;
}

/** Folha A4 com 10 mm de margem, como a folha de impressão do navegador. */
const PAGE = { width: 210, height: 297, margin: 10 };
const PT_PER_MM = 72 / 25.4;
/** Courier-Bold: largura de cada caractere e altura das maiúsculas, em fração do corpo da letra. */
const GLYPH_WIDTH = 0.6;
const CAP_HEIGHT = 0.62;
const LETTER_SPACING = 0.12;
const CUT_LINE_PT = 0.25;

/** Corpo da letra do código, em pt (o mesmo da folha do navegador). */
export function labelFontPt(sizeMm: number): number {
  return Math.max(6, Math.min(11, sizeMm * 0.2));
}

export interface CutSheetLayout {
  /** Largura e altura de cada peça (o quadrado de corte), em mm. */
  pieceWidth: number;
  pieceHeight: number;
  columns: number;
  rows: number;
  perPage: number;
  /** Margem à esquerda que centraliza as colunas na folha, em mm. */
  left: number;
}

export function cutSheetLayout(options: CutSheetOptions): CutSheetLayout {
  const { sizeMm, showText, marginMm, gapMm } = options;
  const labelHeight = showText ? 1 + (labelFontPt(sizeMm) / PT_PER_MM) * CAP_HEIGHT : 0;
  const pieceWidth = sizeMm + 2 * marginMm;
  const pieceHeight = sizeMm + labelHeight + 2 * marginMm;
  const usableWidth = PAGE.width - 2 * PAGE.margin;
  const usableHeight = PAGE.height - 2 * PAGE.margin;
  const columns = Math.max(1, Math.floor((usableWidth + gapMm) / (pieceWidth + gapMm)));
  const rows = Math.max(1, Math.floor((usableHeight + gapMm) / (pieceHeight + gapMm)));
  const gridWidth = columns * pieceWidth + (columns - 1) * gapMm;
  return {
    pieceWidth,
    pieceHeight,
    columns,
    rows,
    perPage: columns * rows,
    left: (PAGE.width - gridWidth) / 2,
  };
}

/** Número em pt com até 3 casas, sem notação científica. */
function num(mm: number): string {
  return String(Math.round(mm * PT_PER_MM * 1000) / 1000);
}

/** Converte a coordenada vertical (mm a partir do topo) para o PDF (pt a partir da base). */
function fromTop(mm: number): string {
  return num(PAGE.height - mm);
}

function pdfString(text: string): string {
  return `(${text.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, "\\$&")})`;
}

function pieceContent(item: CutSheetItem, x: number, y: number, options: CutSheetOptions, layout: CutSheetLayout) {
  const { sizeMm, showText, marginMm } = options;
  const qr = qrMatrix(item.url);
  const moduleMm = sizeMm / qr.size;
  const qrX = x + marginMm;
  const qrY = y + marginMm;
  let out = "q\n0 0 0 1 k\n";
  for (const [col, row, length] of qr.runs) {
    const top = qrY + row * moduleMm;
    out += `${num(qrX + col * moduleMm)} ${fromTop(top + moduleMm)} ${num(length * moduleMm)} ${num(moduleMm)} re\n`;
  }
  out += "f\n";
  if (showText) {
    const fontPt = labelFontPt(sizeMm);
    const spacingPt = fontPt * LETTER_SPACING;
    const widthPt = item.code.length * fontPt * GLYPH_WIDTH + (item.code.length - 1) * spacingPt;
    const baseline = qrY + sizeMm + 1 + (fontPt / PT_PER_MM) * CAP_HEIGHT;
    const textX = (qrX + sizeMm / 2) * PT_PER_MM - widthPt / 2;
    out +=
      `BT /F1 ${fontPt} Tf ${Math.round(spacingPt * 1000) / 1000} Tc ` +
      `${Math.round(textX * 1000) / 1000} ${fromTop(baseline)} Td ${pdfString(item.code)} Tj ET\n`;
  }
  out += "Q\n";
  // Linha de corte: quadrado fechado, só contorno, 100% da cor especial, em sobreimpressão (não vaza a arte).
  out +=
    `q /GS1 gs /CS1 CS 1 SCN ${CUT_LINE_PT} w 0 J 0 j ` +
    `${num(x)} ${fromTop(y + layout.pieceHeight)} ${num(layout.pieceWidth)} ${num(layout.pieceHeight)} re S Q\n`;
  return out;
}

/** Gera o PDF (A4, quantas páginas forem precisas) com os QR codes na ordem recebida. */
export function qrCutSheetPdf(items: CutSheetItem[], options: CutSheetOptions, title: string): Uint8Array<ArrayBuffer> {
  const layout = cutSheetLayout(options);
  const pages: string[] = [];
  for (let start = 0; start < items.length; start += layout.perPage) {
    let content = "";
    items.slice(start, start + layout.perPage).forEach((item, index) => {
      const column = index % layout.columns;
      const row = Math.floor(index / layout.columns);
      const x = layout.left + column * (layout.pieceWidth + options.gapMm);
      const y = PAGE.margin + row * (layout.pieceHeight + options.gapMm);
      content += pieceContent(item, x, y, options, layout);
    });
    pages.push(content);
  }

  // Objetos fixos: 1 catálogo, 2 páginas, 3 fonte, 4 cor de corte, 5 função da cor, 6 sobreimpressão, 7 informações.
  // Depois, para cada página: o conteúdo e a página.
  const firstPage = 8;
  const pageRefs = pages.map((_, i) => `${firstPage + i * 2 + 1} 0 R`).join(" ");
  const mediaBox = `[0 0 ${num(PAGE.width)} ${num(PAGE.height)}]`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>",
    `[/Separation /${CUT_SPOT_COLOR} /DeviceCMYK 5 0 R]`,
    // Na tela, a linha de corte aparece em magenta 100%.
    "<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 1 0 0] /N 1 >>",
    "<< /Type /ExtGState /OP true /op false /OPM 1 >>",
    `<< /Title ${pdfString(title)} /Producer (Painel Placas NFC) >>`,
  ];
  pages.forEach((content, i) => {
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox ${mediaBox} /TrimBox ${mediaBox} ` +
        `/Resources << /Font << /F1 3 0 R >> /ColorSpace << /CS1 4 0 R >> /ExtGState << /GS1 6 0 R >> >> ` +
        `/Contents ${firstPage + i * 2} 0 R >>`,
    );
  });

  // Tudo é ASCII, então cada caractere é um byte e as posições do índice (xref) saem do comprimento do texto.
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
