import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { PageHeader, StatStrip } from "@/components/page-header";
import { PaymentStatusBadge, SaleStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/link-tabs";
import { cn } from "@/lib/cn";
import { formatDate, formatDateString, isPeriodPreset, previousPeriod, resolvePeriod, type Period } from "@/lib/dates";
import {
  formatBRL,
  formatInteger,
  formatOrderNumber,
  formatPercent,
  formatRecordNumber,
  percentChange,
} from "@/lib/format";
import { requirePageSession } from "@/server/auth/guard";
import {
  getCustomersReport,
  getFinancialReport,
  getSalesReport,
  getStockReport,
  getWithdrawalsReport,
} from "@/server/services/reports";
import { getSettingsView } from "@/server/services/settings";

export const metadata: Metadata = { title: "Relatórios" };

const TABS = [
  { key: "vendas", label: "Vendas" },
  { key: "estoque", label: "Estoque" },
  { key: "clientes", label: "Clientes" },
  { key: "financeiro", label: "Financeiro" },
  { key: "retiradas", label: "Retiradas" },
];

const GROUP_LABELS: Record<string, string> = {
  SALES_RECEIPT: "Recebimentos de vendas",
  SALES_REFUND: "Estornos de vendas",
  STOCK_PURCHASE: "Compras de estoque",
  EXPENSE: "Despesas",
  WITHDRAWAL: "Retiradas",
  CAPITAL_CONTRIBUTION: "Aportes",
  OTHER_INCOME: "Outras entradas",
};

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2.5 text-xs font-medium whitespace-nowrap text-muted first:pl-5 last:pr-5",
        right ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}
function Td({ children, right, className }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return (
    <td className={cn("px-4 py-2.5 first:pl-5 last:pr-5", right && "tabular text-right", className)}>{children}</td>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePageSession("reports.read");
  const sp = await searchParams;
  const settings = await getSettingsView();
  const tz = settings.timezone;
  const tab = TABS.some((t) => t.key === sp.aba) ? sp.aba! : "vendas";
  const preset = isPeriodPreset(sp.periodo) ? sp.periodo : "month";
  const period = resolvePeriod(preset, tz, { from: sp.de, to: sp.ate });
  const query = new URLSearchParams({
    periodo: period.preset,
    ...(period.preset === "custom" ? { de: period.from, ate: period.to } : {}),
  });
  const csvHref = `/api/relatorios/${tab}?periodo=${period.preset}&de=${period.from}&ate=${period.to}`;
  const rangeLabel =
    period.from === period.to
      ? formatDateString(period.from)
      : `${formatDateString(period.from)} a ${formatDateString(period.to)}`;

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-5">
      <PageHeader
        title="Relatórios"
        description={`${period.label} · ${rangeLabel}`}
        actions={<PeriodSelector preset={period.preset} from={period.from} to={period.to} />}
      />
      <div className="flex items-end justify-between gap-3">
        <LinkTabs
          className="flex-1"
          items={TABS.map((t) => ({ ...t, href: `/relatorios?aba=${t.key}&${query}` }))}
          active={tab}
        />
        <Button asChild variant="secondary" size="sm" className="mb-1.5 shrink-0">
          <a href={csvHref}>
            <Download /> Exportar CSV
          </a>
        </Button>
      </div>
      {tab === "vendas" && <SalesTab period={period} tz={tz} />}
      {tab === "estoque" && <StockTab period={period} />}
      {tab === "clientes" && <CustomersTab period={period} />}
      {tab === "financeiro" && <FinanceTab period={period} />}
      {tab === "retiradas" && <WithdrawalsTab period={period} tz={tz} />}
    </div>
  );
}

async function SalesTab({ period, tz }: { period: Period; tz: string }) {
  const report = await getSalesReport(period);
  const m = report.metrics;
  return (
    <>
      <StatStrip
        items={[
          { label: "Pedidos", value: formatInteger(m.orders) },
          { label: "Unidades vendidas", value: formatInteger(m.units) },
          { label: "Faturamento bruto", value: formatBRL(m.gross) },
          { label: "Descontos concedidos", value: formatBRL(m.discounts) },
        ]}
      />
      <StatStrip
        items={[
          { label: "Receita líquida", value: formatBRL(m.netProducts) },
          { label: "Frete cobrado", value: formatBRL(m.shipping) },
          { label: "Valores recebidos no período", value: formatBRL(report.received), tone: "positive" },
          {
            label: "Pendente das vendas do período",
            value: formatBRL(m.pendingOfPeriodSales),
            tone: m.pendingOfPeriodSales > 0 ? "warning" : undefined,
          },
        ]}
      />
      <Card>
        <CardHeader title="Vendas do período" description="Canceladas aparecem esmaecidas e não entram nos totais." />
        {report.rows.length === 0 ? (
          <EmptyState title="Nenhuma venda no período" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-line bg-surface-2/70">
                <tr>
                  <Th>Pedido</Th>
                  <Th>Data</Th>
                  <Th>Cliente</Th>
                  <Th right>Placas</Th>
                  <Th right>Bruto</Th>
                  <Th right>Desconto</Th>
                  <Th right>Total</Th>
                  <Th right>Recebido</Th>
                  <Th>Venda</Th>
                  <Th>Financeiro</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.rows.map((r) => (
                  <tr key={r.id} className={r.status === "CANCELLED" ? "opacity-55" : undefined}>
                    <Td>
                      <Link href={`/vendas/${r.id}`} className="font-mono text-[13px] text-primary hover:underline">
                        {formatOrderNumber(r.number)}
                      </Link>
                    </Td>
                    <Td className="tabular text-ink-2">{formatDate(r.saleDate, tz)}</Td>
                    <Td>{r.customer}</Td>
                    <Td right>{formatInteger(r.units)}</Td>
                    <Td right>{formatBRL(r.gross)}</Td>
                    <Td right>{formatBRL(r.discount)}</Td>
                    <Td right className="font-medium">
                      {formatBRL(r.total)}
                    </Td>
                    <Td right>{formatBRL(r.paid)}</Td>
                    <Td>
                      <SaleStatusBadge status={r.status} />
                    </Td>
                    <Td>
                      <PaymentStatusBadge status={r.paymentStatus} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

async function StockTab({ period }: { period: Period }) {
  const report = await getStockReport(period);
  const t = report.totals;
  return (
    <>
      <StatStrip
        items={[
          { label: "Estoque atual", value: `${formatInteger(t.currentStock)} un.` },
          { label: "Entradas no período", value: `${formatInteger(t.entries)} un.` },
          { label: "Vendidas no período", value: `${formatInteger(t.sold)} un.` },
          { label: "Ajustes no período", value: `${t.adjustments > 0 ? "+" : ""}${formatInteger(t.adjustments)} un.` },
        ]}
      />
      <StatStrip
        className="sm:grid-cols-3"
        items={[
          { label: "Devolvidas (cancelamentos)", value: `${formatInteger(t.returned)} un.` },
          { label: "Custo médio do estoque", value: t.averageCost === null ? "—" : formatBRL(t.averageCost) },
          {
            label: "Valor do estoque (custo)",
            value: t.valueComplete ? formatBRL(t.stockValue) : `${formatBRL(t.stockValue)} (parcial)`,
          },
        ]}
      />
      <Card>
        <CardHeader title="Por produto" />
        {report.rows.length === 0 ? (
          <EmptyState title="Nenhum produto cadastrado" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-line bg-surface-2/70">
                <tr>
                  <Th>Produto</Th>
                  <Th right>Atual</Th>
                  <Th right>Entradas</Th>
                  <Th right>Vendidas</Th>
                  <Th right>Devolvidas</Th>
                  <Th right>Ajustes</Th>
                  <Th right>Custo médio</Th>
                  <Th right>Valor em estoque</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.rows.map((r) => (
                  <tr key={r.id} className={!r.active ? "opacity-55" : undefined}>
                    <Td>
                      <span className="block font-medium text-ink">{r.name}</span>
                      <span className="font-mono text-xs text-muted">{r.sku}</span>
                    </Td>
                    <Td right className={r.status !== "ok" ? "font-medium text-warning" : undefined}>
                      {formatInteger(r.currentStock)}
                    </Td>
                    <Td right>{formatInteger(r.entries)}</Td>
                    <Td right>{formatInteger(r.sold)}</Td>
                    <Td right>{formatInteger(r.returned)}</Td>
                    <Td right>{formatInteger(r.adjustments)}</Td>
                    <Td right>{r.averageCost === null ? "—" : formatBRL(r.averageCost)}</Td>
                    <Td right>{r.stockValue === null ? "—" : formatBRL(r.stockValue)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

async function CustomersTab({ period }: { period: Period }) {
  const report = await getCustomersReport(period);
  return (
    <>
      <StatStrip
        items={[
          { label: "Clientes cadastrados", value: formatInteger(report.registered) },
          { label: "Novos no período", value: formatInteger(report.newInPeriod) },
          { label: "Compraram no período", value: formatInteger(report.buyers) },
          { label: "Recorrentes (2+ pedidos)", value: formatInteger(report.recurring) },
        ]}
      />
      <Card>
        <CardHeader title="Clientes que compraram no período" description="Ordenados pelo valor comprado no período." />
        {report.rows.length === 0 ? (
          <EmptyState title="Nenhum cliente comprou no período" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-line bg-surface-2/70">
                <tr>
                  <Th>Cliente</Th>
                  <Th right>Pedidos</Th>
                  <Th right>Placas</Th>
                  <Th right>Valor no período</Th>
                  <Th right>Total histórico</Th>
                  <Th>Perfil</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.rows.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <Link href={`/clientes/${r.id}`} className="block hover:underline">
                        <span className="block font-medium text-ink">{r.businessName}</span>
                        <span className="block text-xs text-muted">{r.contactName}</span>
                      </Link>
                    </Td>
                    <Td right>{formatInteger(r.periodOrders)}</Td>
                    <Td right>{formatInteger(r.periodUnits)}</Td>
                    <Td right className="font-medium">
                      {formatBRL(r.periodTotal)}
                    </Td>
                    <Td right>{formatBRL(r.allTotal)}</Td>
                    <Td>
                      {r.recurring ? (
                        <Badge tone="positive">Recorrente</Badge>
                      ) : (
                        <Badge tone="neutral">Primeira compra</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

async function FinanceTab({ period }: { period: Period }) {
  const report = await getFinancialReport(period);
  const c = report.cash;
  return (
    <>
      <StatStrip
        items={[
          { label: "Saldo no início", value: formatBRL(report.openingBalance) },
          { label: "Entradas", value: formatBRL(c.totalIn), tone: "positive" },
          { label: "Saídas", value: formatBRL(c.totalOut), tone: "negative" },
          { label: "Saldo no fim", value: formatBRL(report.closingBalance) },
        ]}
      />
      <StatStrip
        items={[
          { label: "Despesas", value: formatBRL(c.expenses) },
          { label: "Retiradas", value: formatBRL(c.withdrawals) },
          { label: "Aportes", value: formatBRL(c.capitalContributions) },
          {
            label: report.profit.complete ? "Lucro estimado" : "Lucro estimado (parcial)",
            value: formatBRL(report.profit.profit),
            tone: report.profit.profit < 0 ? "negative" : undefined,
          },
        ]}
      />
      <Card>
        <CardHeader
          title="Por categoria"
          description="Estornos aparecem como movimento contrário na mesma categoria."
        />
        {report.categoryRows.length === 0 ? (
          <EmptyState title="Nenhum lançamento no período" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-line bg-surface-2/70">
                <tr>
                  <Th>Grupo</Th>
                  <Th>Categoria</Th>
                  <Th right>Entradas</Th>
                  <Th right>Saídas</Th>
                  <Th right>Líquido</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.categoryRows.map((r) => (
                  <tr key={r.id}>
                    <Td className="text-ink-2">{GROUP_LABELS[r.group] ?? r.group}</Td>
                    <Td>{r.name}</Td>
                    <Td right className="text-positive">
                      {r.inflow ? formatBRL(r.inflow) : "—"}
                    </Td>
                    <Td right className="text-negative">
                      {r.outflow ? formatBRL(r.outflow) : "—"}
                    </Td>
                    <Td right className={cn("font-medium", r.net < 0 ? "text-negative" : "text-ink")}>
                      {formatBRL(r.net)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

async function WithdrawalsTab({ period, tz }: { period: Period; tz: string }) {
  const previous = previousPeriod(period, tz);
  const report = await getWithdrawalsReport(period, previous);
  const change = percentChange(report.total, report.previousTotal);
  return (
    <>
      <StatStrip
        items={[
          { label: "Total retirado", value: formatBRL(report.total) },
          { label: "Média por mês", value: formatBRL(report.monthlyAverage) },
          {
            label: `Período anterior (${formatDateString(previous.from)} a ${formatDateString(previous.to)})`,
            value: formatBRL(report.previousTotal),
          },
          {
            label: "Variação",
            value:
              change === null ? "—" : `${change > 0 ? "+" : change < 0 ? "−" : ""}${formatPercent(Math.abs(change))}`,
            tone: change !== null && change > 0 ? "warning" : undefined,
          },
        ]}
      />
      {report.byCategory.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[13px]">
          {report.byCategory.map((c) => (
            <span key={c.name} className="rounded-full border border-line bg-surface px-3 py-1 text-ink-2">
              {c.name}: <span className="tabular font-medium text-ink">{formatBRL(c.amount)}</span>
            </span>
          ))}
        </div>
      )}
      <Card>
        <CardHeader title="Histórico detalhado" />
        {report.rows.length === 0 ? (
          <EmptyState title="Nenhuma retirada no período" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-line bg-surface-2/70">
                <tr>
                  <Th>Retirada</Th>
                  <Th>Data</Th>
                  <Th>Categoria</Th>
                  <Th>Descrição</Th>
                  <Th right>Valor</Th>
                  <Th right>Saldo após</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.rows.map((r) => (
                  <tr key={r.id} className={r.status === "REVERSED" ? "opacity-55" : undefined}>
                    <Td className="font-mono text-[13px] text-ink-2">{formatRecordNumber("RET", r.number)}</Td>
                    <Td className="tabular text-ink-2">{formatDate(r.withdrawnAt, tz)}</Td>
                    <Td>{r.category}</Td>
                    <Td className="text-ink-2">{r.description}</Td>
                    <Td right className="font-medium text-negative">
                      {formatBRL(r.amount)}
                    </Td>
                    <Td right>{formatBRL(r.balanceAfter)}</Td>
                    <Td>
                      {r.status === "ACTIVE" ? (
                        <Badge tone="neutral">Ativa</Badge>
                      ) : (
                        <Badge tone="outline">Estornada</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
