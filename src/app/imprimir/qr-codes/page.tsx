import { ArrowLeft, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QrImage } from "@/components/qr-image";
import { cn } from "@/lib/cn";
import { formatInteger } from "@/lib/format";
import { normalizeQrCode, qrPublicUrl } from "@/lib/qr";
import { requestOrigin, requirePageSession } from "@/server/auth/guard";
import { getQrCodesForPrint } from "@/server/services/qr-codes";
import { getSettingsView } from "@/server/services/settings";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Imprimir QR codes" };

/** Lado do QR impresso, em centímetros. */
const SIZES = ["2", "2.5", "3", "4", "5", "6"] as const;
const DEFAULT_SIZE = "3";

/** Folha A4 para imprimir (ou salvar em PDF) um lote inteiro ou um QR code avulso, em tamanho real. */
export default async function PrintQrCodesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePageSession("sales.read");
  const sp = await searchParams;
  const code = normalizeQrCode(sp.codigo);
  const batchNumber = Number(sp.lote) > 0 ? Math.trunc(Number(sp.lote)) : null;
  if (!code && !batchNumber) notFound();

  const settings = await getSettingsView();
  const baseUrl = settings.qrBaseUrl ?? (await requestOrigin());
  const codes = await getQrCodesForPrint(code ? { code } : { batchNumber: batchNumber! });
  if (codes.length === 0) notFound();

  const size = SIZES.find((s) => s === sp.tamanho) ?? DEFAULT_SIZE;
  const showText = sp.texto !== "0";
  const sideMm = Number(size) * 10;
  const title = code ? `QR code ${code}` : `Lote ${batchNumber}`;
  const href = (overrides: Record<string, string | null>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...overrides })) if (v) params.set(k, v);
    return `/imprimir/qr-codes?${params.toString()}`;
  };
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
          <Link
            href={code ? `/qr-codes?q=${code}` : `/qr-codes?lote=${batchNumber}`}
            className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted hover:text-ink"
          >
            <ArrowLeft className="size-4" /> QR codes
          </Link>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Imprimir {title}</h1>
              <p className="mt-1 text-sm text-muted">
                {formatInteger(codes.length)} QR code(s) · abrem{" "}
                <span className="font-mono [overflow-wrap:anywhere]">{qrPublicUrl(baseUrl, "…")}</span>
              </p>
            </div>
            <PrintButton />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted">Tamanho do QR:</span>
            {SIZES.map((s) => (
              <Link key={s} href={href({ tamanho: s })} className={option(s === size)} replace scroll={false}>
                {s.replace(".", ",")} cm
              </Link>
            ))}
            <span className="ml-2 text-[13px] text-muted">Código embaixo:</span>
            <Link href={href({ texto: null })} className={option(showText)} replace scroll={false}>
              Mostrar
            </Link>
            <Link href={href({ texto: "0" })} className={option(!showText)} replace scroll={false}>
              Ocultar
            </Link>
          </div>
          {!settings.qrBaseUrl && (
            <p className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-ink-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              Domínio dos QR codes não definido: eles vão abrir o endereço atual do painel. Defina o domínio definitivo
              em QR codes → “Endereço dos QR codes” antes de imprimir.
            </p>
          )}
          <p className="text-xs text-muted">
            Na janela de impressão, use escala 100% (tamanho real). Para mandar à gráfica, escolha “Salvar como PDF”. As
            linhas tracejadas são guias de corte.
          </p>
        </div>
      </header>

      <main className="mx-auto my-6 max-w-[210mm] bg-white p-[10mm] shadow-[var(--shadow-card)] print:m-0 print:max-w-none print:p-0 print:shadow-none">
        <div className="flex flex-wrap content-start gap-[1mm]">
          {codes.map((qr) => (
            <figure
              key={qr.code}
              className="m-0 flex break-inside-avoid flex-col items-center border border-dashed border-[#c8ced8] p-[2mm]"
            >
              <QrImage
                value={qrPublicUrl(baseUrl, qr.code)}
                label={`QR code ${qr.code}`}
                className="block"
                // Tamanho físico exato: o desenho já inclui a margem branca exigida pela leitura.
                style={{ width: `${sideMm}mm`, height: `${sideMm}mm` }}
              />
              {showText && (
                <figcaption
                  className="mt-[1mm] font-mono leading-none font-medium tracking-[0.12em] text-black"
                  style={{ fontSize: `${Math.max(6, Math.min(11, sideMm * 0.2))}pt` }}
                >
                  {qr.code}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      </main>
    </div>
  );
}
