// PDF para imprimir e recortar na Roland (VersaWorks): linha de corte contínua na cor especial CutContour.
import { describe, expect, it } from "vitest";
import { CUT_SPOT_COLOR, cutSheetLayout, qrCutSheetPdf, type CutSheetOptions } from "@/lib/qr-cut-pdf";
import { drawQr } from "@/lib/qr-svg";

const PT_PER_MM = 72 / 25.4;
const OPTIONS: CutSheetOptions = { sizeMm: 30, showText: true, marginMm: 3, gapMm: 13 };

function items(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const code = `QR${String(i).padStart(4, "0")}`;
    return { code, url: `https://suaplaca.com.br/q/${code}` };
  });
}

function text(pdf: Uint8Array): string {
  return new TextDecoder().decode(pdf);
}

/** Retângulos de corte de cada página: [x, y, largura, altura] em pt. */
function cutRects(pdf: string): number[][][] {
  return [...pdf.matchAll(/stream\n([\s\S]*?)endstream/g)].map((stream) =>
    [...stream[1].matchAll(/\/CS1 CS 1 SCN [\d.]+ w 0 J 0 j ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re S Q/g)].map((rect) =>
      rect.slice(1).map(Number),
    ),
  );
}

describe("PDF para recorte", () => {
  it("distribui as peças na folha A4 com o espaço pedido entre os cortes", () => {
    const layout = cutSheetLayout(OPTIONS);
    expect(layout.pieceWidth).toBe(36);
    expect(layout.columns).toBe(4);
    expect(layout.columns * layout.pieceWidth + (layout.columns - 1) * OPTIONS.gapMm).toBeLessThanOrEqual(190);
    expect(layout.left).toBeCloseTo((210 - (4 * 36 + 3 * 13)) / 2);
    // Sem o código embaixo a peça é quadrada.
    expect(cutSheetLayout({ ...OPTIONS, showText: false }).pieceHeight).toBe(36);
  });

  it("gera um PDF válido com a linha de corte na cor especial CutContour", () => {
    const pdf = text(qrCutSheetPdf(items(45), OPTIONS, "Lote 7 - corte"));
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain(`[/Separation /${CUT_SPOT_COLOR} /DeviceCMYK 5 0 R]`);
    expect(pdf).toContain("/OP true");
    expect(pdf).toContain("/Title (Lote 7 - corte)");

    // Índice (xref): cada posição aponta para o início do objeto correspondente.
    const xref = Number(pdf.match(/startxref\n(\d+)\n/)![1]);
    const entries = pdf.slice(xref).split("\n").slice(3);
    const count = Number(pdf.match(/\/Size (\d+)/)![1]) - 1;
    for (let i = 0; i < count; i++) {
      const offset = Number(entries[i].slice(0, 10));
      expect(pdf.slice(offset, offset + 12).startsWith(`${i + 1} 0 obj`)).toBe(true);
    }

    // 20 peças por folha (4 colunas x 5 linhas): 45 códigos ocupam 3 folhas, uma linha de corte por código.
    const pages = cutRects(pdf);
    expect(pdf).toContain("/Count 3");
    expect(pages.map((p) => p.length)).toEqual([20, 20, 5]);
    for (const page of pages) {
      for (const [x, y, w, h] of page) {
        expect(w).toBeCloseTo(36 * PT_PER_MM, 2);
        expect(x).toBeGreaterThanOrEqual(10 * PT_PER_MM - 0.01);
        expect(x + w).toBeLessThanOrEqual(200 * PT_PER_MM + 0.01);
        expect(y).toBeGreaterThanOrEqual(10 * PT_PER_MM - 0.01);
        expect(y + h).toBeLessThanOrEqual(287 * PT_PER_MM + 0.01);
      }
      // Vizinhos na mesma linha ficam a pelo menos 13 mm de distância.
      for (let i = 1; i < page.length; i++) {
        if (page[i][1] !== page[i - 1][1]) continue;
        expect(page[i][0] - (page[i - 1][0] + page[i - 1][2])).toBeGreaterThanOrEqual(13 * PT_PER_MM - 0.01);
      }
    }
  });

  it("escreve o código embaixo só quando pedido", () => {
    expect(text(qrCutSheetPdf(items(1), OPTIONS, "QR code QR0000"))).toContain("(QR0000) Tj");
    expect(text(qrCutSheetPdf(items(1), { ...OPTIONS, showText: false }, "QR code QR0000"))).not.toContain(" Tj");
  });

  it("mantém o desenho do QR code da folha do navegador", () => {
    // Margem de 2 módulos: o padrão de localização do canto começa em (2, 2) com 7 módulos.
    expect(drawQr("https://suaplaca.com.br/q/ABC234").path.startsWith("M2 2h7v1h-7z")).toBe(true);
  });
});
