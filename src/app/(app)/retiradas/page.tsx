import { ArrowUpRight, Download } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader, StatStrip } from "@/components/page-header";
import { QuickActionButton } from "@/components/quick-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ClearFilters, DateRangeFilter, FilterBar, SelectFilter } from "@/components/ui/filters";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/cn";
import { addDaysToDate, formatDate, formatDateTime, isDateString, startOfLocalDay } from "@/lib/dates";
import { formatBRL, formatRecordNumber, isUuid } from "@/lib/format";
import { requirePageSession } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { listCategories } from "@/server/services/finance";
import { getSettingsView } from "@/server/services/settings";
import { getWithdrawalSummary, listWithdrawals, type WithdrawalView } from "@/server/services/withdrawals";
import { WithdrawalDetails } from "./withdrawal-details";

export const metadata: Metadata = { title: "Retiradas" };

const KIND_LABEL: Record<string, string> = {
  OWNER_DRAW: "Retiradas pessoais",
  PROFIT_DISTRIBUTION: "Distribuição de lucros",
  REIMBURSEMENT: "Reembolsos",
  OTHER: "Outras",
};

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePageSession("finance.read");
  const sp = await searchParams;
  const settings = await getSettingsView();
  const tz = settings.timezone;
  const [summary, categories, result] = await Promise.all([
    getWithdrawalSummary(tz),
    listCategories({ includeInactive: true }),
    listWithdrawals({
      from: isDateString(sp.de) ? startOfLocalDay(sp.de, tz) : undefined,
      to: isDateString(sp.ate) ? startOfLocalDay(addDaysToDate(sp.ate, 1), tz) : undefined,
      categoryId: isUuid(sp.categoria) ? sp.categoria : undefined,
      status: sp.status === "ACTIVE" || sp.status === "REVERSED" ? sp.status : undefined,
      page: Number(sp.page) || 1,
      pageSize: settings.pageSize,
    }),
  ]);
  const withdrawalCategories = categories.filter((c) => c.group === "WITHDRAWAL");
  const canWrite = can(session.user.role, "withdrawals.write");
  const canReverse = can(session.user.role, "finance.reverse");
  const exportHref = `/api/relatorios/retiradas?${new URLSearchParams(Object.entries({ de: sp.de, ate: sp.ate }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-5">
      <PageHeader
        title="Retiradas"
        description="Dinheiro que saiu do negócio para o proprietário. Reduz o caixa, mas não é despesa nem altera o faturamento."
        actions={
          <>
            <Button asChild variant="secondary">
              <a href={exportHref}>
                <Download /> CSV
              </a>
            </Button>
            {canWrite && (
              <QuickActionButton action={{ type: "withdrawal" }}>
                <ArrowUpRight /> Nova retirada
              </QuickActionButton>
            )}
          </>
        }
      />
      <StatStrip
        items={[
          { label: "Retirado no mês", value: formatBRL(summary.month) },
          { label: "Retirado no ano", value: formatBRL(summary.year) },
          { label: "Total histórico", value: formatBRL(summary.allTime) },
          {
            label: "Última retirada",
            value: summary.last ? (
              <span className="flex flex-col">
                <span>{formatBRL(summary.last.amount)}</span>
                <span className="font-sans text-xs font-normal text-muted">
                  {formatDate(summary.last.withdrawnAt, tz)} · {summary.last.category}
                </span>
              </span>
            ) : (
              "—"
            ),
          },
        ]}
      />
      {summary.byKind.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[13px]">
          {summary.byKind.map((k) => (
            <span key={k.kind} className="rounded-full border border-line bg-surface px-3 py-1 text-ink-2">
              {KIND_LABEL[k.kind] ?? k.kind}:{" "}
              <span className="tabular font-medium text-ink">{formatBRL(k.amount)}</span>
            </span>
          ))}
        </div>
      )}
      <Card>
        <FilterBar params={["categoria", "status", "de", "ate"]}>
          <SelectFilter
            param="categoria"
            label="Todas as categorias"
            options={withdrawalCategories.map((c) => ({ value: c.id, label: c.name }))}
          />
          <SelectFilter
            param="status"
            label="Ativas e estornadas"
            options={[
              { value: "ACTIVE", label: "Somente ativas" },
              { value: "REVERSED", label: "Somente estornadas" },
            ]}
          />
          <DateRangeFilter />
          <ClearFilters params={["categoria", "status", "de", "ate"]} />
        </FilterBar>
        <DataTable<WithdrawalView>
          rows={result.items}
          rowKey={(w) => w.id}
          rowClassName={(w) => (w.status === "REVERSED" ? "opacity-60" : undefined)}
          empty={
            <EmptyState
              icon={<ArrowUpRight />}
              title="Nenhuma retirada registrada"
              description="Registre aqui o dinheiro retirado do caixa. O saldo é atualizado na hora e o histórico fica preservado."
              action={
                canWrite ? (
                  <QuickActionButton action={{ type: "withdrawal" }}>
                    <ArrowUpRight /> Registrar retirada
                  </QuickActionButton>
                ) : undefined
              }
            />
          }
          columns={[
            {
              key: "date",
              header: "Data",
              cell: (w) => (
                <span className="tabular whitespace-nowrap text-ink-2">{formatDateTime(w.withdrawnAt, tz)}</span>
              ),
            },
            {
              key: "amount",
              header: "Valor",
              align: "right",
              cell: (w) => (
                <span
                  className={cn(
                    "tabular font-semibold",
                    w.status === "ACTIVE" ? "text-negative" : "text-muted line-through",
                  )}
                >
                  − {formatBRL(w.amount)}
                </span>
              ),
            },
            { key: "category", header: "Categoria", cell: (w) => <span className="text-ink">{w.category}</span> },
            { key: "method", header: "Forma", cell: (w) => <span className="text-ink-2">{w.paymentMethod}</span> },
            {
              key: "balance",
              header: "Saldo após",
              align: "right",
              cell: (w) => <span className="tabular text-ink-2">{formatBRL(w.balanceAfter)}</span>,
            },
            {
              key: "desc",
              header: "Descrição",
              cell: (w) => (
                <span className="block max-w-64">
                  <span className="block truncate text-ink-2">{w.description}</span>
                  <span className="font-mono text-xs text-muted">{formatRecordNumber("RET", w.number)}</span>
                </span>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (w) =>
                w.status === "ACTIVE" ? <Badge tone="neutral">Ativa</Badge> : <Badge tone="outline">Estornada</Badge>,
            },
            {
              key: "actions",
              header: <span className="sr-only">Ações</span>,
              align: "right",
              cell: (w) => <WithdrawalDetails withdrawal={w} timezone={tz} canReverse={canReverse} autoOpen />,
            },
          ]}
          mobileCard={(w) => (
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">{w.category}</span>
                <span className="block text-xs text-muted">
                  {formatDate(w.withdrawnAt, tz)} · {w.description}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span
                  className={cn(
                    "tabular font-semibold",
                    w.status === "ACTIVE" ? "text-negative" : "text-muted line-through",
                  )}
                >
                  − {formatBRL(w.amount)}
                </span>
                <WithdrawalDetails withdrawal={w} timezone={tz} canReverse={canReverse} />
              </span>
            </div>
          )}
        />
        <Pagination
          basePath="/retiradas"
          params={sp}
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          pageSize={result.pageSize}
          label="retiradas"
        />
      </Card>
    </div>
  );
}
