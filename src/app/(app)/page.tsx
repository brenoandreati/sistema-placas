import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CashFlowChart, SalesChart, UnitsChart } from "@/components/charts/dashboard-charts";
import { ActivityList } from "@/components/dashboard/activity-list";
import { AlertsList } from "@/components/dashboard/alerts-list";
import { Delta } from "@/components/dashboard/delta";
import { Kpi, Money } from "@/components/dashboard/kpi";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { StockMeter } from "@/components/dashboard/stock-meter";
import { QuickActionButton } from "@/components/quick-actions";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatDateString, isPeriodPreset, previousPeriod, resolvePeriod } from "@/lib/dates";
import { formatBRL, formatInteger, formatPercent, percentChange, pluralize } from "@/lib/format";
import { requirePageSession } from "@/server/auth/guard";
import { getAlerts } from "@/server/services/alerts";
import { getInventoryOverview } from "@/server/services/inventory";
import {
  getCashFlowMetrics,
  getCurrentPosition,
  getProfitMetrics,
  getRecentActivity,
  getSalesMetrics,
  getTimeSeries,
} from "@/server/services/metrics";
import { getSettingsView } from "@/server/services/settings";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; de?: string; ate?: string; acesso?: string }>;
}) {
  await requirePageSession("dashboard.read");
  const settings = await getSettingsView();
  if (!settings.setupCompleted) redirect("/configuracao-inicial");

  const sp = await searchParams;
  const tz = settings.timezone;
  const preset = isPeriodPreset(sp.periodo) ? sp.periodo : settings.dashboardDefaultPeriod;
  const period = resolvePeriod(preset, tz, { from: sp.de, to: sp.ate });
  const previous = previousPeriod(period, tz);

  const [sales, salesPrev, cash, cashPrev, profit, profitPrev, position, series, alerts, activity, inventory] =
    await Promise.all([
      getSalesMetrics(period),
      getSalesMetrics(previous),
      getCashFlowMetrics(period),
      getCashFlowMetrics(previous),
      getProfitMetrics(period),
      getProfitMetrics(previous),
      getCurrentPosition(tz),
      getTimeSeries(period, tz),
      getAlerts(tz, settings.recentWithdrawalDays),
      getRecentActivity(8),
      getInventoryOverview(),
    ]);

  const minStockTotal = inventory.minStockTotal;
  const rangeLabel =
    period.from === period.to
      ? formatDateString(period.from)
      : `${formatDateString(period.from)} a ${formatDateString(period.to)}`;
  const hasAnySale = sales.orders > 0 || salesPrev.orders > 0 || activity.length > 0;

  const comparison = [
    { label: "Pedidos", current: sales.orders, previous: salesPrev.orders, format: formatInteger, upIsGood: true },
    {
      label: "Placas vendidas",
      current: sales.units,
      previous: salesPrev.units,
      format: formatInteger,
      upIsGood: true,
    },
    {
      label: "Valor bruto vendido",
      current: sales.gross,
      previous: salesPrev.gross,
      format: formatBRL,
      upIsGood: true,
    },
    {
      label: "Receita líquida",
      current: sales.netProducts,
      previous: salesPrev.netProducts,
      format: formatBRL,
      upIsGood: true,
    },
    {
      label: "Valores recebidos",
      current: cash.netSalesReceipts,
      previous: cashPrev.netSalesReceipts,
      format: formatBRL,
      upIsGood: true,
    },
    { label: "Despesas", current: cash.expenses, previous: cashPrev.expenses, format: formatBRL, upIsGood: false },
    {
      label: "Retiradas",
      current: cash.withdrawals,
      previous: cashPrev.withdrawals,
      format: formatBRL,
      upIsGood: false,
    },
    { label: "Lucro estimado", current: profit.profit, previous: profitPrev.profit, format: formatBRL, upIsGood: true },
  ];

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-tight text-ink">Visão geral</h1>
          <p className="mt-0.5 text-sm text-muted">
            {period.label} · {rangeLabel}
          </p>
        </div>
        <PeriodSelector preset={period.preset} from={period.from} to={period.to} />
      </div>

      {sp.acesso === "negado" && (
        <p role="alert" className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          Seu perfil não tem acesso à página solicitada. Peça a um administrador para ajustar suas permissões.
        </p>
      )}

      {/* Posição atual: não depende do período */}
      <section
        aria-label="Posição atual"
        className="grid overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)] md:grid-cols-[1.15fr_1fr]"
      >
        <div className="flex flex-col gap-3 border-b border-line p-5 sm:p-6 md:border-r md:border-b-0">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-ink-2">Saldo disponível em caixa</p>
            <Link href="/financeiro" className="text-xs font-medium text-primary hover:underline">
              Livro-caixa →
            </Link>
          </div>
          <p
            className={cn(
              "figure font-display text-[44px] leading-none font-semibold tracking-tight sm:text-[52px]",
              position.balance < 0 ? "text-negative" : "text-ink",
            )}
          >
            <Money value={position.balance} />
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
            <div>
              <dt className="text-muted">Saldo inicial</dt>
              <dd className="tabular font-medium text-ink">{formatBRL(position.openingBalance)}</dd>
            </div>
            <div>
              <dt className="text-muted">A receber</dt>
              <dd className="tabular font-medium text-ink">
                <Link href="/contas-a-receber" className="hover:underline">
                  {formatBRL(position.receivables.total)}
                </Link>
              </dd>
            </div>
            {position.receivables.overdue > 0 && (
              <div>
                <dt className="text-muted">Em atraso</dt>
                <dd className="tabular font-medium text-negative">{formatBRL(position.receivables.overdue)}</dd>
              </div>
            )}
          </dl>
        </div>
        <div className="flex flex-col gap-3 p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-ink-2">Placas disponíveis</p>
            <Link href="/estoque" className="text-xs font-medium text-primary hover:underline">
              Estoque →
            </Link>
          </div>
          <p className="flex items-baseline gap-2">
            <span
              className={cn(
                "figure font-display text-[44px] leading-none font-semibold tracking-tight sm:text-[52px]",
                inventory.outOfStock > 0 && position.availableUnits === 0 ? "text-negative" : "text-ink",
              )}
            >
              {formatInteger(position.availableUnits)}
            </span>
            <span className="text-sm text-muted">
              {position.availableUnits === 1 ? "placa pronta para venda" : "placas prontas para venda"}
            </span>
          </p>
          <StockMeter current={position.availableUnits} minimum={minStockTotal} className="mt-1 mb-3" />
          <p className="text-[13px] text-muted">
            {inventory.activeProducts === 0
              ? "Nenhum produto cadastrado."
              : `Estoque mínimo: ${formatInteger(minStockTotal)} un.${inventory.stockValueComplete ? ` · Valor em estoque: ${formatBRL(inventory.stockValue)}` : ""}`}
          </p>
        </div>
      </section>

      {/* Indicadores do período */}
      <section aria-label="Indicadores do período" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Placas vendidas"
          value={formatInteger(sales.units)}
          unit={sales.units === 1 ? "unidade" : "unidades"}
          detail={`${pluralize(sales.orders, "pedido", "pedidos")}${sales.cancelledOrders ? ` · ${pluralize(sales.cancelledOrders, "cancelado", "cancelados")}` : ""}`}
          footer={<Delta current={sales.units} previous={salesPrev.units} />}
        />
        <Kpi
          label="Valor bruto vendido"
          value={<Money value={sales.gross} />}
          detail={
            <dl className="grid gap-0.5">
              <div className="flex justify-between">
                <dt>Descontos</dt>
                <dd className="tabular">− {formatBRL(sales.discounts)}</dd>
              </div>
              <div className="flex justify-between font-medium text-ink-2">
                <dt>Receita líquida</dt>
                <dd className="tabular">{formatBRL(sales.netProducts)}</dd>
              </div>
              {sales.shipping > 0 && (
                <div className="flex justify-between">
                  <dt>Frete cobrado</dt>
                  <dd className="tabular">+ {formatBRL(sales.shipping)}</dd>
                </div>
              )}
            </dl>
          }
          footer={<Delta current={sales.gross} previous={salesPrev.gross} />}
        />
        <Kpi
          label="Valores recebidos"
          value={<Money value={cash.netSalesReceipts} />}
          tone={cash.netSalesReceipts > 0 ? "positive" : "neutral"}
          detail={
            <>
              Dinheiro que entrou no caixa por vendas.
              {cash.salesRefunds > 0 && <> Estornos: {formatBRL(cash.salesRefunds)}.</>}
              {sales.pendingOfPeriodSales > 0 && (
                <span className="mt-1 block text-warning">
                  {formatBRL(sales.pendingOfPeriodSales)} das vendas do período ainda a receber
                </span>
              )}
            </>
          }
          footer={<Delta current={cash.netSalesReceipts} previous={cashPrev.netSalesReceipts} />}
        />
        <Kpi
          label="Lucro estimado"
          value={<Money value={profit.profit} />}
          tone={profit.profit < 0 ? "negative" : "neutral"}
          detail={
            profit.complete ? (
              <>
                Receita líquida − custo das placas ({formatBRL(profit.costOfGoodsSold)}) − custos diretos (
                {formatBRL(profit.directCosts)})
                {profit.margin !== null && <> · margem {formatPercent(profit.margin)}</>}
              </>
            ) : (
              <span className="text-warning">
                Parcial: {pluralize(profit.unitsWithoutCost, "placa vendida", "placas vendidas")} sem custo de
                aquisição.{" "}
                <Link href="/estoque?acao=custo" className="font-medium underline underline-offset-2">
                  Informar custo
                </Link>
              </span>
            )
          }
          footer={<Delta current={profit.profit} previous={profitPrev.profit} />}
        />
      </section>

      {!hasAnySale && (
        <Card className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-ink">Pronto para a primeira venda</p>
            <p className="text-sm text-muted">
              Cadastre o cliente na hora e o estoque e o caixa são atualizados automaticamente.
            </p>
          </div>
          <QuickActionButton action={{ type: "sale" }}>
            <Plus /> Registrar venda
          </QuickActionButton>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <SalesChart points={series.points} granularity={series.granularity} />
        </div>
        <Card className="flex flex-col">
          <CardHeader
            title="Alertas"
            description={
              alerts.length ? pluralize(alerts.length, "item pede atenção", "itens pedem atenção") : undefined
            }
          />
          <AlertsList alerts={alerts} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UnitsChart points={series.points} />
        <CashFlowChart points={series.points} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Comparativo com o período anterior" description={`${previous.label}`} />
          <div className="overflow-x-auto px-5 pb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th scope="col" className="py-2 text-left font-medium">
                    Indicador
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Atual
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Anterior
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Variação
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {comparison.map((row) => {
                  const change = percentChange(row.current, row.previous);
                  const good = change !== null && change !== 0 && change > 0 === row.upIsGood;
                  return (
                    <tr key={row.label}>
                      <td className="py-2 text-ink-2">{row.label}</td>
                      <td className="tabular py-2 text-right font-medium text-ink">{row.format(row.current)}</td>
                      <td className="tabular py-2 text-right text-muted">{row.format(row.previous)}</td>
                      <td
                        className={cn(
                          "tabular py-2 text-right text-[13px]",
                          change === null || change === 0 ? "text-muted" : good ? "text-positive" : "text-negative",
                        )}
                      >
                        {change === null
                          ? "—"
                          : change === 0
                            ? "0%"
                            : `${change > 0 ? "+" : "−"}${formatPercent(Math.abs(change))}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Atividades recentes"
            action={
              <Link href="/financeiro" className="text-xs font-medium text-primary hover:underline">
                Ver livro-caixa
              </Link>
            }
          />
          <ActivityList items={activity} tz={tz} />
        </Card>
      </div>
    </div>
  );
}
