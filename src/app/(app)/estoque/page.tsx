import { Boxes, PackagePlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StockMeter } from "@/components/dashboard/stock-meter";
import { PageHeader, StatStrip } from "@/components/page-header";
import { QuickActionButton } from "@/components/quick-actions";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ClearFilters, DateRangeFilter, SelectFilter } from "@/components/ui/filters";
import { LinkTabs } from "@/components/ui/link-tabs";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/cn";
import { addDaysToDate, formatDate, formatDateTime, isDateString, startOfLocalDay } from "@/lib/dates";
import { formatBRL, formatInteger, formatOrderNumber, formatRecordNumber, isUuid } from "@/lib/format";
import type { StockMovementType } from "@/generated/prisma/enums";
import { requirePageSession } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import {
  MOVEMENT_TYPE_LABELS,
  getInventoryOverview,
  listProducts,
  listStockEntries,
  listStockMovements,
  type StockEntryView,
  type StockMovementView,
} from "@/server/services/inventory";
import { getSettingsView } from "@/server/services/settings";
import { NewProductButton, ProductActions } from "./product-actions";

export const metadata: Metadata = { title: "Estoque" };

const TABS = [
  { key: "produtos", label: "Produtos" },
  { key: "movimentacoes", label: "Movimentações" },
  { key: "entradas", label: "Entradas e custos" },
];

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePageSession("sales.read");
  const sp = await searchParams;
  const settings = await getSettingsView();
  const tz = settings.timezone;
  const tab = TABS.some((t) => t.key === sp.aba) ? sp.aba! : "produtos";
  const productFilter = isUuid(sp.produto) ? sp.produto : undefined;
  const defaults = { salePrice: settings.defaultSalePrice, minStock: settings.defaultMinStock };
  const canWrite = can(session.user.role, "inventory.write");
  const canCost = can(session.user.role, "inventory.cost");

  const [products, overview] = await Promise.all([listProducts({ includeInactive: true }), getInventoryOverview()]);
  const firstMissingCost =
    sp.acao === "custo" ? (productFilter ?? products.find((p) => p.active && p.averageCost === null)?.id) : undefined;

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-5">
      <PageHeader
        title="Estoque de placas"
        description="Toda alteração gera uma movimentação registrada. O custo médio é ponderado pelas entradas."
        actions={
          canWrite ? (
            <>
              <NewProductButton defaults={defaults} />
              <QuickActionButton action={{ type: "stock-entry", productId: productFilter }}>
                <PackagePlus /> Entrada de estoque
              </QuickActionButton>
            </>
          ) : undefined
        }
      />

      <StatStrip
        items={[
          { label: "Placas disponíveis", value: formatInteger(overview.availableUnits) },
          {
            label: "Valor em estoque (custo)",
            value: overview.stockValueComplete ? (
              formatBRL(overview.stockValue)
            ) : (
              <span className="text-base text-warning">custo incompleto</span>
            ),
          },
          {
            label: "Abaixo do mínimo",
            value: formatInteger(overview.lowStock + overview.outOfStock),
            tone: overview.lowStock + overview.outOfStock > 0 ? "warning" : undefined,
          },
          {
            label: "Sem custo informado",
            value: formatInteger(overview.missingCost),
            tone: overview.missingCost > 0 ? "warning" : undefined,
          },
        ]}
      />

      <LinkTabs
        items={TABS.map((t) => ({
          ...t,
          href: `/estoque?aba=${t.key}${productFilter ? `&produto=${productFilter}` : ""}`,
        }))}
        active={tab}
      />

      {tab === "produtos" &&
        (products.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Boxes />}
              title="Nenhum produto cadastrado"
              description="Cadastre a placa NFC com preço de venda e, se souber, o custo de aquisição."
              action={canWrite ? <NewProductButton defaults={defaults} /> : undefined}
            />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {products.map((p) => (
              <Card
                key={p.id}
                className={cn(
                  "flex flex-col gap-4 p-5",
                  !p.active && "opacity-60",
                  productFilter === p.id && "ring-2 ring-primary/30",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold text-ink">{p.name}</h2>
                      {!p.active && <Badge tone="outline">Inativo</Badge>}
                      {p.stockStatus === "out" && p.active && <Badge tone="negative">Sem estoque</Badge>}
                      {p.stockStatus === "low" && p.active && <Badge tone="warning">Estoque baixo</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      <span className="font-mono">{p.sku}</span>
                      {p.category ? ` · ${p.category}` : ""} · desde {formatDate(p.createdAt, tz)}
                    </p>
                  </div>
                  {canWrite && (
                    <ProductActions
                      product={p}
                      timezone={tz}
                      defaults={defaults}
                      canCost={canCost}
                      autoOpenCost={firstMissingCost === p.id}
                    />
                  )}
                </div>
                <div>
                  <p className="flex items-baseline gap-2">
                    <span className="figure font-display text-4xl font-semibold tracking-tight">
                      {formatInteger(p.currentStock)}
                    </span>
                    <span className="text-sm text-muted">em estoque · mínimo {formatInteger(p.minStock)}</span>
                  </p>
                  <StockMeter current={p.currentStock} minimum={p.minStock} segments={32} className="mt-3 mb-4" />
                </div>
                <dl className="grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted">Preço de venda</dt>
                    <dd className="tabular font-medium">{formatBRL(p.salePrice)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Custo médio</dt>
                    <dd className={cn("tabular font-medium", p.averageCost === null && "text-warning")}>
                      {p.averageCost === null ? "não informado" : formatBRL(p.averageCost)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Margem por placa</dt>
                    <dd className="tabular font-medium">
                      {p.averageCost === null ? "—" : formatBRL(p.salePrice - p.averageCost)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Valor em estoque</dt>
                    <dd className="tabular font-medium">{p.stockValue === null ? "—" : formatBRL(p.stockValue)}</dd>
                  </div>
                </dl>
                <Link
                  href={`/estoque?aba=movimentacoes&produto=${p.id}`}
                  className="text-[13px] font-medium text-primary hover:underline"
                >
                  Ver movimentações deste produto →
                </Link>
              </Card>
            ))}
          </div>
        ))}

      {tab === "movimentacoes" && (
        <MovementsTab sp={sp} tz={tz} productFilter={productFilter} products={products} pageSize={settings.pageSize} />
      )}
      {tab === "entradas" && <EntriesTab sp={sp} tz={tz} productFilter={productFilter} pageSize={settings.pageSize} />}
    </div>
  );
}

const MOVEMENT_TYPES = Object.keys(MOVEMENT_TYPE_LABELS) as StockMovementType[];

async function MovementsTab({
  sp,
  tz,
  productFilter,
  products,
  pageSize,
}: {
  sp: Record<string, string | undefined>;
  tz: string;
  productFilter?: string;
  products: { id: string; name: string }[];
  pageSize: number;
}) {
  const result = await listStockMovements({
    productId: productFilter,
    type: MOVEMENT_TYPES.includes(sp.tipo as StockMovementType) ? (sp.tipo as StockMovementType) : undefined,
    from: isDateString(sp.de) ? startOfLocalDay(sp.de, tz) : undefined,
    to: isDateString(sp.ate) ? startOfLocalDay(addDaysToDate(sp.ate, 1), tz) : undefined,
    page: Number(sp.page) || 1,
    pageSize,
  });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
        <SelectFilter
          param="produto"
          label="Todos os produtos"
          options={products.map((p) => ({ value: p.id, label: p.name }))}
        />
        <SelectFilter
          param="tipo"
          label="Todos os tipos"
          options={MOVEMENT_TYPES.map((t) => ({ value: t, label: MOVEMENT_TYPE_LABELS[t] }))}
        />
        <DateRangeFilter />
        <ClearFilters params={["produto", "tipo", "de", "ate"]} />
      </div>
      <DataTable<StockMovementView>
        rows={result.items}
        rowKey={(m) => m.id}
        empty={
          <EmptyState
            title="Nenhuma movimentação"
            description="Entradas, vendas, cancelamentos e ajustes aparecem aqui."
          />
        }
        columns={[
          {
            key: "date",
            header: "Data e hora",
            cell: (m) => (
              <span className="tabular whitespace-nowrap text-ink-2">{formatDateTime(m.occurredAt, tz)}</span>
            ),
          },
          { key: "product", header: "Produto", cell: (m) => <span className="text-ink">{m.productName}</span> },
          {
            key: "type",
            header: "Tipo",
            cell: (m) => (
              <Badge tone={m.quantity > 0 ? "positive" : m.type === "SALE" ? "primary" : "warning"}>
                {MOVEMENT_TYPE_LABELS[m.type]}
              </Badge>
            ),
          },
          {
            key: "qty",
            header: "Quantidade",
            align: "right",
            cell: (m) => (
              <span className={cn("tabular font-medium", m.quantity > 0 ? "text-positive" : "text-negative")}>
                {m.quantity > 0 ? "+" : "−"}
                {formatInteger(Math.abs(m.quantity))}
              </span>
            ),
          },
          {
            key: "balance",
            header: "Saldo",
            align: "right",
            cell: (m) => <span className="tabular">{formatInteger(m.balanceAfter)}</span>,
          },
          {
            key: "reason",
            header: "Motivo / referência",
            cell: (m) => (
              <span className="block max-w-72 text-[13px]">
                <span className="text-ink-2">{m.reason ?? "—"}</span>
                {m.saleId && m.saleNumber && (
                  <Link href={`/vendas/${m.saleId}`} className="ml-1 font-mono text-primary hover:underline">
                    {formatOrderNumber(m.saleNumber)}
                  </Link>
                )}
                {m.stockEntryNumber && (
                  <span className="ml-1 font-mono text-muted">{formatRecordNumber("ENT", m.stockEntryNumber)}</span>
                )}
                {m.notes && <span className="block truncate text-xs text-muted">{m.notes}</span>}
              </span>
            ),
          },
          { key: "user", header: "Por", cell: (m) => <span className="text-xs text-muted">{m.createdBy ?? "—"}</span> },
        ]}
        mobileCard={(m) => (
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm text-ink">
                {MOVEMENT_TYPE_LABELS[m.type]} · {m.productName}
              </span>
              <span className="block text-xs text-muted">
                {formatDateTime(m.occurredAt, tz)} · {m.reason ?? ""}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className={cn("tabular block font-medium", m.quantity > 0 ? "text-positive" : "text-negative")}>
                {m.quantity > 0 ? "+" : "−"}
                {formatInteger(Math.abs(m.quantity))}
              </span>
              <span className="tabular block text-xs text-muted">saldo {formatInteger(m.balanceAfter)}</span>
            </span>
          </div>
        )}
      />
      <Pagination
        basePath="/estoque"
        params={sp}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        label="movimentações"
      />
    </Card>
  );
}

async function EntriesTab({
  sp,
  tz,
  productFilter,
  pageSize,
}: {
  sp: Record<string, string | undefined>;
  tz: string;
  productFilter?: string;
  pageSize: number;
}) {
  const result = await listStockEntries({ productId: productFilter, page: Number(sp.page) || 1, pageSize });
  return (
    <Card>
      <p className="border-b border-line px-5 py-3 text-[13px] text-muted">
        Histórico de compras e custos. Cada entrada com custo recalcula o custo médio ponderado usado no lucro das
        próximas vendas.
      </p>
      <DataTable<StockEntryView>
        rows={result.items}
        rowKey={(e) => e.id}
        empty={<EmptyState title="Nenhuma entrada registrada" />}
        columns={[
          {
            key: "n",
            header: "Entrada",
            cell: (e) => (
              <span className="font-mono text-[13px] text-ink-2">{formatRecordNumber("ENT", e.number)}</span>
            ),
          },
          {
            key: "date",
            header: "Data",
            cell: (e) => <span className="tabular text-ink-2">{formatDate(e.entryDate, tz)}</span>,
          },
          { key: "product", header: "Produto", cell: (e) => e.productName },
          {
            key: "qty",
            header: "Qtd.",
            align: "right",
            cell: (e) => <span className="tabular">{formatInteger(e.quantity)}</span>,
          },
          {
            key: "unit",
            header: "Custo unit.",
            align: "right",
            cell: (e) => <span className="tabular">{e.unitCost === null ? "—" : formatBRL(e.unitCost)}</span>,
          },
          {
            key: "total",
            header: "Custo total",
            align: "right",
            cell: (e) => (
              <span className="tabular font-medium">{e.totalCost === null ? "—" : formatBRL(e.totalCost)}</span>
            ),
          },
          {
            key: "supplier",
            header: "Fornecedor / doc.",
            cell: (e) => (
              <span className="text-ink-2">{[e.supplier, e.documentNumber].filter(Boolean).join(" · ") || "—"}</span>
            ),
          },
          {
            key: "paid",
            header: "Pagamento",
            cell: (e) =>
              e.paidNow ? (
                <Badge tone="neutral">Saiu do caixa · {e.paymentMethod}</Badge>
              ) : (
                <span className="text-xs text-muted">Fora do caixa</span>
              ),
          },
        ]}
        mobileCard={(e) => (
          <div className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-sm text-ink">
                {formatInteger(e.quantity)} un. · {e.productName}
              </span>
              <span className="block text-xs text-muted">
                {formatDate(e.entryDate, tz)}
                {e.supplier ? ` · ${e.supplier}` : ""}
              </span>
            </span>
            <span className="tabular text-right text-sm">
              <span className="block font-medium">{e.totalCost === null ? "sem custo" : formatBRL(e.totalCost)}</span>
              {e.unitCost !== null && <span className="block text-xs text-muted">{formatBRL(e.unitCost)}/un.</span>}
            </span>
          </div>
        )}
      />
      <Pagination
        basePath="/estoque"
        params={sp}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        label="entradas"
      />
    </Card>
  );
}
