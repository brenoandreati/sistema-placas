import { ArrowLeft, ExternalLink, MessageCircle, Phone, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { PaymentStatusBadge, SaleStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatDate, formatDateString, formatDateTime } from "@/lib/dates";
import { formatBRL, formatInteger, formatOrderNumber, formatPhone, isUuid, whatsappLink } from "@/lib/format";
import { requirePageSession } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { prisma } from "@/server/db";
import { listPaymentMethods } from "@/server/services/finance";
import { getSaleDetail } from "@/server/services/sales";
import { getSettingsView } from "@/server/services/settings";
import { RefundButton, SaleActions } from "./sale-actions";

export const metadata: Metadata = { title: "Detalhes da venda" };

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageSession("sales.read");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const settings = await getSettingsView();
  const tz = settings.timezone;
  const sale = await getSaleDetail(id, tz);
  if (!sale) notFound();

  const [paymentMethods, customers] = await Promise.all([
    listPaymentMethods(),
    prisma.customer.findMany({
      where: { OR: [{ active: true }, { id: sale.customerId }] },
      orderBy: { businessName: "asc" },
      select: { id: true, businessName: true },
    }),
  ]);
  const cancelled = sale.status === "CANCELLED";
  const whatsapp = whatsappLink(sale.customer.whatsapp ?? sale.customer.phone);
  const canWrite = can(session.user.role, "sales.write");

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
      <Link href="/vendas" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Vendas
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{formatOrderNumber(sale.number)}</span>
            <SaleStatusBadge status={sale.status} />
            <PaymentStatusBadge status={sale.paymentStatus} overdue={sale.overdue} />
          </span>
        }
        description={`${sale.customer.businessName} · ${formatDateTime(sale.saleDate, tz)}`}
        actions={
          canWrite ? (
            <SaleActions
              sale={{
                id: sale.id,
                number: sale.number,
                customerId: sale.customerId,
                customerName: sale.customer.businessName,
                saleDate: sale.saleDate,
                status: sale.status,
                paymentMethodId: sale.paymentMethodId,
                discount: sale.discount,
                shipping: sale.shipping,
                subtotal: sale.subtotal,
                total: sale.total,
                amountPaid: sale.amountPaid,
                pending: sale.pending,
                refundDue: sale.refundDue,
                dueDate: sale.dueDate,
                notes: sale.notes,
                trackingCode: sale.trackingCode,
                deliveryAddress: sale.deliveryAddress,
                expectedDeliveryDate: sale.expectedDeliveryDate,
                items: sale.items.map((i) => ({ id: i.id, productName: i.productName, quantity: i.quantity })),
              }}
              paymentMethods={paymentMethods.map((m) => ({ id: m.id, name: m.name }))}
              customers={customers.map((c) => ({ id: c.id, name: c.businessName }))}
              timezone={tz}
              canCancel={can(session.user.role, "sales.cancel")}
            />
          ) : undefined
        }
      />

      {cancelled && (
        <div className="rounded-xl border border-line-strong bg-surface-2 px-4 py-3 text-sm text-ink-2">
          <span className="font-medium text-ink">
            Venda cancelada em {sale.cancelledAt ? formatDateTime(sale.cancelledAt, tz) : "—"}.
          </span>{" "}
          Motivo: {sale.cancellationReason}
          {sale.refundDue > 0 && (
            <span className="mt-1 block font-medium text-warning">
              Valor a devolver ao cliente: {formatBRL(sale.refundDue)}
            </span>
          )}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line shadow-[var(--shadow-card)] md:grid-cols-4">
        <div className="bg-surface p-4 sm:p-5">
          <dt className="text-xs text-muted">Total da venda</dt>
          <dd className="figure mt-1 font-display text-xl font-semibold">{formatBRL(sale.total)}</dd>
        </div>
        <div className="bg-surface p-4 sm:p-5">
          <dt className="text-xs text-muted">Recebido</dt>
          <dd className="figure mt-1 font-display text-xl font-semibold text-positive">{formatBRL(sale.amountPaid)}</dd>
        </div>
        <div className="bg-surface p-4 sm:p-5">
          <dt className="text-xs text-muted">{cancelled ? "A devolver" : "Pendente"}</dt>
          <dd
            className={cn(
              "figure mt-1 font-display text-xl font-semibold",
              (cancelled ? sale.refundDue : sale.pending) > 0 ? "text-warning" : "text-ink",
            )}
          >
            {formatBRL(cancelled ? sale.refundDue : sale.pending)}
          </dd>
          {!cancelled && sale.dueDate && sale.pending > 0 && (
            <p className={cn("mt-0.5 text-xs", sale.overdue ? "text-negative" : "text-muted")}>
              {sale.overdue ? "Venceu" : "Vence"} em {formatDateString(sale.dueDate)}
            </p>
          )}
        </div>
        <div className="bg-surface p-4 sm:p-5">
          <dt className="text-xs text-muted">Lucro bruto da venda</dt>
          <dd className="figure mt-1 font-display text-xl font-semibold">
            {sale.grossProfit === null ? (
              cancelled ? (
                <span className="text-base text-muted">—</span>
              ) : (
                <span className="text-base text-warning">custo não informado</span>
              )
            ) : (
              formatBRL(sale.grossProfit)
            )}
          </dd>
          <p className="mt-0.5 text-xs text-muted">Custo das placas: {formatBRL(sale.costOfGoods)}</p>
        </div>
      </dl>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Produtos" />
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-line bg-surface-2/70 text-xs text-muted">
                    <th scope="col" className="px-5 py-2 text-left font-medium">
                      Produto
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Qtd.
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Preço unit.
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Custo unit.
                    </th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {sale.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-5 py-3">
                        <span className="block font-medium text-ink">{item.productName}</span>
                        <span className="font-mono text-xs text-muted">{item.sku}</span>
                        {cancelled && (
                          <span className="mt-0.5 block text-xs text-muted">
                            {formatInteger(item.returnedQuantity)} devolvida(s) ao estoque ·{" "}
                            {formatInteger(item.quantity - item.returnedQuantity)} perda
                          </span>
                        )}
                      </td>
                      <td className="tabular px-3 py-3 text-right">{formatInteger(item.quantity)}</td>
                      <td className="tabular px-3 py-3 text-right">{formatBRL(item.unitPrice)}</td>
                      <td className="tabular px-3 py-3 text-right text-muted">
                        {item.unitCost === null ? "—" : formatBRL(item.unitCost)}
                      </td>
                      <td className="tabular px-5 py-3 text-right font-medium">{formatBRL(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="ml-auto grid w-full max-w-xs gap-1 px-5 py-4 text-sm">
              <div className="flex justify-between text-ink-2">
                <dt>Produtos</dt>
                <dd className="tabular">{formatBRL(sale.subtotal)}</dd>
              </div>
              <div className="flex justify-between text-ink-2">
                <dt>Desconto</dt>
                <dd className="tabular">− {formatBRL(sale.discount)}</dd>
              </div>
              <div className="flex justify-between text-ink-2">
                <dt>Frete</dt>
                <dd className="tabular">+ {formatBRL(sale.shipping)}</dd>
              </div>
              <div className="mt-1 flex justify-between border-t border-line pt-2 font-medium text-ink">
                <dt>Total</dt>
                <dd className="tabular">{formatBRL(sale.total)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Pagamentos" description={`Forma combinada: ${sale.paymentMethod}`} />
            {sale.payments.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted">Nenhum pagamento recebido ainda.</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {sale.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">
                        {p.kind === "RECEIPT" ? "Recebimento" : "Estorno"} nº {p.number} · {p.paymentMethod}
                        {p.transactionNumber && (
                          <span className="text-muted"> · MOV-{String(p.transactionNumber).padStart(5, "0")}</span>
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {formatDateTime(p.paidAt, tz)}
                        {p.createdBy ? ` · por ${p.createdBy}` : ""}
                        {p.reason ? ` · ${p.reason}` : p.notes ? ` · ${p.notes}` : ""}
                      </p>
                    </div>
                    <span
                      className={cn("tabular font-medium", p.kind === "RECEIPT" ? "text-positive" : "text-negative")}
                    >
                      {p.kind === "RECEIPT" ? "+" : "−"} {formatBRL(p.amount)}
                    </span>
                    {p.kind === "RECEIPT" && p.refundable > 0 && canWrite && can(session.user.role, "sales.cancel") && (
                      <RefundButton
                        payment={{
                          id: p.id,
                          number: p.number,
                          amount: p.amount,
                          refundable: p.refundable,
                          paymentMethod: p.paymentMethod,
                        }}
                        timezone={tz}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Histórico de alterações" />
            <ol className="relative mx-5 mb-5 border-l border-line">
              {sale.history.map((h) => (
                <li key={h.id} className="relative pb-4 pl-5 last:pb-0">
                  <span className="absolute top-1.5 -left-[4.5px] size-2 rounded-full bg-line-strong" aria-hidden />
                  <p className="text-sm text-ink">{h.summary}</p>
                  {h.reason && <p className="text-[13px] text-ink-2">Motivo: {h.reason}</p>}
                  <p className="text-xs text-muted">
                    {formatDateTime(h.createdAt, tz)}
                    {h.user ? ` · ${h.user}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="Cliente"
              action={
                <Link
                  href={`/clientes/${sale.customer.id}`}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Ver ficha
                </Link>
              }
            />
            <CardBody className="flex flex-col gap-2 text-sm">
              <p className="font-medium text-ink">{sale.customer.businessName}</p>
              <p className="text-ink-2">{sale.customer.contactName}</p>
              {sale.customer.phone && (
                <a
                  href={`tel:${sale.customer.phone}`}
                  className="inline-flex items-center gap-2 text-ink-2 hover:text-ink"
                >
                  <Phone className="size-4 text-muted" /> {formatPhone(sale.customer.phone)}
                </a>
              )}
              {whatsapp && (
                <a
                  href={whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-positive hover:underline"
                >
                  <MessageCircle className="size-4" /> Conversar no WhatsApp
                </a>
              )}
              {sale.customer.googleReviewUrl && (
                <a
                  href={sale.customer.googleReviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-primary hover:underline"
                >
                  <Star className="size-4" /> Página de avaliações
                  <ExternalLink className="size-3" />
                </a>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Entrega" />
            <CardBody>
              <dl className="grid gap-2.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Status</dt>
                  <dd>
                    <SaleStatusBadge status={sale.status} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Previsão</dt>
                  <dd className="tabular text-ink">
                    {sale.expectedDeliveryDate ? formatDateString(sale.expectedDeliveryDate) : "—"}
                  </dd>
                </div>
                {sale.deliveredAt && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Entregue em</dt>
                    <dd className="tabular text-ink">{formatDate(sale.deliveredAt, tz)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Rastreamento</dt>
                  <dd className="font-mono text-ink">{sale.trackingCode ?? "—"}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-muted">Endereço</dt>
                  <dd className="text-ink">{sale.deliveryAddress ?? "—"}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Observações" />
            <CardBody>
              <p className="text-sm whitespace-pre-line text-ink-2">{sale.notes ?? "Sem observações."}</p>
            </CardBody>
          </Card>

          {sale.relatedExpenses.length > 0 && (
            <Card>
              <CardHeader title="Custos lançados" />
              <ul className="divide-y divide-line border-t border-line">
                {sale.relatedExpenses.map((e) => (
                  <li key={e.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <span className="text-ink-2">
                      {e.description} {e.status === "REVERSED" && <Badge tone="outline">estornada</Badge>}
                    </span>
                    <span className="tabular text-negative">− {formatBRL(e.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <p className="px-1 text-xs text-muted">
            Registrada em {formatDateTime(sale.createdAt, tz)}
            {sale.createdBy ? ` por ${sale.createdBy}` : ""}.
          </p>
        </div>
      </div>
    </div>
  );
}
