"use client";

import { ChevronDown, Minus, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, Spinner } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { DEFAULT_TIMEZONE, addDaysToDate, toLocalDateTimeInput, todayString } from "@/lib/dates";
import { formatCents, formatInteger, formatOrderNumber } from "@/lib/format";
import { quickCreateCustomerAction } from "@/server/actions/customers";
import { createSaleAction, getSaleFormOptionsAction } from "@/server/actions/sales";
import { CustomerCombobox, type CustomerOption } from "./customer-combobox";
import { firstError, useDraft, useIdempotencyKey, useServerAction } from "./use-action";

type Options = Awaited<ReturnType<typeof getSaleFormOptionsAction>>;

interface SaleDraft {
  customerId: string | null;
  items: { productId: string; quantity: number; unitPriceCents: number | null }[];
  paymentMethodId: string | null;
  paymentStatus: "PAID" | "PARTIAL" | "PENDING";
  amountReceivedCents: number | null;
  dueDate: string;
  saleDate: string;
  discountCents: number | null;
  shippingCents: number | null;
  status: "REGISTERED" | "PREPARING" | "SHIPPED" | "DELIVERED";
  notes: string;
  trackingCode: string;
  deliveryAddress: string;
  expectedDeliveryDate: string;
  showMore: boolean;
}

const emptyDraft = (): SaleDraft => ({
  customerId: null,
  items: [],
  paymentMethodId: null,
  paymentStatus: "PAID",
  amountReceivedCents: null,
  dueDate: "",
  saleDate: "",
  discountCents: null,
  shippingCents: null,
  status: "REGISTERED",
  notes: "",
  trackingCode: "",
  deliveryAddress: "",
  expectedDeliveryDate: "",
  showMore: false,
});

type SaleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetCustomerId?: string;
};

export function SaleDialog(props: SaleDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <SaleDialogBody {...props} />}
    </Dialog>
  );
}

/** Aplica valores padrão (cliente pré-selecionado, primeiro produto, forma de pagamento). */
function withDefaults(d: SaleDraft, options: Options, presetCustomerId?: string): SaleDraft {
  const next = { ...d };
  if (presetCustomerId) next.customerId = presetCustomerId;
  next.items = next.items.filter((i) => options.products.some((p) => p.id === i.productId));
  if (next.items.length === 0 && options.products.length > 0) {
    const p = options.products[0];
    next.items = [{ productId: p.id, quantity: 1, unitPriceCents: p.salePriceCents }];
  }
  if (!next.paymentMethodId || !options.paymentMethods.some((m) => m.id === next.paymentMethodId)) {
    next.paymentMethodId = options.paymentMethods[0]?.id ?? null;
  }
  return next;
}

function SaleDialogBody({ onOpenChange, presetCustomerId }: SaleDialogProps) {
  const router = useRouter();
  const [options, setOptions] = useState<Options | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft, discardDraft] = useDraft<SaleDraft>("draft:nova-venda", emptyDraft);
  const [idempotencyKey, renewKey] = useIdempotencyKey();
  const [newCustomer, setNewCustomer] = useState<{ businessName: string; contactName: string; phone: string } | null>(
    null,
  );
  const { run, pending, fieldErrors } = useServerAction(createSaleAction);
  const quickCustomer = useServerAction(quickCreateCustomerAction);

  // Carrega clientes, produtos e formas de pagamento ao abrir.
  useEffect(() => {
    let cancelled = false;
    getSaleFormOptionsAction()
      .then((data) => {
        if (cancelled) return;
        setOptions(data);
        setDraft((d) => withDefaults(d, data, presetCustomerId));
      })
      .catch(() => {
        if (!cancelled) setLoadError("Não foi possível carregar os dados do formulário.");
      });
    return () => {
      cancelled = true;
    };
  }, [presetCustomerId, setDraft]);

  const tz = options?.timezone ?? DEFAULT_TIMEZONE;
  const productById = useMemo(() => new Map(options?.products.map((p) => [p.id, p]) ?? []), [options]);
  const customers: CustomerOption[] = options?.customers ?? [];

  const subtotal = draft.items.reduce((acc, i) => acc + i.quantity * (i.unitPriceCents ?? 0), 0);
  const discount = draft.discountCents ?? 0;
  const shipping = draft.shippingCents ?? 0;
  const total = subtotal - discount + shipping;
  const receivedNow =
    draft.paymentStatus === "PAID" ? total : draft.paymentStatus === "PARTIAL" ? (draft.amountReceivedCents ?? 0) : 0;
  const stockProblems = draft.items.filter((i) => {
    const p = productById.get(i.productId);
    return p && i.quantity > p.currentStock;
  });
  const units = draft.items.reduce((acc, i) => acc + i.quantity, 0);

  function update<K extends keyof SaleDraft>(key: K, value: SaleDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function updateItem(index: number, patch: Partial<SaleDraft["items"][number]>) {
    setDraft((d) => ({ ...d, items: d.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.customerId) {
      toast.error("Selecione o cliente da venda.");
      return;
    }
    if (!draft.paymentMethodId) {
      toast.error("Escolha a forma de pagamento.");
      return;
    }
    run(
      {
        customerId: draft.customerId,
        items: draft.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents ?? 0,
        })),
        saleDate: draft.saleDate || toLocalDateTimeInput(new Date(), tz),
        paymentMethodId: draft.paymentMethodId,
        paymentStatus: draft.paymentStatus,
        amountReceivedCents: draft.paymentStatus === "PARTIAL" ? (draft.amountReceivedCents ?? 0) : undefined,
        discountCents: discount,
        shippingCents: shipping,
        dueDate: draft.paymentStatus === "PAID" ? undefined : draft.dueDate || undefined,
        status: draft.status,
        notes: draft.notes,
        trackingCode: draft.trackingCode,
        deliveryAddress: draft.deliveryAddress,
        expectedDeliveryDate: draft.expectedDeliveryDate || undefined,
        idempotencyKey,
      },
      {
        successMessage: null,
        onSuccess: (data) => {
          toast.success(`Venda ${formatOrderNumber(data.number)} registrada`, {
            description: `${formatInteger(units)} placa(s) · ${formatCents(total)}`,
            action: { label: "Ver venda", onClick: () => router.push(`/vendas/${data.id}`) },
          });
          discardDraft();
          renewKey();
          setNewCustomer(null);
          onOpenChange(false);
        },
      },
    );
  }

  function saveNewCustomer() {
    if (!newCustomer) return;
    quickCustomer.run(newCustomer, {
      onSuccess: (customer) => {
        setOptions((o) => (o ? { ...o, customers: [customer, ...o.customers] } : o));
        update("customerId", customer.id);
        if (!draft.deliveryAddress && customer.address) update("deliveryAddress", customer.address);
        setNewCustomer(null);
      },
    });
  }

  const hasDraftContent = Boolean(draft.customerId || draft.notes || draft.discountCents || draft.shippingCents);
  const defaultDue = options ? addDaysToDate(todayString(tz), options.defaultDueDays) : "";

  return (
    <DialogContent
      variant="sheet"
      size="lg"
      title="Nova venda"
      description="O estoque é baixado e o recebimento entra no caixa ao confirmar."
      footer={
        <>
          {hasDraftContent && (
            <Button
              type="button"
              variant="ghost"
              className="sm:mr-auto"
              onClick={() => {
                discardDraft();
                setNewCustomer(null);
                if (options) setDraft((d) => withDefaults(d, options));
              }}
            >
              Limpar formulário
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button
            type="submit"
            form="sale-form"
            loading={pending}
            disabled={!options || stockProblems.length > 0 || draft.items.length === 0 || total < 0}
          >
            Registrar venda · {formatCents(Math.max(total, 0))}
          </Button>
        </>
      }
    >
      {!options && !loadError && (
        <div className="flex items-center gap-2 py-10 text-sm text-muted">
          <Spinner /> Carregando…
        </div>
      )}
      {loadError && <p className="py-10 text-sm text-negative">{loadError}</p>}
      {options && options.products.length === 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
          Nenhum produto ativo cadastrado. Cadastre o produto em Estoque antes de registrar vendas.
        </div>
      )}
      {options && options.products.length > 0 && (
        <form id="sale-form" onSubmit={submit} className="flex flex-col gap-6">
          {/* Cliente */}
          <section className="flex flex-col gap-2">
            <Field label="Cliente" required error={firstError(fieldErrors, "customerId")}>
              {(props) =>
                newCustomer ? (
                  <div className="rounded-xl border border-primary/25 bg-primary-soft/40 p-3.5">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-medium text-ink">Novo cliente</p>
                      <button
                        type="button"
                        onClick={() => setNewCustomer(null)}
                        className="rounded p-1 text-muted hover:text-ink"
                        aria-label="Cancelar novo cliente"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field
                        label="Nome do negócio"
                        required
                        error={firstError(quickCustomer.fieldErrors, "businessName")}
                      >
                        {(p) => (
                          <Input
                            {...p}
                            autoFocus
                            value={newCustomer.businessName}
                            onChange={(e) => setNewCustomer({ ...newCustomer, businessName: e.target.value })}
                          />
                        )}
                      </Field>
                      <Field label="Responsável" required error={firstError(quickCustomer.fieldErrors, "contactName")}>
                        {(p) => (
                          <Input
                            {...p}
                            value={newCustomer.contactName}
                            onChange={(e) => setNewCustomer({ ...newCustomer, contactName: e.target.value })}
                          />
                        )}
                      </Field>
                      <Field label="Telefone / WhatsApp" error={firstError(quickCustomer.fieldErrors, "phone")}>
                        {(p) => (
                          <Input
                            {...p}
                            inputMode="tel"
                            placeholder="(11) 98765-4321"
                            value={newCustomer.phone}
                            onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                          />
                        )}
                      </Field>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          onClick={saveNewCustomer}
                          loading={quickCustomer.pending}
                          className="w-full"
                        >
                          Salvar e selecionar
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <CustomerCombobox
                    id={props.id}
                    invalid={props["aria-invalid"]}
                    customers={customers}
                    value={draft.customerId}
                    onChange={(c) => {
                      setDraft((d) => ({
                        ...d,
                        customerId: c.id,
                        deliveryAddress:
                          d.deliveryAddress ||
                          [c.address, c.city && c.state ? `${c.city}/${c.state}` : c.city].filter(Boolean).join(" — "),
                      }));
                    }}
                    onCreateNew={(name) => setNewCustomer({ businessName: name, contactName: "", phone: "" })}
                  />
                )
              }
            </Field>
          </section>

          {/* Itens */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-medium text-ink-2">Placas</h3>
              {options.products.length > draft.items.length && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
                  onClick={() => {
                    const next = options.products.find((p) => !draft.items.some((i) => i.productId === p.id));
                    if (next)
                      update("items", [
                        ...draft.items,
                        { productId: next.id, quantity: 1, unitPriceCents: next.salePriceCents },
                      ]);
                  }}
                >
                  <Plus className="size-3.5" /> Adicionar produto
                </button>
              )}
            </div>
            {draft.items.map((item, index) => {
              const product = productById.get(item.productId);
              const overStock = product ? item.quantity > product.currentStock : false;
              const priceChanged = product && item.unitPriceCents !== product.salePriceCents;
              return (
                <div key={index} className="rounded-xl border border-line bg-surface-2/50 p-3.5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_132px_140px]">
                    <Field label="Produto" className="col-span-2 sm:col-span-1">
                      {(p) => (
                        <Select
                          {...p}
                          value={item.productId}
                          onChange={(e) => {
                            const next = productById.get(e.target.value);
                            updateItem(index, {
                              productId: e.target.value,
                              unitPriceCents: next?.salePriceCents ?? item.unitPriceCents,
                            });
                          }}
                        >
                          {options.products.map((p2) => (
                            <option
                              key={p2.id}
                              value={p2.id}
                              disabled={p2.id !== item.productId && draft.items.some((i) => i.productId === p2.id)}
                            >
                              {p2.name} ({formatInteger(p2.currentStock)} disp.)
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="Quantidade" error={overStock ? `Disponível: ${product?.currentStock}` : undefined}>
                      {(p) => (
                        <div className="flex h-10 items-stretch overflow-hidden rounded-[10px] border border-line-strong bg-surface focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/15">
                          <button
                            type="button"
                            className="px-2.5 text-muted hover:bg-ink/5 hover:text-ink"
                            onClick={() => updateItem(index, { quantity: Math.max(1, item.quantity - 1) })}
                            aria-label="Diminuir quantidade"
                          >
                            <Minus className="size-4" />
                          </button>
                          <input
                            {...p}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            value={item.quantity || ""}
                            onChange={(e) =>
                              updateItem(index, { quantity: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })
                            }
                            onBlur={() => item.quantity < 1 && updateItem(index, { quantity: 1 })}
                            className="tabular w-full min-w-0 border-x border-line bg-transparent text-center text-sm focus:outline-none"
                          />
                          <button
                            type="button"
                            className="px-2.5 text-muted hover:bg-ink/5 hover:text-ink"
                            onClick={() => updateItem(index, { quantity: item.quantity + 1 })}
                            aria-label="Aumentar quantidade"
                          >
                            <Plus className="size-4" />
                          </button>
                        </div>
                      )}
                    </Field>
                    <Field
                      label="Preço unitário"
                      hint={priceChanged && product ? `Padrão: ${formatCents(product.salePriceCents)}` : undefined}
                    >
                      {(p) => (
                        <MoneyInput
                          {...p}
                          value={item.unitPriceCents}
                          onValueChange={(v) => updateItem(index, { unitPriceCents: v })}
                        />
                      )}
                    </Field>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-[13px]">
                    <span className="tabular text-muted">
                      {formatInteger(item.quantity)} × {formatCents(item.unitPriceCents ?? 0)}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tabular font-medium text-ink">
                        {formatCents(item.quantity * (item.unitPriceCents ?? 0))}
                      </span>
                      {draft.items.length > 1 && (
                        <button
                          type="button"
                          className="text-muted hover:text-negative"
                          onClick={() =>
                            update(
                              "items",
                              draft.items.filter((_, i) => i !== index),
                            )
                          }
                          aria-label="Remover item"
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </section>

          {/* Pagamento */}
          <section className="grid gap-4">
            <Field label="Forma de pagamento" required error={firstError(fieldErrors, "paymentMethodId")}>
              {() => (
                <Segmented
                  name="paymentMethodId"
                  ariaLabel="Forma de pagamento"
                  value={draft.paymentMethodId}
                  onChange={(v) => update("paymentMethodId", v)}
                  options={options.paymentMethods.map((m) => ({ value: m.id, label: m.name }))}
                />
              )}
            </Field>
            <Field label="Status do pagamento" required>
              {() => (
                <Segmented
                  name="paymentStatus"
                  ariaLabel="Status do pagamento"
                  value={draft.paymentStatus}
                  onChange={(v) => update("paymentStatus", v)}
                  options={[
                    { value: "PAID", label: "Pago agora", tone: "positive" },
                    { value: "PARTIAL", label: "Pagou uma parte", tone: "warning" },
                    { value: "PENDING", label: "Vai pagar depois", tone: "warning" },
                  ]}
                />
              )}
            </Field>
            {draft.paymentStatus !== "PAID" && (
              <div className="grid gap-3 sm:grid-cols-2">
                {draft.paymentStatus === "PARTIAL" && (
                  <Field label="Valor recebido agora" required error={firstError(fieldErrors, "amountReceivedCents")}>
                    {(p) => (
                      <MoneyInput
                        {...p}
                        value={draft.amountReceivedCents}
                        onValueChange={(v) => update("amountReceivedCents", v)}
                      />
                    )}
                  </Field>
                )}
                <Field
                  label="Vencimento"
                  hint={draft.dueDate ? undefined : `Padrão: ${defaultDue.split("-").reverse().join("/")}`}
                  error={firstError(fieldErrors, "dueDate")}
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="date"
                      value={draft.dueDate}
                      onChange={(e) => update("dueDate", e.target.value)}
                    />
                  )}
                </Field>
              </div>
            )}
            <Field
              label="Data da venda"
              hint={draft.saleDate ? undefined : "Usando data e hora atuais."}
              error={firstError(fieldErrors, "saleDate")}
            >
              {(p) => (
                <Input
                  {...p}
                  type="datetime-local"
                  value={draft.saleDate || toLocalDateTimeInput(new Date(), tz)}
                  max={`${todayString(tz)}T23:59`}
                  onChange={(e) => update("saleDate", e.target.value)}
                  className="sm:max-w-xs"
                />
              )}
            </Field>
          </section>

          {/* Mais detalhes */}
          <section className="rounded-xl border border-line">
            <button
              type="button"
              onClick={() => update("showMore", !draft.showMore)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-ink-2"
              aria-expanded={draft.showMore}
            >
              Desconto, frete, entrega e observações
              <ChevronDown className={cn("size-4 transition-transform", draft.showMore && "rotate-180")} />
            </button>
            {draft.showMore && (
              <div className="grid gap-3 border-t border-line px-4 py-4 sm:grid-cols-2">
                <Field label="Desconto" error={firstError(fieldErrors, "discountCents")}>
                  {(p) => (
                    <MoneyInput {...p} value={draft.discountCents} onValueChange={(v) => update("discountCents", v)} />
                  )}
                </Field>
                <Field label="Frete cobrado" error={firstError(fieldErrors, "shippingCents")}>
                  {(p) => (
                    <MoneyInput {...p} value={draft.shippingCents} onValueChange={(v) => update("shippingCents", v)} />
                  )}
                </Field>
                <Field label="Status da venda">
                  {(p) => (
                    <Select
                      {...p}
                      value={draft.status}
                      onChange={(e) => update("status", e.target.value as SaleDraft["status"])}
                    >
                      <option value="REGISTERED">Registrada</option>
                      <option value="PREPARING">Em preparação</option>
                      <option value="SHIPPED">Enviada</option>
                      <option value="DELIVERED">Entregue</option>
                    </Select>
                  )}
                </Field>
                <Field label="Previsão de entrega">
                  {(p) => (
                    <Input
                      {...p}
                      type="date"
                      value={draft.expectedDeliveryDate}
                      onChange={(e) => update("expectedDeliveryDate", e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Código de rastreamento">
                  {(p) => (
                    <Input {...p} value={draft.trackingCode} onChange={(e) => update("trackingCode", e.target.value)} />
                  )}
                </Field>
                <Field label="Endereço de entrega">
                  {(p) => (
                    <Input
                      {...p}
                      value={draft.deliveryAddress}
                      onChange={(e) => update("deliveryAddress", e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Observações" className="sm:col-span-2">
                  {(p) => (
                    <Textarea {...p} value={draft.notes} onChange={(e) => update("notes", e.target.value)} rows={2} />
                  )}
                </Field>
              </div>
            )}
          </section>

          {/* Resumo */}
          <section aria-label="Resumo dos valores" className="rounded-xl bg-ink px-4 py-4 text-white">
            <dl className="grid gap-1.5 text-sm">
              <div className="flex justify-between text-white/70">
                <dt>Produtos ({formatInteger(units)} × placas)</dt>
                <dd className="tabular">{formatCents(subtotal)}</dd>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-white/70">
                  <dt>Desconto</dt>
                  <dd className="tabular">− {formatCents(discount)}</dd>
                </div>
              )}
              {shipping > 0 && (
                <div className="flex justify-between text-white/70">
                  <dt>Frete</dt>
                  <dd className="tabular">+ {formatCents(shipping)}</dd>
                </div>
              )}
              <div className="mt-1 flex items-baseline justify-between border-t border-white/15 pt-2">
                <dt className="font-medium">Total da venda</dt>
                <dd className="tabular font-display text-2xl font-semibold">{formatCents(total)}</dd>
              </div>
              <div className="flex justify-between text-[13px]">
                <dt className="text-white/70">Entra no caixa agora</dt>
                <dd className="tabular text-[#7fe0b4]">{formatCents(Math.min(receivedNow, Math.max(total, 0)))}</dd>
              </div>
              {total - receivedNow > 0 && (
                <div className="flex justify-between text-[13px]">
                  <dt className="text-white/70">Fica a receber</dt>
                  <dd className="tabular text-[#ffc66d]">{formatCents(total - receivedNow)}</dd>
                </div>
              )}
            </dl>
          </section>
        </form>
      )}
    </DialogContent>
  );
}
