import { MessageCircle, Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ClearFilters, DateRangeFilter, FilterBar, SearchFilter, SelectFilter } from "@/components/ui/filters";
import { Pagination } from "@/components/ui/pagination";
import { addDaysToDate, formatDate, isDateString, startOfLocalDay, toLocalDateString, todayString } from "@/lib/dates";
import { formatBRL, formatInteger, formatPhone, whatsappLink } from "@/lib/format";
import { requirePageSession } from "@/server/auth/guard";
import { prisma } from "@/server/db";
import { listCustomers, type CustomerListItem } from "@/server/services/customers";
import { getSettingsView } from "@/server/services/settings";
import { NewCustomerButton } from "./customer-buttons";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePageSession("sales.read");
  const sp = await searchParams;
  const settings = await getSettingsView();
  const tz = settings.timezone;
  const purchase = sp.compras === "com" ? "with" : sp.compras === "sem" ? "without" : "all";
  const sort = (["name", "recent", "total", "created"] as const).find((s) => s === sp.ordem) ?? "name";
  const followUp = sp.retorno === "com" ? "scheduled" : sp.retorno === "sem" ? "none" : undefined;
  const today = todayString(tz);

  const [result, totalCustomers] = await Promise.all([
    listCustomers({
      search: sp.q,
      purchase,
      lastPurchaseFrom: isDateString(sp.de) ? startOfLocalDay(sp.de, tz) : undefined,
      lastPurchaseTo: isDateString(sp.ate) ? startOfLocalDay(addDaysToDate(sp.ate, 1), tz) : undefined,
      includeInactive: sp.inativos === "1",
      followUp,
      sort,
      page: Number(sp.page) || 1,
      pageSize: settings.pageSize,
    }),
    prisma.customer.count(),
  ]);

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-5">
      <PageHeader
        title="Clientes"
        description="Histórico comercial de cada negócio que comprou ou vai comprar placas."
        actions={<NewCustomerButton />}
      />
      <Card>
        <FilterBar
          search={
            <SearchFilter placeholder="Buscar por negócio, responsável, telefone ou e-mail" className="lg:w-80" />
          }
          params={["q", "compras", "retorno", "ordem", "inativos", "de", "ate"]}
        >
          <SelectFilter
            param="compras"
            label="Todos os clientes"
            options={[
              { value: "com", label: "Já compraram" },
              { value: "sem", label: "Sem compras" },
            ]}
          />
          <SelectFilter
            param="retorno"
            label="Agenda: todos"
            options={[
              { value: "com", label: "Com retorno agendado" },
              { value: "sem", label: "Sem retorno agendado" },
            ]}
          />
          <SelectFilter
            param="ordem"
            label="Ordenar por nome"
            options={[
              { value: "recent", label: "Compra mais recente" },
              { value: "total", label: "Maior valor comprado" },
              { value: "created", label: "Cadastro mais recente" },
            ]}
          />
          <SelectFilter
            param="inativos"
            label="Somente ativos"
            options={[{ value: "1", label: "Incluir desativados" }]}
          />
          <span className="text-xs text-muted">Última compra:</span>
          <DateRangeFilter />
          <ClearFilters params={["q", "compras", "retorno", "ordem", "inativos", "de", "ate"]} />
        </FilterBar>
        <DataTable<CustomerListItem>
          rows={result.items}
          rowKey={(c) => c.id}
          rowClassName={(c) => (!c.active ? "opacity-60" : undefined)}
          empty={
            totalCustomers === 0 ? (
              <EmptyState
                icon={<Store />}
                title="Nenhum cliente cadastrado"
                description="Cadastre aqui ou direto no formulário de venda. Guarde também o link de avaliações do Google de cada negócio."
                action={<NewCustomerButton />}
              />
            ) : (
              <EmptyState title="Nenhum cliente encontrado" description="Ajuste a busca ou os filtros." />
            )
          }
          columns={[
            {
              key: "business",
              header: "Negócio",
              cell: (c) => (
                <Link href={`/clientes/${c.id}`} className="block max-w-64">
                  <span className="flex items-center gap-2 font-medium text-ink hover:underline">
                    <span className="truncate">{c.businessName}</span>
                    {!c.active && <Badge tone="outline">desativado</Badge>}
                  </span>
                  {c.nextFollowUpAt && <FollowUpBadge at={c.nextFollowUpAt} tz={tz} today={today} />}
                  <span className="block truncate text-xs text-muted">
                    {[c.city, c.state].filter(Boolean).join("/") || "—"}
                  </span>
                </Link>
              ),
            },
            { key: "contact", header: "Responsável", cell: (c) => <span className="text-ink-2">{c.contactName}</span> },
            {
              key: "phone",
              header: "Telefone",
              cell: (c) => {
                const wa = whatsappLink(c.whatsapp ?? c.phone);
                return (
                  <span className="tabular flex items-center gap-2 whitespace-nowrap text-ink-2">
                    {c.phone || c.whatsapp ? formatPhone(c.phone ?? c.whatsapp) : "—"}
                    {wa && (
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-positive"
                        aria-label={`WhatsApp de ${c.businessName}`}
                      >
                        <MessageCircle className="size-4" />
                      </a>
                    )}
                  </span>
                );
              },
            },
            {
              key: "email",
              header: "E-mail",
              cell: (c) => <span className="block max-w-48 truncate text-ink-2">{c.email ?? "—"}</span>,
            },
            {
              key: "orders",
              header: "Pedidos",
              align: "right",
              cell: (c) => <span className="tabular">{formatInteger(c.orders)}</span>,
            },
            {
              key: "total",
              header: "Total comprado",
              align: "right",
              cell: (c) => (
                <span className="tabular block">
                  <span className="font-medium">{formatBRL(c.totalPurchased)}</span>
                  {c.pending > 0 && <span className="block text-xs text-warning">falta {formatBRL(c.pending)}</span>}
                </span>
              ),
            },
            {
              key: "last",
              header: "Última compra",
              cell: (c) => (
                <span className="tabular text-ink-2">{c.lastPurchaseAt ? formatDate(c.lastPurchaseAt, tz) : "—"}</span>
              ),
            },
            {
              key: "created",
              header: "Cadastro",
              cell: (c) => <span className="tabular text-muted">{formatDate(c.createdAt, tz)}</span>,
            },
          ]}
          mobileCard={(c) => (
            <Link href={`/clientes/${c.id}`} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{c.businessName}</span>
                {c.nextFollowUpAt && <FollowUpBadge at={c.nextFollowUpAt} tz={tz} today={today} />}
                <span className="block truncate text-xs text-muted">
                  {c.contactName}
                  {c.phone ? ` · ${formatPhone(c.phone)}` : ""}
                </span>
                <span className="block text-xs text-muted">
                  {formatInteger(c.orders)} pedido(s)
                  {c.lastPurchaseAt ? ` · última em ${formatDate(c.lastPurchaseAt, tz)}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="tabular block font-medium">{formatBRL(c.totalPurchased)}</span>
                {c.pending > 0 && (
                  <span className="tabular block text-xs text-warning">falta {formatBRL(c.pending)}</span>
                )}
              </span>
            </Link>
          )}
        />
        <Pagination
          basePath="/clientes"
          params={sp}
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          pageSize={result.pageSize}
          label="clientes"
        />
      </Card>
    </div>
  );
}

/** Retorno agendado na agenda: data do próximo contato (em vermelho se já passou). */
function FollowUpBadge({ at, tz, today }: { at: string; tz: string; today: string }) {
  const date = toLocalDateString(new Date(at), tz);
  const overdue = date < today;
  return (
    <Badge tone={overdue ? "negative" : "primary"} dot className="mt-1 w-fit">
      {overdue ? "Retorno atrasado" : date === today ? "Retorno hoje" : `Retorno ${formatDate(at, tz).slice(0, 5)}`}
    </Badge>
  );
}
