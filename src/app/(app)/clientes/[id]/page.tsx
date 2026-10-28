import { ArrowLeft, ExternalLink, Mail, MessageCircle, Phone, Plus, QrCode, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QuickActionButton } from "@/components/quick-actions";
import { PaymentStatusBadge, SaleStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/link-tabs";
import { cn } from "@/lib/cn";
import { formatDate, formatDateString, formatDateTime, todayString } from "@/lib/dates";
import {
  formatBRL,
  formatCnpj,
  formatInteger,
  formatOrderNumber,
  formatPhone,
  isUuid,
  whatsappLink,
} from "@/lib/format";
import { requirePageSession } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { getCustomerDetail } from "@/server/services/customers";
import { listCustomerQrCodes } from "@/server/services/qr-codes";
import { getSettingsView } from "@/server/services/settings";
import { CustomerStatusButtons, EditCustomerButton } from "../customer-buttons";

export const metadata: Metadata = { title: "Cliente" };

const TABS = [
  { key: "visao", label: "Visão geral" },
  { key: "compras", label: "Histórico de compras" },
  { key: "financeiro", label: "Financeiro" },
  { key: "observacoes", label: "Observações" },
  { key: "negocio", label: "Dados do negócio" },
];

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string }>;
}) {
  const session = await requirePageSession("sales.read");
  const { id } = await params;
  const { aba } = await searchParams;
  if (!isUuid(id)) notFound();
  const settings = await getSettingsView();
  const tz = settings.timezone;
  const [detail, qrCodes] = await Promise.all([getCustomerDetail(id), listCustomerQrCodes(id)]);
  if (!detail) notFound();
  const { customer: c, summary } = detail;
  const tab = TABS.some((t) => t.key === aba) ? aba! : "visao";
  const wa = whatsappLink(c.whatsapp ?? c.phone);
  const today = todayString(tz);
  const canWrite = can(session.user.role, "customers.write");

  const businessInfo: [string, React.ReactNode][] = [
    ["Razão social", c.legalName],
    ["CNPJ", c.cnpj ? formatCnpj(c.cnpj) : null],
    ["Segmento", c.segment],
    ["Endereço", c.address],
    ["Cidade/UF", [c.city, c.state].filter(Boolean).join("/") || null],
    ["CEP", c.zipCode ? `${c.zipCode.slice(0, 5)}-${c.zipCode.slice(5)}` : null],
  ];

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
      <Link href="/clientes" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Clientes
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[26px] leading-tight font-semibold tracking-tight text-ink">
              {c.businessName}
            </h1>
            {!c.active && <Badge tone="outline">Desativado</Badge>}
            {c.segment && <Badge tone="primary">{c.segment}</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-2">{c.contactName}</p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {c.phone && (
              <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-ink">
                <Phone className="size-4 text-muted" /> {formatPhone(c.phone)}
              </a>
            )}
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-positive hover:underline"
              >
                <MessageCircle className="size-4" /> WhatsApp {c.whatsapp ? formatPhone(c.whatsapp) : ""}
              </a>
            )}
            {c.email && (
              <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-ink">
                <Mail className="size-4 text-muted" /> {c.email}
              </a>
            )}
            <span className="text-muted">Cliente desde {formatDate(c.createdAt, tz)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.active && (
            <QuickActionButton action={{ type: "sale", customerId: c.id }}>
              <Plus /> Nova venda
            </QuickActionButton>
          )}
          {canWrite && <EditCustomerButton customer={c} />}
          {canWrite && (
            <CustomerStatusButtons
              customerId={c.id}
              businessName={c.businessName}
              active={c.active}
              hasSales={detail.sales.length > 0}
              canDelete={can(session.user.role, "customers.delete")}
            />
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line shadow-[var(--shadow-card)] md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Pedidos", value: formatInteger(summary.orders) },
          { label: "Placas compradas", value: formatInteger(summary.units) },
          { label: "Valor comprado", value: formatBRL(summary.totalPurchased) },
          { label: "Efetivamente pago", value: formatBRL(summary.totalPaid), tone: "text-positive" },
          { label: "Pendente", value: formatBRL(summary.pending), tone: summary.pending > 0 ? "text-warning" : "" },
          { label: "Última compra", value: summary.lastPurchaseAt ? formatDate(summary.lastPurchaseAt, tz) : "—" },
        ].map((item) => (
          <div key={item.label} className="bg-surface px-4 py-3.5">
            <dt className="text-xs text-muted">{item.label}</dt>
            <dd className={cn("figure mt-1 font-display text-lg font-semibold tracking-tight", item.tone)}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      <LinkTabs items={TABS.map((t) => ({ ...t, href: `/clientes/${c.id}?aba=${t.key}` }))} active={tab} />

      {tab === "visao" && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            <CardHeader
              title="Últimas compras"
              action={
                <Link
                  className="text-xs font-medium text-primary hover:underline"
                  href={`/clientes/${c.id}?aba=compras`}
                >
                  Ver todas
                </Link>
              }
            />
            {detail.sales.length === 0 ? (
              <EmptyState
                title="Ainda sem compras"
                description="Registre a primeira venda para este cliente."
                action={
                  c.active ? (
                    <QuickActionButton action={{ type: "sale", customerId: c.id }}>
                      <Plus /> Nova venda
                    </QuickActionButton>
                  ) : undefined
                }
              />
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {detail.sales.slice(0, 5).map((s) => (
                  <li key={s.id}>
                    <Link href={`/vendas/${s.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-ink">
                          <span className="font-mono">{formatOrderNumber(s.number)}</span> · {formatInteger(s.units)}{" "}
                          placa(s)
                        </span>
                        <span className="block text-xs text-muted">{formatDate(s.saleDate, tz)}</span>
                      </span>
                      <PaymentStatusBadge
                        status={s.paymentStatus}
                        overdue={s.pending > 0 && !!s.dueDate && s.dueDate < today}
                      />
                      <span className="tabular w-28 text-right font-medium">{formatBRL(s.total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader title="Avaliações do Google" />
              <CardBody className="flex flex-col gap-2 text-sm">
                {c.googleReviewUrl ? (
                  <a
                    href={c.googleReviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 break-all text-primary hover:underline"
                  >
                    <Star className="size-4 shrink-0" /> {c.googleReviewUrl}{" "}
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                ) : (
                  <p className="text-muted">
                    Link de avaliações não informado. Edite o cadastro para registrar o destino da placa.
                  </p>
                )}
                {c.publicPlaceName && (
                  <p className="text-ink-2">
                    <span className="text-muted">Nome público:</span> {c.publicPlaceName}
                  </p>
                )}
                {c.plateCustomizationNotes && (
                  <p className="text-ink-2">
                    <span className="text-muted">Personalização:</span> {c.plateCustomizationNotes}
                  </p>
                )}
              </CardBody>
            </Card>
            {qrCodes.length > 0 && (
              <Card>
                <CardHeader title="QR codes" description="Placas com QR code vinculadas a este cliente." />
                <ul className="divide-y divide-line border-t border-line">
                  {qrCodes.map((q) => (
                    <li key={q.id}>
                      <Link
                        href={`/qr-codes?q=${q.code}`}
                        className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-surface-2"
                      >
                        <QrCode className="size-4 shrink-0 text-muted" />
                        <span className="min-w-0 flex-1">
                          <span className="font-mono font-medium text-ink">{q.code}</span>
                          {q.label && <span className="text-muted"> · {q.label}</span>}
                          <span className="block truncate text-xs text-muted">{q.destinationUrl ?? "Sem link"}</span>
                        </span>
                        <span className="tabular shrink-0 text-xs text-muted">
                          {formatInteger(q.scanCount)} leitura(s)
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card>
              <CardHeader title="Resumo comercial" />
              <CardBody>
                <dl className="grid gap-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted">Primeira compra</dt>
                    <dd className="tabular">
                      {summary.firstPurchaseAt ? formatDate(summary.firstPurchaseAt, tz) : "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Ticket médio</dt>
                    <dd className="tabular">
                      {summary.orders ? formatBRL(summary.totalPurchased / summary.orders) : "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Vendas canceladas</dt>
                    <dd className="tabular">{formatInteger(summary.cancelledOrders)}</dd>
                  </div>
                  {summary.refundDue > 0 && (
                    <div className="flex justify-between text-warning">
                      <dt>A devolver</dt>
                      <dd className="tabular">{formatBRL(summary.refundDue)}</dd>
                    </div>
                  )}
                </dl>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {tab === "compras" && (
        <Card>
          {detail.sales.length === 0 ? (
            <EmptyState title="Nenhuma compra registrada" />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2/70 text-xs text-muted">
                    <th scope="col" className="px-5 py-2.5 text-left font-medium">
                      Pedido
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-left font-medium">
                      Data
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Placas
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Total
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Pago
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Pendente
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-left font-medium">
                      Venda
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-left font-medium">
                      Financeiro
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {detail.sales.map((s) => (
                    <tr key={s.id} className={cn("hover:bg-surface-2", s.status === "CANCELLED" && "opacity-60")}>
                      <td className="px-5 py-3">
                        <Link
                          href={`/vendas/${s.id}`}
                          className="font-mono text-[13px] font-medium text-primary hover:underline"
                        >
                          {formatOrderNumber(s.number)}
                        </Link>
                      </td>
                      <td className="tabular px-3 py-3 text-ink-2">{formatDate(s.saleDate, tz)}</td>
                      <td className="tabular px-3 py-3 text-right">{formatInteger(s.units)}</td>
                      <td className="tabular px-3 py-3 text-right font-medium">{formatBRL(s.total)}</td>
                      <td className="tabular px-3 py-3 text-right text-ink-2">{formatBRL(s.amountPaid)}</td>
                      <td className={cn("tabular px-3 py-3 text-right", s.pending > 0 ? "text-warning" : "text-muted")}>
                        {formatBRL(s.pending)}
                      </td>
                      <td className="px-3 py-3">
                        <SaleStatusBadge status={s.status} />
                      </td>
                      <td className="px-5 py-3">
                        <PaymentStatusBadge
                          status={s.paymentStatus}
                          overdue={s.pending > 0 && !!s.dueDate && s.dueDate < today}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "financeiro" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Valores pendentes" />
            {detail.sales.filter((s) => s.pending > 0).length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted">Nenhum valor pendente.</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {detail.sales
                  .filter((s) => s.pending > 0)
                  .map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/vendas/${s.id}`}
                        className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2"
                      >
                        <span>
                          <span className="block font-mono text-sm">{formatOrderNumber(s.number)}</span>
                          <span
                            className={cn(
                              "block text-xs",
                              s.dueDate && s.dueDate < today ? "text-negative" : "text-muted",
                            )}
                          >
                            {s.dueDate ? `Vence em ${formatDateString(s.dueDate)}` : "Sem vencimento"}
                          </span>
                        </span>
                        <span className="tabular font-medium text-warning">{formatBRL(s.pending)}</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Pagamentos recebidos" />
            {detail.payments.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted">Nenhum pagamento registrado.</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {detail.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">
                        {p.kind === "RECEIPT" ? "Recebimento" : "Estorno"} ·{" "}
                        <Link href={`/vendas/${p.saleId}`} className="font-mono hover:underline">
                          {formatOrderNumber(p.saleNumber)}
                        </Link>
                      </span>
                      <span className="block text-xs text-muted">
                        {formatDateTime(p.paidAt, tz)} · {p.paymentMethod}
                        {p.reason ? ` · ${p.reason}` : ""}
                      </span>
                    </span>
                    <span
                      className={cn("tabular font-medium", p.kind === "RECEIPT" ? "text-positive" : "text-negative")}
                    >
                      {p.kind === "RECEIPT" ? "+" : "−"} {formatBRL(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "observacoes" && (
        <Card>
          <CardHeader title="Observações internas" description="Preferências, combinados e informações comerciais." />
          <CardBody>
            <p className="text-sm whitespace-pre-line text-ink-2">
              {c.notes ?? "Nenhuma observação registrada. Use Editar para adicionar."}
            </p>
          </CardBody>
          {detail.history.length > 0 && (
            <div className="border-t border-line px-5 py-4">
              <h3 className="mb-2 text-[13px] font-medium text-ink-2">Histórico do cadastro</h3>
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {detail.history.map((h) => (
                  <li key={h.id} className="text-muted">
                    <span className="text-ink-2">{h.summary}</span> · {formatDateTime(h.createdAt, tz)}
                    {h.user ? ` · ${h.user}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {tab === "negocio" && (
        <Card>
          <CardHeader title="Dados do negócio" />
          <CardBody>
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              {businessInfo.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="text-ink">{value || "—"}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
