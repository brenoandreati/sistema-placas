import { ArrowDownLeft, ArrowUpRight, CircleAlert, CircleMinus, Download, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Money } from "@/components/dashboard/kpi";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { PageHeader } from "@/components/page-header";
import { QuickActionButton } from "@/components/quick-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ClearFilters, SearchFilter, SelectFilter } from "@/components/ui/filters";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/cn";
import { formatDateString, formatDateTime, isPeriodPreset, resolvePeriod } from "@/lib/dates";
import { formatBRL, formatRecordNumber, isUuid } from "@/lib/format";
import type { TransactionOrigin } from "@/generated/prisma/enums";
import { requirePageSession } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { ORIGIN_LABELS, getLedger, listCategories, type LedgerEntry } from "@/server/services/finance";
import { findDivergences, getCashFlowMetrics, getCurrentPosition, getProfitMetrics } from "@/server/services/metrics";
import { getSettingsView } from "@/server/services/settings";
import { ReverseTransactionButton } from "./reverse-button";

export const metadata: Metadata = { title: "Financeiro" };

const ORIGINS = Object.keys(ORIGIN_LABELS) as TransactionOrigin[];

function referenceHref(ref: NonNullable<LedgerEntry["reference"]>) {
  switch (ref.type) {
    case "sale":
      return `/vendas/${ref.id}`;
    case "withdrawal":
      return `/retiradas?id=${ref.id}`;
    case "stock_entry":
      return "/estoque?aba=entradas";
    default:
      return null;
  }
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePageSession("finance.read");
  const sp = await searchParams;
  const settings = await getSettingsView();
  const tz = settings.timezone;
  const preset = isPeriodPreset(sp.periodo) ? sp.periodo : "month";
  const period = resolvePeriod(preset, tz, { from: sp.de, to: sp.ate });

  const [position, cash, profit, categories, divergences, ledger] = await Promise.all([
    getCurrentPosition(tz),
    getCashFlowMetrics(period),
    getProfitMetrics(period),
    listCategories({ includeInactive: true }),
    findDivergences(),
    getLedger({
      from: period.start,
      to: period.end,
      direction: sp.tipo === "IN" || sp.tipo === "OUT" ? sp.tipo : undefined,
      categoryId: isUuid(sp.categoria) ? sp.categoria : undefined,
      origin: ORIGINS.includes(sp.origem as TransactionOrigin) ? (sp.origem as TransactionOrigin) : undefined,
      search: sp.q,
      page: Number(sp.page) || 1,
      pageSize: settings.pageSize,
    }),
  ]);
  const canReverse = can(session.user.role, "finance.reverse");
  const canWrite = can(session.user.role, "finance.write");
  const rangeLabel =
    period.from === period.to
      ? formatDateString(period.from)
      : `${formatDateString(period.from)} a ${formatDateString(period.to)}`;
  const exportHref = `/api/relatorios/livro-caixa?de=${period.from}&ate=${period.to}`;

  const periodCards = [
    {
      label: "Recebido em vendas",
      value: cash.netSalesReceipts,
      tone: "positive",
      note: cash.salesRefunds > 0 ? `já descontados ${formatBRL(cash.salesRefunds)} de estornos` : undefined,
    },
    { label: "Aportes de capital", value: cash.capitalContributions, tone: "positive" },
    { label: "Outras entradas", value: cash.otherIncome, tone: "positive" },
    {
      label: "Despesas operacionais",
      value: cash.expenses,
      tone: "negative",
      note:
        cash.directCostExpenses > 0 ? `${formatBRL(cash.directCostExpenses)} são custos diretos das vendas` : undefined,
    },
    { label: "Compras de estoque", value: cash.stockPurchases, tone: "negative" },
    { label: "Retiradas", value: cash.withdrawals, tone: "negative", note: "não são despesas operacionais" },
  ] as const;

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-6">
      <PageHeader
        title="Financeiro"
        description="Quanto entrou, quanto saiu e quanto há em caixa — cada valor rastreável até a origem."
        actions={
          canWrite ? (
            <>
              <QuickActionButton variant="secondary" action={{ type: "income" }}>
                <ArrowDownLeft /> Entrada
              </QuickActionButton>
              <QuickActionButton variant="secondary" action={{ type: "expense" }}>
                <CircleMinus /> Despesa
              </QuickActionButton>
              <QuickActionButton action={{ type: "withdrawal" }}>
                <ArrowUpRight /> Retirada
              </QuickActionButton>
            </>
          ) : undefined
        }
      />

      {divergences.length > 0 && (
        <div className="flex gap-3 rounded-xl border border-negative/25 bg-negative-soft p-4 text-sm text-negative">
          <CircleAlert className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-medium">Divergências encontradas</p>
            <ul className="mt-1 list-disc pl-4">
              {divergences.map((d) => (
                <li key={d.message}>
                  <Link href={d.href} className="underline underline-offset-2">
                    {d.message}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Posição acumulada até agora */}
      <section
        aria-label="Posição atual"
        className="grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line shadow-[var(--shadow-card)] md:grid-cols-4"
      >
        <div className="bg-surface p-5 md:col-span-2">
          <p className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
            <Wallet className="size-4 text-muted" /> Saldo disponível agora
          </p>
          <p
            className={cn(
              "figure mt-2 font-display text-[40px] leading-none font-semibold tracking-tight",
              position.balance < 0 ? "text-negative" : "text-ink",
            )}
          >
            <Money value={position.balance} />
          </p>
          <p className="mt-2 text-xs text-muted">
            Saldo inicial + entradas confirmadas − saídas confirmadas (todas as datas).
          </p>
        </div>
        <div className="bg-surface p-5">
          <p className="text-[13px] font-medium text-ink-2">Contas a receber</p>
          <p className="tabular mt-2 font-display text-2xl font-semibold text-warning">
            {formatBRL(position.receivables.total)}
          </p>
          <Link href="/contas-a-receber" className="mt-1 block text-xs text-muted hover:text-ink">
            {position.receivables.count} venda(s)
            {position.receivables.overdue > 0 ? ` · ${formatBRL(position.receivables.overdue)} em atraso` : ""} →
          </Link>
        </div>
        <div className="bg-surface p-5">
          <p className="text-[13px] font-medium text-ink-2">Saldo inicial</p>
          <p className="tabular mt-2 font-display text-2xl font-semibold">{formatBRL(position.openingBalance)}</p>
          {position.refundsDue.total > 0 ? (
            <p className="mt-1 text-xs text-warning">A devolver a clientes: {formatBRL(position.refundsDue.total)}</p>
          ) : (
            <Link href="/configuracoes?aba=caixa" className="mt-1 block text-xs text-muted hover:text-ink">
              Histórico do saldo inicial →
            </Link>
          )}
        </div>
      </section>

      {/* Indicadores do período */}
      <section aria-label="Indicadores do período" className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">No período</h2>
            <p className="text-[13px] text-muted">
              {period.label} · {rangeLabel}
            </p>
          </div>
          <PeriodSelector preset={period.preset} from={period.from} to={period.to} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {periodCards.map((c) => (
            <div key={c.label} className="rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
              <p className="text-xs text-muted">{c.label}</p>
              <p
                className={cn(
                  "tabular mt-1.5 font-display text-lg font-semibold",
                  c.value === 0 ? "text-ink" : c.tone === "positive" ? "text-positive" : "text-negative",
                )}
              >
                {c.value === 0 ? formatBRL(0) : `${c.tone === "positive" ? "+" : "−"} ${formatBRL(Math.abs(c.value))}`}
              </p>
              {"note" in c && c.note && <p className="mt-1 text-[11px] leading-snug text-muted">{c.note}</p>}
            </div>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-5 py-4 shadow-[var(--shadow-card)]">
            <div>
              <p className="text-[13px] font-medium text-ink-2">Resultado de caixa do período</p>
              <p className="text-xs text-muted">Entradas − saídas registradas no período</p>
            </div>
            <p
              className={cn("tabular font-display text-xl font-semibold", cash.net < 0 ? "text-negative" : "text-ink")}
            >
              {formatBRL(cash.net)}
            </p>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-5 py-4 shadow-[var(--shadow-card)]">
            <div>
              <p className="text-[13px] font-medium text-ink-2">Lucro estimado do período</p>
              <p className={cn("text-xs", profit.complete ? "text-muted" : "text-warning")}>
                {profit.complete
                  ? `Receita ${formatBRL(profit.netRevenue + profit.shippingRevenue)} − CMV ${formatBRL(profit.costOfGoodsSold)} − custos diretos ${formatBRL(profit.directCosts)}${profit.cancellationLosses ? ` − perdas ${formatBRL(profit.cancellationLosses)}` : ""}`
                  : `Parcial: ${profit.unitsWithoutCost} placa(s) sem custo informado`}
              </p>
            </div>
            <p
              className={cn(
                "tabular font-display text-xl font-semibold",
                profit.profit < 0 ? "text-negative" : "text-ink",
              )}
            >
              {formatBRL(profit.profit)}
            </p>
          </div>
        </div>
      </section>

      {/* Livro-caixa */}
      <Card>
        <CardHeader
          title="Livro-caixa"
          description="Lançamentos confirmados em ordem cronológica. Estornos geram lançamentos compensatórios; nada é apagado."
          action={
            <Button asChild variant="secondary" size="sm">
              <a href={exportHref}>
                <Download /> CSV
              </a>
            </Button>
          }
        />
        <div className="flex flex-col gap-2 border-y border-line p-4 lg:flex-row lg:flex-wrap lg:items-center">
          <SearchFilter placeholder="Buscar descrição ou nº MOV" className="lg:w-64" />
          <div className="flex flex-wrap items-center gap-2">
            <SelectFilter
              param="tipo"
              label="Entradas e saídas"
              options={[
                { value: "IN", label: "Somente entradas" },
                { value: "OUT", label: "Somente saídas" },
              ]}
            />
            <SelectFilter
              param="categoria"
              label="Todas as categorias"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
            <SelectFilter
              param="origem"
              label="Todas as origens"
              options={ORIGINS.map((o) => ({ value: o, label: ORIGIN_LABELS[o] }))}
            />
            <ClearFilters params={["q", "tipo", "categoria", "origem"]} />
          </div>
        </div>
        <DataTable<LedgerEntry>
          rows={ledger.items}
          rowKey={(t) => t.id}
          rowClassName={(t) => (t.reversed ? "text-muted" : undefined)}
          empty={
            <EmptyState
              title="Nenhum lançamento no período"
              description="Recebimentos, despesas, compras de estoque e retiradas aparecem aqui."
            />
          }
          columns={[
            {
              key: "date",
              header: "Data e hora",
              cell: (t) => (
                <span className="tabular whitespace-nowrap text-ink-2">{formatDateTime(t.occurredAt, tz)}</span>
              ),
            },
            {
              key: "desc",
              header: "Descrição",
              cell: (t) => (
                <span className="block max-w-80">
                  <span className={cn("block truncate text-ink", t.reversed && "line-through decoration-muted")}>
                    {t.description}
                  </span>
                  <span className="block text-xs text-muted">
                    <span className="font-mono">{formatRecordNumber("MOV", t.number)}</span> · {t.originLabel}
                    {t.reversalReason ? ` · ${t.reversalReason}` : ""}
                    {t.reversed ? " · estornado" : ""}
                  </span>
                </span>
              ),
            },
            { key: "cat", header: "Categoria", cell: (t) => <span className="text-ink-2">{t.category}</span> },
            {
              key: "type",
              header: "Tipo",
              cell: (t) => (
                <Badge tone={t.direction === "IN" ? "positive" : "negative"}>
                  {t.direction === "IN" ? "Entrada" : "Saída"}
                </Badge>
              ),
            },
            {
              key: "amount",
              header: "Valor",
              align: "right",
              cell: (t) => (
                <span
                  className={cn(
                    "tabular font-medium whitespace-nowrap",
                    t.direction === "IN" ? "text-positive" : "text-negative",
                  )}
                >
                  {t.direction === "IN" ? "+" : "−"} {formatBRL(t.amount)}
                </span>
              ),
            },
            {
              key: "method",
              header: "Forma",
              cell: (t) => <span className="text-ink-2">{t.paymentMethod ?? "—"}</span>,
            },
            {
              key: "ref",
              header: "Referência",
              cell: (t) => {
                if (!t.reference) return <span className="text-muted">—</span>;
                const href = referenceHref(t.reference);
                return href ? (
                  <Link href={href} className="font-mono text-[13px] text-primary hover:underline">
                    {t.reference.label}
                  </Link>
                ) : (
                  <span className="font-mono text-[13px] text-ink-2">{t.reference.label}</span>
                );
              },
            },
            {
              key: "balance",
              header: "Saldo após",
              align: "right",
              cell: (t) => <span className="tabular whitespace-nowrap text-ink-2">{formatBRL(t.balanceAfter)}</span>,
            },
            {
              key: "actions",
              header: <span className="sr-only">Ações</span>,
              align: "right",
              cell: (t) =>
                canReverse && t.reversible ? (
                  <ReverseTransactionButton
                    transaction={{
                      id: t.id,
                      number: t.number,
                      description: t.description,
                      amount: t.amount,
                      direction: t.direction,
                    }}
                  />
                ) : null,
            },
          ]}
          mobileCard={(t) => (
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className={cn("block truncate text-sm text-ink", t.reversed && "line-through")}>
                  {t.description}
                </span>
                <span className="block text-xs text-muted">
                  {formatDateTime(t.occurredAt, tz)} · {t.category}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span
                  className={cn("tabular block font-medium", t.direction === "IN" ? "text-positive" : "text-negative")}
                >
                  {t.direction === "IN" ? "+" : "−"} {formatBRL(t.amount)}
                </span>
                <span className="tabular block text-xs text-muted">saldo {formatBRL(t.balanceAfter)}</span>
              </span>
            </div>
          )}
        />
        <Pagination
          basePath="/financeiro"
          params={sp}
          page={ledger.page}
          pageCount={ledger.pageCount}
          total={ledger.total}
          pageSize={ledger.pageSize}
          label="lançamentos"
        />
      </Card>
    </div>
  );
}
