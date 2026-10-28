"use client";

import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Segmented } from "@/components/ui/segmented";
import { toLocalDateTimeInput, todayString } from "@/lib/dates";
import { formatCents, formatInteger, formatOrderNumber, numberToCents } from "@/lib/format";
import {
  cancelSaleAction,
  refundPaymentAction,
  registerPaymentAction,
  settleRefundAction,
  updateSaleAction,
} from "@/server/actions/sales";
import { firstError, useIdempotencyKey, useServerAction } from "./use-action";

interface Option {
  id: string;
  name: string;
}

// ───────────────────────── Registrar pagamento ─────────────────────────

type PaymentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: {
    id: string;
    number: number;
    customerName: string;
    total: number;
    amountPaid: number;
    paymentMethodId?: string;
  };
  paymentMethods: Option[];
  timezone: string;
};

export function PaymentDialog(props: PaymentDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <PaymentDialogBody {...props} />}
    </Dialog>
  );
}

function PaymentDialogBody({ onOpenChange, sale, paymentMethods, timezone }: PaymentDialogProps) {
  const pendingCents = numberToCents(sale.total - sale.amountPaid);
  const [amount, setAmount] = useState<number | null>(pendingCents);
  const [methodId, setMethodId] = useState(sale.paymentMethodId ?? paymentMethods[0]?.id ?? "");
  const [paidAt, setPaidAt] = useState(() => toLocalDateTimeInput(new Date(), timezone));
  const [notes, setNotes] = useState("");
  const [key, renewKey] = useIdempotencyKey();
  const { run, pending, fieldErrors } = useServerAction(registerPaymentAction);

  const remaining = pendingCents - (amount ?? 0);

  return (
    <DialogContent
      title="Registrar pagamento"
      description={`${formatOrderNumber(sale.number)} · ${sale.customerName}`}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="payment-form" loading={pending} disabled={!amount || remaining < 0}>
            Registrar {formatCents(amount ?? 0)}
          </Button>
        </>
      }
    >
      <form
        id="payment-form"
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            {
              saleId: sale.id,
              amountCents: amount ?? 0,
              paymentMethodId: methodId,
              paidAt,
              notes,
              idempotencyKey: key,
            },
            {
              onSuccess: () => {
                renewKey();
                setNotes("");
                onOpenChange(false);
              },
            },
          );
        }}
      >
        <div className="rounded-xl bg-surface-2 px-4 py-3 text-sm sm:col-span-2">
          <div className="flex justify-between text-ink-2">
            <span>Total da venda</span>
            <span className="tabular">{formatCents(numberToCents(sale.total))}</span>
          </div>
          <div className="flex justify-between text-ink-2">
            <span>Já recebido</span>
            <span className="tabular">{formatCents(numberToCents(sale.amountPaid))}</span>
          </div>
          <div className="mt-1 flex justify-between font-medium text-ink">
            <span>Saldo pendente</span>
            <span className="tabular">{formatCents(pendingCents)}</span>
          </div>
        </div>
        <Field
          label="Valor recebido"
          required
          error={
            firstError(fieldErrors, "amountCents") ?? (remaining < 0 ? "Valor maior que o saldo pendente." : undefined)
          }
          hint={
            remaining > 0 && amount
              ? `Continuará pendente: ${formatCents(remaining)}`
              : amount
                ? "Quita a venda."
                : undefined
          }
        >
          {(p) => <MoneyInput {...p} autoFocus value={amount} onValueChange={setAmount} />}
        </Field>
        <Field label="Data do recebimento" required error={firstError(fieldErrors, "paidAt")}>
          {(p) => (
            <Input
              {...p}
              type="datetime-local"
              value={paidAt}
              max={`${todayString(timezone)}T23:59`}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          )}
        </Field>
        <Field label="Forma de pagamento" required className="sm:col-span-2">
          {() => (
            <Segmented
              name="payment-method"
              value={methodId}
              onChange={setMethodId}
              options={paymentMethods.map((m) => ({ value: m.id, label: m.name }))}
            />
          )}
        </Field>
        <Field label="Observações" className="sm:col-span-2">
          {(p) => <Textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </form>
    </DialogContent>
  );
}

// ───────────────────────── Estornar recebimento ─────────────────────────

type RefundDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: { id: string; number: number; amount: number; refundable: number; paymentMethod: string };
  timezone: string;
};

export function RefundDialog(props: RefundDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <RefundDialogBody {...props} />}
    </Dialog>
  );
}

function RefundDialogBody({ onOpenChange, payment, timezone }: RefundDialogProps) {
  const refundableCents = numberToCents(payment.refundable);
  const [amount, setAmount] = useState<number | null>(refundableCents);
  const [paidAt, setPaidAt] = useState(() => toLocalDateTimeInput(new Date(), timezone));
  const [reason, setReason] = useState("");
  const [key, renewKey] = useIdempotencyKey();
  const { run, pending, fieldErrors } = useServerAction(refundPaymentAction);

  return (
    <DialogContent
      title="Estornar recebimento"
      description={`Recebimento nº ${payment.number} · ${payment.paymentMethod} · ${formatCents(numberToCents(payment.amount))}`}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            type="submit"
            form="refund-form"
            loading={pending}
            disabled={!amount || reason.trim().length < 5}
          >
            Estornar {formatCents(amount ?? 0)}
          </Button>
        </>
      }
    >
      <form
        id="refund-form"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            { paymentId: payment.id, amountCents: amount ?? 0, paidAt, reason, idempotencyKey: key },
            {
              onSuccess: () => {
                renewKey();
                setReason("");
                onOpenChange(false);
              },
            },
          );
        }}
      >
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
          O estorno gera uma saída compensatória no caixa. O recebimento original continua no histórico e a venda volta
          a ter saldo pendente.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Valor do estorno"
            required
            error={firstError(fieldErrors, "amountCents")}
            hint={`Máximo: ${formatCents(refundableCents)}`}
          >
            {(p) => <MoneyInput {...p} value={amount} onValueChange={setAmount} />}
          </Field>
          <Field label="Data" required error={firstError(fieldErrors, "paidAt")}>
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                value={paidAt}
                max={`${todayString(timezone)}T23:59`}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field
          label="Motivo"
          required
          error={firstError(fieldErrors, "reason")}
          hint="Obrigatório. Fica registrado na auditoria."
        >
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: PIX lançado em duplicidade"
            />
          )}
        </Field>
      </form>
    </DialogContent>
  );
}

// ───────────────────────── Cancelar venda ─────────────────────────

type CancelSaleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: {
    id: string;
    number: number;
    amountPaid: number;
    items: { id: string; productName: string; quantity: number }[];
  };
  timezone: string;
};

export function CancelSaleDialog(props: CancelSaleDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <CancelSaleDialogBody {...props} />}
    </Dialog>
  );
}

function CancelSaleDialogBody({ onOpenChange, sale, timezone }: CancelSaleDialogProps) {
  const [reason, setReason] = useState("");
  const [returns, setReturns] = useState<Record<string, number>>(() =>
    Object.fromEntries(sale.items.map((i) => [i.id, i.quantity])),
  );
  const [refundMode, setRefundMode] = useState<"REFUND_NOW" | "REFUND_LATER">("REFUND_NOW");
  const { run, pending, fieldErrors } = useServerAction(cancelSaleAction);

  const lost = sale.items.reduce((acc, i) => acc + i.quantity - (returns[i.id] ?? i.quantity), 0);

  return (
    <DialogContent
      title={`Cancelar ${formatOrderNumber(sale.number)}`}
      description="A venda continua no histórico, marcada como cancelada."
      size="lg"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            variant="danger"
            type="submit"
            form="cancel-form"
            loading={pending}
            disabled={reason.trim().length < 5}
          >
            Cancelar venda
          </Button>
        </>
      }
    >
      <form
        id="cancel-form"
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            {
              saleId: sale.id,
              reason,
              returns: sale.items.map((i) => ({ saleItemId: i.id, returnQuantity: returns[i.id] ?? i.quantity })),
              refundMode,
              refundDate: toLocalDateTimeInput(new Date(), timezone),
            },
            { onSuccess: () => onOpenChange(false) },
          );
        }}
      >
        <div>
          <h3 className="text-[13px] font-medium text-ink-2">Placas que voltam ao estoque</h3>
          <p className="mt-0.5 text-xs text-muted">
            Devolva apenas as placas em condição de revenda. As demais (ex.: já personalizadas) ficam registradas como
            perda.
          </p>
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
            {sale.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-sm text-ink">
                  {item.productName} <span className="text-muted">· {formatInteger(item.quantity)} vendida(s)</span>
                </span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={item.quantity}
                  aria-label={`Unidades de ${item.productName} que voltam ao estoque`}
                  value={returns[item.id] ?? item.quantity}
                  onChange={(e) =>
                    setReturns({
                      ...returns,
                      [item.id]: Math.min(item.quantity, Math.max(0, Math.trunc(Number(e.target.value) || 0))),
                    })
                  }
                  className="w-24 text-right"
                />
              </li>
            ))}
          </ul>
          {lost > 0 && (
            <p className="mt-2 text-xs text-warning">
              {formatInteger(lost)} placa(s) serão registradas como perda no lucro.
            </p>
          )}
        </div>

        {sale.amountPaid > 0 && (
          <div className="rounded-xl border border-warning/30 bg-warning-soft/60 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-warning">
              <TriangleAlert className="size-4" /> Esta venda tem {formatCents(numberToCents(sale.amountPaid))}{" "}
              recebidos
            </p>
            <div className="mt-3">
              <Segmented
                name="refund-mode"
                value={refundMode}
                onChange={setRefundMode}
                options={[
                  { value: "REFUND_NOW", label: "Devolver agora (saída do caixa)" },
                  { value: "REFUND_LATER", label: "Registrar como valor a devolver" },
                ]}
              />
            </div>
          </div>
        )}

        <Field label="Motivo do cancelamento" required error={firstError(fieldErrors, "reason")}>
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: cliente desistiu antes da produção"
            />
          )}
        </Field>
      </form>
    </DialogContent>
  );
}

// ───────────────────────── Devolver valor de venda cancelada ─────────────────────────

type SettleRefundDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: { id: string; number: number; refundDue: number };
  timezone: string;
};

export function SettleRefundDialog(props: SettleRefundDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <SettleRefundDialogBody {...props} />}
    </Dialog>
  );
}

function SettleRefundDialogBody({ onOpenChange, sale, timezone }: SettleRefundDialogProps) {
  const dueCents = numberToCents(sale.refundDue);
  const [amount, setAmount] = useState<number | null>(dueCents);
  const [paidAt, setPaidAt] = useState(() => toLocalDateTimeInput(new Date(), timezone));
  const [reason, setReason] = useState("");
  const [key, renewKey] = useIdempotencyKey();
  const { run, pending, fieldErrors } = useServerAction(settleRefundAction);

  return (
    <DialogContent
      title="Devolver valor ao cliente"
      description={`${formatOrderNumber(sale.number)} · a devolver ${formatCents(dueCents)}`}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="settle-form" loading={pending} disabled={!amount || reason.trim().length < 5}>
            Registrar devolução
          </Button>
        </>
      }
    >
      <form
        id="settle-form"
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            { saleId: sale.id, amountCents: amount ?? 0, paidAt, reason, idempotencyKey: key },
            {
              onSuccess: () => {
                renewKey();
                onOpenChange(false);
              },
            },
          );
        }}
      >
        <Field label="Valor devolvido" required error={firstError(fieldErrors, "amountCents")}>
          {(p) => <MoneyInput {...p} value={amount} onValueChange={setAmount} />}
        </Field>
        <Field label="Data" required>
          {(p) => (
            <Input
              {...p}
              type="datetime-local"
              value={paidAt}
              max={`${todayString(timezone)}T23:59`}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          )}
        </Field>
        <Field label="Observação" required className="sm:col-span-2" error={firstError(fieldErrors, "reason")}>
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: devolvido via PIX"
            />
          )}
        </Field>
      </form>
    </DialogContent>
  );
}

// ───────────────────────── Editar venda ─────────────────────────

export interface EditableSale {
  id: string;
  number: number;
  customerId: string;
  saleDate: string;
  status: string;
  paymentMethodId: string;
  discount: number;
  shipping: number;
  subtotal: number;
  amountPaid: number;
  dueDate: string | null;
  notes: string | null;
  trackingCode: string | null;
  deliveryAddress: string | null;
  expectedDeliveryDate: string | null;
}

type EditSaleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: EditableSale;
  paymentMethods: Option[];
  customers: Option[];
  timezone: string;
};

export function EditSaleDialog(props: EditSaleDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <EditSaleDialogBody {...props} />}
    </Dialog>
  );
}

function EditSaleDialogBody({ onOpenChange, sale, paymentMethods, customers, timezone }: EditSaleDialogProps) {
  const init = () => ({
    customerId: sale.customerId,
    saleDate: toLocalDateTimeInput(new Date(sale.saleDate), timezone),
    status: sale.status === "CANCELLED" ? "REGISTERED" : sale.status,
    paymentMethodId: sale.paymentMethodId,
    discountCents: numberToCents(sale.discount) as number | null,
    shippingCents: numberToCents(sale.shipping) as number | null,
    dueDate: sale.dueDate ?? "",
    notes: sale.notes ?? "",
    trackingCode: sale.trackingCode ?? "",
    deliveryAddress: sale.deliveryAddress ?? "",
    expectedDeliveryDate: sale.expectedDeliveryDate ?? "",
  });
  const [form, setForm] = useState(init);
  const { run, pending, fieldErrors } = useServerAction(updateSaleAction);

  const set = <K extends keyof ReturnType<typeof init>>(key: K, value: ReturnType<typeof init>[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const newTotal = numberToCents(sale.subtotal) - (form.discountCents ?? 0) + (form.shippingCents ?? 0);

  return (
    <DialogContent
      variant="sheet"
      title={`Editar ${formatOrderNumber(sale.number)}`}
      description="Quantidades e produtos não mudam aqui: o estoque não é baixado novamente."
      footer={
        <>
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="edit-sale-form" loading={pending}>
            Salvar alterações
          </Button>
        </>
      }
    >
      <form
        id="edit-sale-form"
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            {
              saleId: sale.id,
              customerId: form.customerId,
              saleDate: form.saleDate,
              status: form.status as "REGISTERED",
              paymentMethodId: form.paymentMethodId,
              discountCents: form.discountCents ?? 0,
              shippingCents: form.shippingCents ?? 0,
              dueDate: form.dueDate || undefined,
              notes: form.notes,
              trackingCode: form.trackingCode,
              deliveryAddress: form.deliveryAddress,
              expectedDeliveryDate: form.expectedDeliveryDate || undefined,
            },
            { onSuccess: () => onOpenChange(false) },
          );
        }}
      >
        <Field label="Cliente" className="sm:col-span-2" error={firstError(fieldErrors, "customerId")}>
          {(p) => (
            <Select {...p} value={form.customerId} onChange={(e) => set("customerId", e.target.value)}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Data da venda" error={firstError(fieldErrors, "saleDate")}>
          {(p) => (
            <Input
              {...p}
              type="datetime-local"
              value={form.saleDate}
              max={`${todayString(timezone)}T23:59`}
              onChange={(e) => set("saleDate", e.target.value)}
            />
          )}
        </Field>
        <Field label="Status da venda">
          {(p) => (
            <Select {...p} value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option value="REGISTERED">Registrada</option>
              <option value="PREPARING">Em preparação</option>
              <option value="SHIPPED">Enviada</option>
              <option value="DELIVERED">Entregue</option>
            </Select>
          )}
        </Field>
        <Field label="Forma de pagamento combinada">
          {(p) => (
            <Select {...p} value={form.paymentMethodId} onChange={(e) => set("paymentMethodId", e.target.value)}>
              {paymentMethods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Vencimento" error={firstError(fieldErrors, "dueDate")}>
          {(p) => <Input {...p} type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />}
        </Field>
        <Field label="Desconto" error={firstError(fieldErrors, "discountCents")}>
          {(p) => <MoneyInput {...p} value={form.discountCents} onValueChange={(v) => set("discountCents", v)} />}
        </Field>
        <Field label="Frete cobrado" error={firstError(fieldErrors, "shippingCents")}>
          {(p) => <MoneyInput {...p} value={form.shippingCents} onValueChange={(v) => set("shippingCents", v)} />}
        </Field>
        <p className="text-sm text-muted sm:col-span-2">
          Novo total: <span className="tabular font-medium text-ink">{formatCents(newTotal)}</span>
          {newTotal < numberToCents(sale.amountPaid) && (
            <span className="text-negative">
              {" "}
              — menor que o valor já recebido ({formatCents(numberToCents(sale.amountPaid))}).
            </span>
          )}
        </p>
        <Field label="Código de rastreamento">
          {(p) => <Input {...p} value={form.trackingCode} onChange={(e) => set("trackingCode", e.target.value)} />}
        </Field>
        <Field label="Previsão de entrega">
          {(p) => (
            <Input
              {...p}
              type="date"
              value={form.expectedDeliveryDate}
              onChange={(e) => set("expectedDeliveryDate", e.target.value)}
            />
          )}
        </Field>
        <Field label="Endereço de entrega" className="sm:col-span-2">
          {(p) => (
            <Input {...p} value={form.deliveryAddress} onChange={(e) => set("deliveryAddress", e.target.value)} />
          )}
        </Field>
        <Field label="Observações" className="sm:col-span-2">
          {(p) => <Textarea {...p} rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />}
        </Field>
      </form>
    </DialogContent>
  );
}
