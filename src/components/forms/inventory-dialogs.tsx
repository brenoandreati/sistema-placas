"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Segmented } from "@/components/ui/segmented";
import { toLocalDateTimeInput, todayString } from "@/lib/dates";
import { formatCents, formatInteger, numberToCents } from "@/lib/format";
import {
  adjustStockAction,
  createProductAction,
  setAverageCostAction,
  updateProductAction,
} from "@/server/actions/inventory";
import { firstError, useServerAction } from "./use-action";

export interface ProductFormData {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  category: string | null;
  salePrice: number;
  minStock: number;
  active: boolean;
  currentStock: number;
  averageCost: number | null;
}

// ───────────────────────── Produto ─────────────────────────

type ProductDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: ProductFormData;
  defaults: { salePrice: number | null; minStock: number };
};

export function ProductDialog(props: ProductDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <ProductDialogBody {...props} />}
    </Dialog>
  );
}

function ProductDialogBody({ onOpenChange, product, defaults }: ProductDialogProps) {
  const init = () => ({
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    description: product?.description ?? "",
    category: product?.category ?? "Placas NFC",
    salePriceCents: product
      ? numberToCents(product.salePrice)
      : defaults.salePrice !== null
        ? numberToCents(defaults.salePrice)
        : null,
    minStock: product?.minStock ?? defaults.minStock,
    active: product?.active ?? true,
    initialQuantity: 0,
    initialUnitCostCents: null as number | null,
  });
  const [form, setForm] = useState(init);
  const create = useServerAction(createProductAction);
  const update = useServerAction(updateProductAction);
  const action = product ? update : create;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const base = {
      name: form.name,
      sku: form.sku,
      description: form.description,
      category: form.category,
      salePriceCents: form.salePriceCents ?? 0,
      minStock: form.minStock,
      active: form.active,
    };
    if (product) update.run({ ...base, productId: product.id }, { onSuccess: () => onOpenChange(false) });
    else
      create.run(
        {
          ...base,
          initialQuantity: form.initialQuantity,
          initialUnitCostCents: form.initialUnitCostCents,
          initialPaidNow: false,
        },
        { onSuccess: () => onOpenChange(false) },
      );
  }

  const errors = action.fieldErrors;
  return (
    <DialogContent
      size="lg"
      title={product ? "Editar produto" : "Novo produto"}
      description={
        product
          ? "O estoque não é alterado aqui: use Entrada ou Ajuste."
          : "Modelos, tamanhos e acabamentos diferentes podem ser cadastrados como produtos separados."
      }
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="product-form" loading={action.pending}>
            {product ? "Salvar produto" : "Cadastrar produto"}
          </Button>
        </>
      }
    >
      <form id="product-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" required className="sm:col-span-2" error={firstError(errors, "name")}>
          {(p) => (
            <Input {...p} autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          )}
        </Field>
        <Field label="Código SKU" required error={firstError(errors, "sku")}>
          {(p) => (
            <Input
              {...p}
              className="font-mono uppercase"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })}
            />
          )}
        </Field>
        <Field label="Categoria" error={firstError(errors, "category")}>
          {(p) => (
            <Input {...p} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          )}
        </Field>
        <Field
          label="Preço de venda padrão"
          required
          error={firstError(errors, "salePriceCents")}
          hint={
            product && numberToCents(product.salePrice) !== form.salePriceCents
              ? "A alteração fica registrada na auditoria."
              : undefined
          }
        >
          {(p) => (
            <MoneyInput
              {...p}
              value={form.salePriceCents}
              onValueChange={(v) => setForm({ ...form, salePriceCents: v })}
            />
          )}
        </Field>
        <Field label="Estoque mínimo" error={firstError(errors, "minStock")} hint="Abaixo disso o painel alerta.">
          {(p) => (
            <Input
              {...p}
              type="number"
              inputMode="numeric"
              min={0}
              value={form.minStock}
              onChange={(e) => setForm({ ...form, minStock: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
            />
          )}
        </Field>
        {!product && (
          <>
            <Field label="Estoque inicial" hint="Opcional. Não gera saída de caixa.">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={form.initialQuantity || ""}
                  onChange={(e) =>
                    setForm({ ...form, initialQuantity: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })
                  }
                />
              )}
            </Field>
            <Field label="Custo unitário de aquisição" hint="Deixe em branco se não souber.">
              {(p) => (
                <MoneyInput
                  {...p}
                  value={form.initialUnitCostCents}
                  onValueChange={(v) => setForm({ ...form, initialUnitCostCents: v })}
                />
              )}
            </Field>
          </>
        )}
        <Field label="Descrição" className="sm:col-span-2">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          )}
        </Field>
        {product && (
          <div className="sm:col-span-2">
            <Checkbox
              label="Produto ativo"
              description="Produtos inativos não aparecem no formulário de venda. O histórico é mantido."
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
          </div>
        )}
      </form>
    </DialogContent>
  );
}

// ───────────────────────── Ajuste ─────────────────────────

type AdjustStockDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Pick<ProductFormData, "id" | "name" | "currentStock">;
  timezone: string;
};

export function AdjustStockDialog(props: AdjustStockDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <AdjustStockDialogBody {...props} />}
    </Dialog>
  );
}

function AdjustStockDialogBody({ onOpenChange, product, timezone }: AdjustStockDialogProps) {
  const [direction, setDirection] = useState<"IN" | "OUT">("OUT");
  const [quantity, setQuantity] = useState<number | "">("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => toLocalDateTimeInput(new Date(), timezone));
  const { run, pending, fieldErrors } = useServerAction(adjustStockAction);

  const qty = typeof quantity === "number" ? quantity : 0;
  const after = product.currentStock + (direction === "IN" ? qty : -qty);

  return (
    <DialogContent
      title="Ajustar estoque"
      description={`${product.name} · ${formatInteger(product.currentStock)} em estoque`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="adjust-form"
            loading={pending}
            disabled={qty <= 0 || after < 0 || reason.trim().length < 5}
          >
            Registrar ajuste
          </Button>
        </>
      }
    >
      <form
        id="adjust-form"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            { productId: product.id, direction, quantity: qty, reason, notes, occurredAt },
            { onSuccess: () => onOpenChange(false) },
          );
        }}
      >
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
          Use para perdas, avarias, brindes ou correções de contagem. Para placas compradas, use{" "}
          <b>Entrada de estoque</b>.
        </p>
        <Segmented
          name="direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "OUT", label: "Retirar unidades" },
            { value: "IN", label: "Acrescentar unidades" },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Quantidade"
            required
            error={firstError(fieldErrors, "quantity") ?? (after < 0 ? "Estoque não pode ficar negativo." : undefined)}
            hint={qty > 0 && after >= 0 ? `Estoque passará para ${formatInteger(after)}.` : undefined}
          >
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="numeric"
                min={1}
                value={quantity}
                onChange={(e) =>
                  setQuantity(e.target.value === "" ? "" : Math.max(0, Math.trunc(Number(e.target.value))))
                }
              />
            )}
          </Field>
          <Field label="Data" required error={firstError(fieldErrors, "occurredAt")}>
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                value={occurredAt}
                max={`${todayString(timezone)}T23:59`}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field
          label="Justificativa"
          required
          error={firstError(fieldErrors, "reason")}
          hint="Obrigatória. Fica registrada no histórico de movimentações."
        >
          {(p) => (
            <Input
              {...p}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: 2 placas trincadas no transporte"
            />
          )}
        </Field>
        <Field label="Observações">
          {(p) => <Textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </form>
    </DialogContent>
  );
}

// ───────────────────────── Custo médio ─────────────────────────

type CostDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Pick<ProductFormData, "id" | "name" | "averageCost" | "currentStock">;
};

export function CostDialog(props: CostDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <CostDialogBody {...props} />}
    </Dialog>
  );
}

function CostDialogBody({ onOpenChange, product }: CostDialogProps) {
  const [cost, setCost] = useState<number | null>(
    product.averageCost !== null ? numberToCents(product.averageCost) : null,
  );
  const [reason, setReason] = useState(product.averageCost === null ? "Custo de aquisição informado" : "");
  const [applyToSales, setApplyToSales] = useState(true);
  const { run, pending, fieldErrors } = useServerAction(setAverageCostAction);

  return (
    <DialogContent
      title="Custo de aquisição"
      description={product.name}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="cost-form" loading={pending} disabled={cost === null || reason.trim().length < 5}>
            Salvar custo
          </Button>
        </>
      }
    >
      <form
        id="cost-form"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            { productId: product.id, unitCostCents: cost ?? 0, reason, applyToUnknownSales: applyToSales },
            { onSuccess: () => onOpenChange(false) },
          );
        }}
      >
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
          O sistema usa o <b>custo médio ponderado</b>: cada entrada com custo recalcula a média. Defina manualmente
          apenas quando o custo não foi informado ou precisa ser corrigido.{" "}
          {product.averageCost !== null && <>Atual: {formatCents(numberToCents(product.averageCost))} por placa.</>}
        </p>
        <Field label="Custo por placa" required error={firstError(fieldErrors, "unitCostCents")}>
          {(p) => <MoneyInput {...p} autoFocus value={cost} onValueChange={setCost} />}
        </Field>
        <Field label="Justificativa" required error={firstError(fieldErrors, "reason")}>
          {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <Checkbox
          label="Aplicar também às vendas já registradas sem custo"
          description="Permite calcular o lucro dessas vendas. Vendas com custo já registrado não mudam."
          checked={applyToSales}
          onChange={(e) => setApplyToSales(e.target.checked)}
        />
      </form>
    </DialogContent>
  );
}
