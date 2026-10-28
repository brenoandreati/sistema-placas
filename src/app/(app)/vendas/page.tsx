import { Plus, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, StatStrip } from "@/components/page-header";
import { QuickActionButton } from "@/components/quick-actions";
import { PaymentStatusBadge, SaleStatusBadge } from "@/components/status";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ClearFilters, DateRangeFilter, SearchFilter, SelectFilter } from "@/components/ui/filters";
import { Pagination } from "@/components/ui/pagination";
import { addDaysToDate, formatDate, isDateString, startOfLocalDay } from "@/lib/dates";
import { formatBRL, formatInteger, formatOrderNumber, isUuid } from "@/lib/format";
import type { SalePaymentStatus, SaleStatus } from "@/generated/prisma/enums";
import { requirePageSession } from "@/server/auth/guard";
import { prisma } from "@/server/db";
import { num } from "@/server/money";
import { listPaymentMethods } from "@/server/services/finance";
import { listSales, type SaleFilters, type SaleListItem } from "@/server/services/sales";
import { getSettingsView } from "@/server/services/settings";
import { SaleRowActions } from "./sale-row-actions";
import { ValueRangeFilter } from "./value-range-filter";

export const metadata: Metadata = { title: "Vendas" };

const SALE_STATUSES = ["REGISTERED", "PREPARING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
const PAYMENT_STATUSES = ["PENDING", "PARTIAL", "PAID", "REFUNDED", "CANCELLED"] as const;

type SP = Record<string, string | undefined>;

export default async function SalesPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePageSession("sales.read");
  const sp = await searchParams;
  const settings = await getSettingsView();
  const tz = settings.timezone;
  const paymentMethods = await listPaymentMethods({ includeInactive: true });

  const filters: SaleFilters = {
    search: sp.q,
    status: SALE_STATUSES.includes(sp.status as SaleStatus) ? (sp.status as SaleStatus) : undefined,
    paymentStatus: PAYMENT_STATUSES.includes(sp.pagamento as SalePaymentStatus)
      ? (sp.pagamento as SalePaymentStatus)
      : undefined,
    paymentMethodId: paymentMethods.some((m) => m.id === sp.forma) ? sp.forma : undefined,
    customerId: isUuid(sp.cliente) ? sp.cliente : undefined,
    from: isDateString(sp.de) ? startOfLocalDay(sp.de, tz) : undefined,
    to: isDateString(sp.ate) ? startOfLocalDay(addDaysToDate(sp.ate, 1), tz) : undefined,
    minTotal: sp.min && Number(sp.min) >= 0 ? Number(sp.min) : undefined,
    maxTotal: sp.max && Number(sp.max) >= 0 ? Number(sp.max) : undefined,
    page: Number(sp.page) || 1,
    pageSize: settings.pageSize,
  };
  const [result, totalSales] = await Promise.all([listSales(filters, tz), prisma.sale.count()]);
  const customer = isUuid(sp.cliente)
    ? await prisma.customer.findUnique({ where: { id: sp.cliente }, select: { businessName: true } })
    : null;

  const pageTotals = result.items.reduce(
    (acc, s) => ({
      total: acc.total + (s.status === "CANCELLED" ? 0 : s.total),
      paid: acc.paid + (s.status === "CANCELLED" ? 0 : s.amountPaid),
      pending: acc.pending + s.pending,
    }),
    { total: 0, paid: 0, pending: 0 },
  );
  const pendingAll = await prisma.sale.aggregate({
    where: { status: { not: "CANCELLED" }, paymentStatus: { in: ["PENDING", "PARTIAL"] } },
    _sum: { total: true, amountPaid: true },
    _count: { _all: true },
  });

  const methods = paymentMethods.map((m) => ({ id: m.id, name: m.name }));
  const activeMethods = paymentMethods.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-5">
      <PageHeader
        title="Vendas"
        description={customer ? `Vendas de ${customer.businessName}` : "Pedidos, recebimentos e status de entrega."}
        actions={
          <QuickActionButton action={{ type: "sale" }}>
            <Plus /> Nova venda
          </QuickActionButton>
        }
      />

      {totalSales > 0 && (
        <StatStrip
          items={[
            { label: "Vendas encontradas", value: formatInteger(result.total) },
            { label: "Total nesta página", value: formatBRL(pageTotals.total) },
            { label: "Recebido nesta página", value: formatBRL(pageTotals.paid), tone: "positive" },
            {
              label: `A receber (${formatInteger(pendingAll._count._all)} vendas)`,
              value: formatBRL(num(pendingAll._sum.total) - num(pendingAll._sum.amountPaid)),
              tone: "warning",
            },
          ]}
        />
      )}

      <Card>
        <div className="flex flex-col gap-2 border-b border-line p-4 lg:flex-row lg:flex-wrap lg:items-center">
          <SearchFilter placeholder="Buscar por pedido, cliente ou negócio" className="lg:w-72" />
          <div className="flex flex-wrap items-center gap-2">
            <SelectFilter
              param="status"
              label="Status da venda"
              options={SALE_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
            />
            <SelectFilter
              param="pagamento"
              label="Status financeiro"
              options={PAYMENT_STATUSES.map((s) => ({ value: s, label: paymentLabel(s) }))}
            />
            <SelectFilter
              param="forma"
              label="Forma de pagamento"
              options={methods.map((m) => ({ value: m.id, label: m.name }))}
            />
            <DateRangeFilter />
            <ValueRangeFilter />
            <ClearFilters params={["q", "status", "pagamento", "forma", "de", "ate", "min", "max", "cliente"]} />
          </div>
        </div>

        <DataTable<SaleListItem>
          rows={result.items}
          rowKey={(s) => s.id}
          rowClassName={(s) => (s.status === "CANCELLED" ? "opacity-60" : undefined)}
          empty={
            totalSales === 0 ? (
              <EmptyState
                icon={<ReceiptText />}
                title="Nenhuma venda registrada"
                description="Registre a primeira venda: o estoque é baixado e o recebimento entra no caixa automaticamente."
                action={
                  <QuickActionButton action={{ type: "sale" }}>
                    <Plus /> Registrar venda
                  </QuickActionButton>
                }
              />
            ) : (
              <EmptyState title="Nenhuma venda encontrada" description="Ajuste a busca ou os filtros." />
            )
          }
          columns={[
            {
              key: "number",
              header: "Pedido",
              cell: (s) => (
                <Link
                  href={`/vendas/${s.id}`}
                  className="font-mono text-[13px] font-medium text-primary hover:underline"
                >
                  {formatOrderNumber(s.number)}
                </Link>
              ),
            },
            {
              key: "date",
              header: "Data",
              cell: (s) => <span className="tabular text-ink-2">{formatDate(s.saleDate, tz)}</span>,
            },
            {
              key: "customer",
              header: "Cliente",
              cell: (s) => (
                <Link href={`/clientes/${s.customerId}`} className="block max-w-56 hover:underline">
                  <span className="block truncate font-medium text-ink">{s.customerName}</span>
                  <span className="block truncate text-xs text-muted">{s.contactName}</span>
                </Link>
              ),
            },
            {
              key: "units",
              header: "Placas",
              align: "right",
              cell: (s) => <span className="tabular">{formatInteger(s.units)}</span>,
            },
            {
              key: "total",
              header: "Total",
              align: "right",
              cell: (s) => <span className="tabular font-medium">{formatBRL(s.total)}</span>,
            },
            {
              key: "paid",
              header: "Recebido",
              align: "right",
              cell: (s) => <span className="tabular text-ink-2">{formatBRL(s.amountPaid)}</span>,
            },
            {
              key: "pending",
              header: "Pendente",
              align: "right",
              cell: (s) =>
                s.refundDue > 0 ? (
                  <span className="tabular text-xs text-warning">devolver {formatBRL(s.refundDue)}</span>
                ) : (
                  <span className={s.pending > 0 ? "tabular font-medium text-warning" : "tabular text-muted"}>
                    {formatBRL(s.pending)}
                  </span>
                ),
            },
            { key: "method", header: "Forma", cell: (s) => <span className="text-ink-2">{s.paymentMethod}</span> },
            { key: "status", header: "Venda", cell: (s) => <SaleStatusBadge status={s.status} /> },
            {
              key: "payment",
              header: "Financeiro",
              cell: (s) => <PaymentStatusBadge status={s.paymentStatus} overdue={s.overdue} />,
            },
            {
              key: "actions",
              header: <span className="sr-only">Ações</span>,
              align: "right",
              cell: (s) => <SaleRowActions sale={s} paymentMethods={activeMethods} timezone={tz} />,
            },
          ]}
          mobileCard={(s) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/vendas/${s.id}`} className="min-w-0">
                  <span className="block truncate font-medium text-ink">{s.customerName}</span>
                  <span className="block text-xs text-muted">
                    <span className="font-mono">{formatOrderNumber(s.number)}</span> · {formatDate(s.saleDate, tz)} ·{" "}
                    {formatInteger(s.units)} placa(s)
                  </span>
                </Link>
                <span className="shrink-0 text-right">
                  <span className="tabular block font-medium">{formatBRL(s.total)}</span>
                  {s.pending > 0 && (
                    <span className="tabular block text-xs text-warning">falta {formatBRL(s.pending)}</span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex flex-wrap gap-1.5">
                  <SaleStatusBadge status={s.status} />
                  <PaymentStatusBadge status={s.paymentStatus} overdue={s.overdue} />
                </span>
                <SaleRowActions sale={s} paymentMethods={activeMethods} timezone={tz} />
              </div>
            </div>
          )}
        />
        <Pagination
          basePath="/vendas"
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

function statusLabel(s: string) {
  return (
    {
      REGISTERED: "Registrada",
      PREPARING: "Em preparação",
      SHIPPED: "Enviada",
      DELIVERED: "Entregue",
      CANCELLED: "Cancelada",
    }[s] ?? s
  );
}
function paymentLabel(s: string) {
  return (
    {
      PENDING: "Pendente",
      PARTIAL: "Parcialmente pago",
      PAID: "Pago",
      REFUNDED: "Estornado",
      CANCELLED: "Sem cobrança",
    }[s] ?? s
  );
}
