"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { QR_PRINT_SIZES, qrPublicUrl, type QrPrintSize } from "@/lib/qr";
import { drawQr } from "@/lib/qr-svg";

const subscribeNoop = () => () => {};

/**
 * Os QR codes são desenhados no navegador: no Cloudflare Workers cada requisição tem pouco tempo de CPU,
 * e desenhar um lote inteiro no servidor estourava o limite.
 */
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

/** Opções de tamanho/legenda e a folha A4. Trocar as opções não consulta o servidor. */
export function QrPrintSheet({
  codes,
  baseUrl,
  initialSize,
  initialShowText,
  children,
  notes,
}: {
  codes: string[];
  baseUrl: string;
  initialSize: QrPrintSize;
  initialShowText: boolean;
  /** Topo do cabeçalho (título, botão de imprimir), renderizado no servidor. */
  children: React.ReactNode;
  /** Avisos exibidos abaixo das opções. */
  notes: React.ReactNode;
}) {
  const [size, setSize] = useState(initialSize);
  const [showText, setShowText] = useState(initialShowText);
  const isClient = useIsClient();
  const drawings = useMemo(
    () => (isClient ? codes.map((code) => drawQr(qrPublicUrl(baseUrl, code))) : null),
    [isClient, codes, baseUrl],
  );
  const sideMm = Number(size) * 10;

  // Mantém a escolha no endereço (recarregar a página não perde o tamanho).
  function choose(next: { size?: QrPrintSize; showText?: boolean }) {
    if (next.size) setSize(next.size);
    if (next.showText !== undefined) setShowText(next.showText);
    const url = new URL(window.location.href);
    if (next.size) url.searchParams.set("tamanho", next.size);
    if (next.showText !== undefined) {
      if (next.showText) url.searchParams.delete("texto");
      else url.searchParams.set("texto", "0");
    }
    window.history.replaceState(null, "", url);
  }

  const option = (active: boolean) =>
    cn(
      "inline-flex h-8 items-center rounded-lg border px-2.5 text-[13px] font-medium",
      active
        ? "border-primary bg-primary-soft text-primary-ink"
        : "border-line-strong bg-surface text-ink-2 hover:bg-surface-2",
    );

  return (
    <div className="min-h-dvh bg-surface-2 print:bg-white">
      <style>{`@page { size: A4; margin: 10mm; } @media print { body { background: #fff; } }`}</style>

      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex max-w-[210mm] flex-col gap-4 px-4 py-5">
          {children}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted">Tamanho do QR:</span>
            {QR_PRINT_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={s === size}
                className={option(s === size)}
                onClick={() => choose({ size: s })}
              >
                {s.replace(".", ",")} cm
              </button>
            ))}
            <span className="ml-2 text-[13px] text-muted">Código embaixo:</span>
            <button
              type="button"
              aria-pressed={showText}
              className={option(showText)}
              onClick={() => choose({ showText: true })}
            >
              Mostrar
            </button>
            <button
              type="button"
              aria-pressed={!showText}
              className={option(!showText)}
              onClick={() => choose({ showText: false })}
            >
              Ocultar
            </button>
          </div>
          {notes}
        </div>
      </header>

      <main className="mx-auto my-6 max-w-[210mm] bg-white p-[10mm] shadow-[var(--shadow-card)] print:m-0 print:max-w-none print:p-0 print:shadow-none">
        <div className="flex flex-wrap content-start gap-[1mm]">
          {codes.map((code, index) => {
            const drawing = drawings?.[index];
            return (
              <figure
                key={code}
                className="m-0 flex break-inside-avoid flex-col items-center border border-dashed border-[#c8ced8] p-[2mm]"
              >
                {/* Tamanho físico exato: o desenho já inclui a margem branca exigida pela leitura. */}
                {drawing ? (
                  <svg
                    viewBox={`0 0 ${drawing.size} ${drawing.size}`}
                    className="block"
                    style={{ width: `${sideMm}mm`, height: `${sideMm}mm` }}
                    role="img"
                    aria-label={`QR code ${code}`}
                    shapeRendering="crispEdges"
                  >
                    <rect width={drawing.size} height={drawing.size} fill="#fff" />
                    <path d={drawing.path} fill="#000" />
                  </svg>
                ) : (
                  <span className="block bg-surface-2" style={{ width: `${sideMm}mm`, height: `${sideMm}mm` }} />
                )}
                {showText && (
                  <figcaption
                    className="mt-[1mm] font-mono leading-none font-medium tracking-[0.12em] text-black"
                    style={{ fontSize: `${Math.max(6, Math.min(11, sideMm * 0.2))}pt` }}
                  >
                    {code}
                  </figcaption>
                )}
              </figure>
            );
          })}
        </div>
      </main>
    </div>
  );
}
