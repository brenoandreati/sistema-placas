import { ArrowLeft, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInteger } from "@/lib/format";
import { QR_PRINT_SIZES, normalizeQrCode, qrPublicUrl } from "@/lib/qr";
import { requestOrigin, requirePageSession } from "@/server/auth/guard";
import { getQrCodesForPrint } from "@/server/services/qr-codes";
import { getSettingsView } from "@/server/services/settings";
import { PrintButton } from "./print-button";
import { QrPrintSheet } from "./qr-print-sheet";

export const metadata: Metadata = { title: "Imprimir QR codes" };

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

  const title = code ? `QR code ${code}` : `Lote ${batchNumber}`;

  return (
    <QrPrintSheet
      codes={codes.map((c) => c.code)}
      baseUrl={baseUrl}
      initialSize={QR_PRINT_SIZES.find((s) => s === sp.tamanho) ?? "3"}
      initialShowText={sp.texto !== "0"}
      notes={
        <>
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
        </>
      }
    >
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
    </QrPrintSheet>
  );
}
