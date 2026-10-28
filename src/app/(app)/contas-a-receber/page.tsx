import { CalendarClock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, StatStrip } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ClearFilters, DateRangeFilter, FilterBar, SearchFilter, SelectFilter } from "@/components/ui/filters";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/cn";
import { formatDate, formatDateString, isDateString } from "@/lib/dates";
import { formatBRL, formatOrderNumber, isUuid, whatsappLink } from "@/lib/format";
import { requirePageSession } from "@/server/auth/guard";
import { listPaymentMethods } from "@/server/services/finance";
import { listReceivables, type ReceivableItem, type ReceivableStatus } from "@/server/services/sales";
import { getSettingsView } from "@/server/services/settings";
import { ReceivableActions } from "./receivable-actions";

export const metadata: Metadata = { title: "Contas a receber" };

const STATUS: Record<ReceivableStatus, { label: string; tone: "negative" | "warning" | "neutral" | "outline" }> = {
  overdue: { label: "Vencida", tone: "negative" },
  due_today: { label: "Vence hoje", tone: "warning" },
  upcoming: { label: "A vencer", tone: "neutral" },
  no_due_date: { label: "Sem vencimento", tone: "outline" },
};

export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePageSession("sales.read");
  const sp = await searchParams;
  const settings = await getSettingsView();
  const tz = settings.timezone;
  const status = (Object.keys(STATUS) as ReceivableStatus[]).find((s) => s === sp.status);
  const [result, methods] = await Promise.all([
    listReceivables(
      {
        status,
        search: sp.q,
        customerId: isUuid(sp.cliente) ? sp.cliente : undefined,
        dueFrom: isDateString(sp.de) ? sp.de : undefined,
        dueTo: isDateString(sp.ate) ? sp.ate : undefined,
        page: Number(sp.page) || 1,
        pageSize: settings.pageSize,
      },
      tz,
    ),
    listPaymentMethods(),
  ]);
  const paymentMethods = methods.map((m) => ({ id: m.id, name: m.name }));

  function chargeLink(r: ReceivableItem) {
    const base = whatsappLink(r.whatsapp ?? r.phone);
    if (!base) return null;
    const text = `Olá, ${r.contactName}! Tudo bem? Passando para lembrar do pagamento do pedido ${formatOrderNumber(r.saleNumber)} (placas NFC), no valor de ${formatBRL(r.pending)}${r.dueDate ? `, com vencimento em ${formatDateString(r.dueDate)}` : ""}. Obrigado!`;
    return `${base}?text=${encodeURIComponent(text)}`;
  }

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-5">
      <PageHeader
        title="Contas a receber"
        description="Vendas registradas que ainda não foram pagas por completo. Só viram caixa quando o pagamento é registrado."
      />
      <StatStrip
        items={[
          {
            label: "Total a receber",
            value: formatBRL(result.summary.totalPending),
            tone: result.summary.totalPending > 0 ? "warning" : undefined,
          },
          {
            label: "Vencido",
            value: formatBRL(result.summary.overdueAmount),
            tone: result.summary.overdueAmount > 0 ? "negative" : undefined,
          },
          { label: "Vence hoje", value: formatBRL(result.summary.dueTodayAmount) },
          { label: "Vendas em aberto", value: String(result.summary.count) },
        ]}
      />
      <Card>
        <FilterBar
          search={<SearchFilter placeholder="Buscar cliente ou pedido" className="lg:w-64" />}
          params={["q", "status", "de", "ate", "cliente"]}
        >
          <SelectFilter
            param="status"
            label="Todos os vencimentos"
            options={(Object.keys(STATUS) as ReceivableStatus[]).map((s) => ({ value: s, label: STATUS[s].label }))}
          />
          <span className="text-xs text-muted">Vencimento:</span>
          <DateRangeFilter />
          <ClearFilters params={["q", "status", "de", "ate", "cliente"]} />
        </FilterBar>
        <DataTable<ReceivableItem>
          rows={result.items}
          rowKey={(r) => r.saleId}
          rowClassName={(r) => (r.status === "overdue" ? "bg-negative-soft/40" : undefined)}
          empty={
            <EmptyState
              icon={<CalendarClock />}
              title={result.summary.count === 0 ? "Nada a receber" : "Nenhuma conta encontrada"}
              description={result.summary.count === 0 ? "Todas as vendas estão quitadas." : "Ajuste os filtros."}
            />
          }
          columns={[
            {
              key: "customer",
              header: "Cliente",
              cell: (r) => (
                <Link href={`/clientes/${r.customerId}`} className="block max-w-56 hover:underline">
                  <span className="block truncate font-medium text-ink">{r.customerName}</span>
                  <span className="block truncate text-xs text-muted">{r.contactName}</span>
                </Link>
              ),
            },
            {
              key: "sale",
              header: "Venda",
              cell: (r) => (
                <Link href={`/vendas/${r.saleId}`} className="block">
                  <span className="block font-mono text-[13px] text-primary hover:underline">
                    {formatOrderNumber(r.saleNumber)}
                  </span>
                  <span className="tabular block text-xs text-muted">{formatDate(r.saleDate, tz)}</span>
                </Link>
              ),
            },
            {
              key: "total",
              header: "Valor original",
              align: "right",
              cell: (r) => <span className="tabular">{formatBRL(r.total)}</span>,
            },
            {
              key: "paid",
              header: "Recebido",
              align: "right",
              cell: (r) => <span className="tabular text-ink-2">{formatBRL(r.amountPaid)}</span>,
            },
            {
              key: "pending",
              header: "Saldo pendente",
              align: "right",
              cell: (r) => <span className="tabular font-semibold text-warning">{formatBRL(r.pending)}</span>,
            },
            {
              key: "due",
              header: "Vencimento",
              cell: (r) => <span className="tabular text-ink-2">{r.dueDate ? formatDateString(r.dueDate) : "—"}</span>,
            },
            {
              key: "late",
              header: "Atraso",
              align: "right",
              cell: (r) => (
                <span className={cn("tabular", r.daysOverdue > 0 ? "font-medium text-negative" : "text-muted")}>
                  {r.daysOverdue > 0 ? `${r.daysOverdue} dia(s)` : "—"}
                </span>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>,
            },
            {
              key: "actions",
              header: <span className="sr-only">Ações</span>,
              align: "right",
              cell: (r) => (
                <ReceivableActions
                  sale={{
                    id: r.saleId,
                    number: r.saleNumber,
                    customerName: r.customerName,
                    total: r.total,
                    amountPaid: r.amountPaid,
                  }}
                  paymentMethods={paymentMethods}
                  timezone={tz}
                  whatsappHref={chargeLink(r)}
                />
              ),
            },
          ]}
          mobileCard={(r) => (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/vendas/${r.saleId}`} className="min-w-0">
                  <span className="block truncate font-medium text-ink">{r.customerName}</span>
                  <span className="block text-xs text-muted">
                    <span className="font-mono">{formatOrderNumber(r.saleNumber)}</span> ·{" "}
                    {r.dueDate ? `vence ${formatDateString(r.dueDate)}` : "sem vencimento"}
                  </span>
                </Link>
                <span className="shrink-0 text-right">
                  <span className="tabular block font-semibold text-warning">{formatBRL(r.pending)}</span>
                  <Badge tone={STATUS[r.status].tone}>
                    {r.daysOverdue > 0 ? `${r.daysOverdue}d em atraso` : STATUS[r.status].label}
                  </Badge>
                </span>
              </div>
              <ReceivableActions
                sale={{
                  id: r.saleId,
                  number: r.saleNumber,
                  customerName: r.customerName,
                  total: r.total,
                  amountPaid: r.amountPaid,
                }}
                paymentMethods={paymentMethods}
                timezone={tz}
                whatsappHref={chargeLink(r)}
              />
            </div>
          )}
        />
        <Pagination
          basePath="/contas-a-receber"
          params={sp}
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          pageSize={result.pageSize}
          label="vendas"
        />
      </Card>
    </div>
  );
}
