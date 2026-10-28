"use client";

import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { DEFAULT_TIMEZONE, toLocalDateTimeInput, todayString } from "@/lib/dates";
import { formatCents, formatInteger } from "@/lib/format";
import { getStockFormOptionsAction, registerStockEntryAction } from "@/server/actions/inventory";
import { firstError, useIdempotencyKey, useServerAction } from "./use-action";

type Options = Awaited<ReturnType<typeof getStockFormOptionsAction>>;

type StockEntryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetProductId?: string;
};

export function StockEntryDialog(props: StockEntryDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <StockEntryDialogBody {...props} />}
    </Dialog>
  );
}

function StockEntryDialogBody({ onOpenChange, presetProductId }: StockEntryDialogProps) {
  const [options, setOptions] = useState<Options | null>(null);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState<number | "">("");
  const [unitCost, setUnitCost] = useState<number | null>(null);
  const [totalCost, setTotalCost] = useState<number | null>(null);
  const [costUnknown, setCostUnknown] = useState(false);
  const [entryDate, setEntryDate] = useState("");
  const [supplier, setSupplier] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [paidNow, setPaidNow] = useState(true);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [key, renewKey] = useIdempotencyKey();
  const { run, pending, fieldErrors } = useServerAction(registerStockEntryAction);

  useEffect(() => {
    getStockFormOptionsAction().then((data) => {
      setOptions(data);
      setProductId(presetProductId || data.products[0]?.id || "");
      setPaymentMethodId(data.paymentMethods[0]?.id || "");
      setEntryDate(toLocalDateTimeInput(new Date(), data.timezone));
    });
  }, [presetProductId]);

  const qty = typeof quantity === "number" ? quantity : 0;
  const product = options?.products.find((p) => p.id === productId);
  const tz = options?.timezone ?? DEFAULT_TIMEZONE;

  function onUnitCost(value: number | null) {
    setUnitCost(value);
    setTotalCost(value !== null && qty > 0 ? value * qty : null);
  }
  function onTotalCost(value: number | null) {
    setTotalCost(value);
    setUnitCost(value !== null && qty > 0 ? Math.round(value / qty) : null);
  }
  function onQuantity(value: string) {
    const n = value === "" ? "" : Math.max(0, Math.trunc(Number(value) || 0));
    setQuantity(n);
    if (typeof n === "number" && unitCost !== null) setTotalCost(unitCost * n);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      {
        productId,
        quantity: qty,
        unitCostCents: costUnknown ? null : unitCost,
        entryDate,
        supplier,
        documentNumber,
        notes,
        paidNow: !costUnknown && paidNow,
        paymentMethodId: !costUnknown && paidNow ? paymentMethodId : null,
        idempotencyKey: key,
      },
      {
        onSuccess: () => {
          renewKey();
          onOpenChange(false);
        },
      },
    );
  }

  const stockAfter = (product?.currentStock ?? 0) + qty;

  return (
    <DialogContent
      title="Entrada de estoque"
      description="Registre as placas recebidas. O estoque e o custo médio são atualizados na hora."
      size="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="stock-entry-form" loading={pending} disabled={!options || qty <= 0}>
            Registrar entrada
          </Button>
        </>
      }
    >
      {!options ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted">
          <Spinner /> Carregando…
        </div>
      ) : options.products.length === 0 ? (
        <p className="py-6 text-sm text-muted">Cadastre um produto antes de registrar entradas.</p>
      ) : (
        <form id="stock-entry-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Produto" required className="sm:col-span-2" error={firstError(fieldErrors, "productId")}>
            {(p) => (
              <Select {...p} value={productId} onChange={(e) => setProductId(e.target.value)}>
                {options.products.map((prod) => (
                  <option key={prod.id} value={prod.id}>
                    {prod.name} — {prod.sku} ({formatInteger(prod.currentStock)} em estoque)
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Quantidade recebida"
            required
            error={firstError(fieldErrors, "quantity")}
            hint={qty > 0 ? `Estoque passará para ${formatInteger(stockAfter)} unidades.` : undefined}
          >
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="numeric"
                min={1}
                autoFocus
                value={quantity}
                onChange={(e) => onQuantity(e.target.value)}
              />
            )}
          </Field>
          <Field label="Data da entrada" required error={firstError(fieldErrors, "entryDate")}>
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                value={entryDate}
                max={`${todayString(tz)}T23:59`}
                onChange={(e) => setEntryDate(e.target.value)}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Checkbox
              label="Não sei o custo de aquisição"
              description="O lucro destas placas ficará marcado como impreciso até o custo ser informado."
              checked={costUnknown}
              onChange={(e) => setCostUnknown(e.target.checked)}
            />
          </div>
          {!costUnknown && (
            <>
              <Field
                label="Custo unitário"
                error={firstError(fieldErrors, "unitCostCents")}
                hint={
                  product?.lastPurchaseCost != null
                    ? `Última compra: ${formatCents(Math.round(product.lastPurchaseCost * 100))}`
                    : undefined
                }
              >
                {(p) => <MoneyInput {...p} value={unitCost} onValueChange={onUnitCost} />}
              </Field>
              <Field label="Custo total" hint={qty > 0 ? `${formatInteger(qty)} unidades` : "Informe a quantidade"}>
                {(p) => <MoneyInput {...p} value={totalCost} onValueChange={onTotalCost} disabled={qty <= 0} />}
              </Field>
              <div className="rounded-xl border border-line bg-surface-2/60 p-3.5 sm:col-span-2">
                <Checkbox
                  label="O pagamento desta compra saiu do caixa agora"
                  description="Gera uma saída no livro-caixa. Desmarque se a compra foi paga antes ou será paga depois."
                  checked={paidNow}
                  onChange={(e) => setPaidNow(e.target.checked)}
                />
                {paidNow && (
                  <div className="mt-3 sm:max-w-xs">
                    <Field label="Forma de pagamento" error={firstError(fieldErrors, "paymentMethodId")}>
                      {(p) => (
                        <Select {...p} value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
                          {options.paymentMethods.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  </div>
                )}
              </div>
            </>
          )}
          <Field label="Fornecedor">
            {(p) => <Input {...p} value={supplier} onChange={(e) => setSupplier(e.target.value)} />}
          </Field>
          <Field label="Nº do pedido ou documento">
            {(p) => <Input {...p} value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />}
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            {(p) => <Textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </form>
      )}
    </DialogContent>
  );
}
