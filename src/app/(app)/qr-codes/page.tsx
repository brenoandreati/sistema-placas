import { ExternalLink, Printer, QrCode, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, StatStrip } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ClearFilters, FilterBar, SearchFilter, SelectFilter } from "@/components/ui/filters";
import { Pagination } from "@/components/ui/pagination";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatInteger } from "@/lib/format";
import { qrPublicUrl } from "@/lib/qr";
import { requestOrigin, requirePageSession } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { getQrOverview, listQrCodes, type QrCodeView } from "@/server/services/qr-codes";
import { getSettingsView } from "@/server/services/settings";
import { GenerateQrBatchButton, QrBaseUrlButton, QrRowActions } from "./qr-actions";

export const metadata: Metadata = { title: "QR codes" };

const FILTER_PARAMS = ["q", "situacao", "lote"];

export default async function QrCodesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePageSession("sales.read");
  const sp = await searchParams;
  const canWrite = can(session.user.role, "qrcodes.write");
  const canConfigure = can(session.user.role, "settings.write");
  const settings = await getSettingsView();
  const tz = settings.timezone;
  const origin = await requestOrigin();
  const baseUrl = settings.qrBaseUrl ?? origin;
  const batchNumber = Number(sp.lote) > 0 ? Math.trunc(Number(sp.lote)) : undefined;

  const [overview, result] = await Promise.all([
    getQrOverview(),
    listQrCodes({
      search: sp.q,
      status: sp.situacao === "com-link" ? "linked" : sp.situacao === "sem-link" ? "free" : "all",
      batchNumber,
      page: Number(sp.page) || 1,
      pageSize: settings.pageSize,
    }),
  ]);
  const selectedBatch = overview.batches.find((b) => b.number === batchNumber);

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-5">
      <PageHeader
        title="QR codes"
        description="Códigos impressos nas placas. Cadastre ou troque o link de cada um quando quiser, sem reimprimir."
        actions={
          <>
            {canConfigure && <QrBaseUrlButton current={settings.qrBaseUrl} origin={origin} />}
            {canWrite && <GenerateQrBatchButton />}
          </>
        }
      />

      {!settings.qrBaseUrl && (
        <div className="flex gap-3 rounded-[var(--radius-card)] border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-ink-2">
            <span className="font-medium text-ink">Defina o domínio antes de imprimir.</span> Por enquanto os QR codes
            apontam para <span className="font-mono [overflow-wrap:anywhere]">{origin}</span>. É esse endereço que fica
            gravado na placa para sempre.
            {canConfigure ? " Use o botão “Endereço dos QR codes”." : " Peça ao administrador para configurar."}
          </p>
        </div>
      )}

      <StatStrip
        items={[
          { label: "QR codes gerados", value: formatInteger(overview.total) },
          { label: "Ativos (com link)", value: formatInteger(overview.linked), tone: "positive" },
          { label: "Livres (sem link)", value: formatInteger(overview.free) },
          { label: "Leituras", value: formatInteger(overview.scans) },
        ]}
      />

      {overview.batches.length > 0 && (
        <Card>
          <CardHeader title="Lotes" description="Cada lote é uma folha (ou mais) para imprimir." />
          <ul className="divide-y divide-line border-t border-line">
            {overview.batches.slice(0, 8).map((b) => (
              <li key={b.id} className="flex items-center gap-4 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <Link href={`/qr-codes?lote=${b.number}`} className="font-medium text-ink hover:underline">
                    Lote {b.number}
                  </Link>
                  <span className="tabular block text-xs text-muted">
                    {formatInteger(b.quantity)} QR codes · {formatInteger(b.linked)} ativo(s) ·{" "}
                    {formatDate(b.createdAt, tz)}
                  </span>
                  {b.notes && <span className="block truncate text-xs text-muted">{b.notes}</span>}
                </span>
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/imprimir/qr-codes?lote=${b.number}`}>
                    <Printer /> Imprimir
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        {selectedBatch && (
          <CardHeader
            title={`Lote ${selectedBatch.number}`}
            description={`${formatInteger(selectedBatch.quantity)} QR codes gerados em ${formatDate(selectedBatch.createdAt, tz)}`}
            action={
              <Button asChild size="sm">
                <Link href={`/imprimir/qr-codes?lote=${selectedBatch.number}`}>
                  <Printer /> Imprimir lote
                </Link>
              </Button>
            }
          />
        )}
        <FilterBar
          search={<SearchFilter placeholder="Buscar por código, cliente, link ou identificação" className="lg:w-96" />}
          params={FILTER_PARAMS}
        >
          <SelectFilter
            param="situacao"
            label="Todas as situações"
            options={[
              { value: "sem-link", label: "Sem link (livres)" },
              { value: "com-link", label: "Com link (ativos)" },
            ]}
          />
          {overview.batches.length > 1 && (
            <SelectFilter
              param="lote"
              label="Todos os lotes"
              options={overview.batches.map((b) => ({ value: String(b.number), label: `Lote ${b.number}` }))}
            />
          )}
          <ClearFilters params={FILTER_PARAMS} />
        </FilterBar>
        <DataTable<QrCodeView>
          rows={result.items}
          rowKey={(q) => q.id}
          empty={
            overview.total === 0 ? (
              <EmptyState
                icon={<QrCode />}
                title="Nenhum QR code gerado"
                description="Gere um lote, imprima e cole nas placas. Depois é só cadastrar o link de cada um — pelo painel ou escaneando a placa com o celular."
                action={canWrite ? <GenerateQrBatchButton /> : undefined}
              />
            ) : (
              <EmptyState title="Nenhum QR code encontrado" description="Ajuste a busca ou os filtros." />
            )
          }
          columns={[
            {
              key: "code",
              header: "Código",
              cell: (q) => (
                <span className="block">
                  <span className="font-mono font-medium tracking-wide text-ink">{q.code}</span>
                  <span className="block text-xs text-muted">
                    Lote {q.batchNumber} · nº {q.position}
                  </span>
                </span>
              ),
            },
            {
              key: "destination",
              header: "Link de destino",
              cell: (q) => <Destination qr={q} />,
            },
            {
              key: "customer",
              header: "Cliente",
              cell: (q) => <CustomerCell qr={q} />,
            },
            {
              key: "scans",
              header: "Leituras",
              align: "right",
              cell: (q) => (
                <span className="tabular block">
                  {formatInteger(q.scanCount)}
                  {q.lastScannedAt && (
                    <span className="block text-xs text-muted">última {formatDateTime(q.lastScannedAt, tz)}</span>
                  )}
                </span>
              ),
            },
            {
              key: "actions",
              header: <span className="sr-only">Ações</span>,
              align: "right",
              cell: (q) => <QrRowActions qr={q} publicUrl={qrPublicUrl(baseUrl, q.code)} canWrite={canWrite} />,
            },
          ]}
          mobileCard={(q) => (
            <div className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 flex-col items-start gap-1">
                <span className="flex items-center gap-2">
                  <span className="font-mono font-medium tracking-wide text-ink">{q.code}</span>
                  <span className="text-xs text-muted">lote {q.batchNumber}</span>
                </span>
                <Destination qr={q} />
                {(q.customer || q.label) && <CustomerCell qr={q} />}
              </span>
              <QrRowActions qr={q} publicUrl={qrPublicUrl(baseUrl, q.code)} canWrite={canWrite} />
            </div>
          )}
        />
        <Pagination
          basePath="/qr-codes"
          params={sp}
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          pageSize={result.pageSize}
          label="QR codes"
        />
      </Card>
    </div>
  );
}

function Destination({ qr }: { qr: QrCodeView }) {
  if (!qr.destinationUrl) return <Badge tone="outline">Sem link</Badge>;
  return (
    <a
      href={qr.destinationUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={qr.destinationUrl}
      className="inline-flex max-w-72 items-center gap-1.5 text-ink-2 hover:text-primary"
    >
      <span className="truncate">{qr.destinationUrl.replace(/^https?:\/\/(www\.)?/, "")}</span>
      <ExternalLink className="size-3 shrink-0" />
    </a>
  );
}

function CustomerCell({ qr }: { qr: QrCodeView }) {
  return (
    <span className="block max-w-56 text-sm">
      {qr.customer ? (
        <Link href={`/clientes/${qr.customer.id}`} className="block truncate text-ink hover:underline">
          {qr.customer.businessName}
        </Link>
      ) : (
        !qr.label && <span className="text-muted">—</span>
      )}
      {qr.label && <span className="block truncate text-xs text-muted">{qr.label}</span>}
    </span>
  );
}
