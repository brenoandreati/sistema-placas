"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Spinner } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Segmented } from "@/components/ui/segmented";
import { DEFAULT_TIMEZONE, toLocalDateTimeInput, todayString } from "@/lib/dates";
import { formatBRL } from "@/lib/format";
import { getFinanceFormOptionsAction, registerExpenseAction, registerIncomeAction } from "@/server/actions/finance";
import { firstError, useIdempotencyKey, useServerAction } from "./use-action";

type Options = Awaited<ReturnType<typeof getFinanceFormOptionsAction>>;
type Mode = "expense" | "income";

/** Lançamentos manuais do caixa: despesas, aportes de capital e outras entradas. */
type FinanceEntryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  presetSaleId?: string;
};

export function FinanceEntryDialog(props: FinanceEntryDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <FinanceEntryDialogBody {...props} />}
    </Dialog>
  );
}

function FinanceEntryDialogBody({ onOpenChange, mode, presetSaleId }: FinanceEntryDialogProps) {
  const [options, setOptions] = useState<Options | null>(null);
  const [incomeKind, setIncomeKind] = useState<"CAPITAL_CONTRIBUTION" | "OTHER_INCOME">("CAPITAL_CONTRIBUTION");
  const [amount, setAmount] = useState<number | null>(null);
  const [chosenCategoryId, setCategoryId] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [description, setDescription] = useState("");
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [key, renewKey] = useIdempotencyKey();
  const expense = useServerAction(registerExpenseAction);
  const income = useServerAction(registerIncomeAction);
  const action = mode === "expense" ? expense : income;

  const group = mode === "expense" ? "EXPENSE" : incomeKind;

  useEffect(() => {
    getFinanceFormOptionsAction().then((data) => {
      setOptions(data);
      setPaymentMethodId(data.paymentMethods[0]?.id ?? "");
      setCashAccountId(data.defaultAccountId);
      setOccurredAt(toLocalDateTimeInput(new Date(), data.timezone));
    });
  }, []);

  const categories = useMemo(() => options?.categories.filter((c) => c.group === group) ?? [], [options, group]);
  // A categoria escolhida só vale se pertencer ao tipo atual; senão usa a primeira do grupo.
  const categoryId = categories.some((c) => c.id === chosenCategoryId) ? chosenCategoryId : (categories[0]?.id ?? "");

  const tz = options?.timezone ?? DEFAULT_TIMEZONE;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const onSuccess = () => {
      renewKey();
      onOpenChange(false);
    };
    if (mode === "expense") {
      expense.run(
        {
          amountCents: amount ?? 0,
          incurredAt: occurredAt,
          categoryId,
          description,
          paymentMethodId: paymentMethodId || null,
          supplier,
          notes,
          saleId: presetSaleId ?? null,
          cashAccountId,
          idempotencyKey: key,
        },
        { onSuccess },
      );
    } else {
      income.run(
        {
          kind: incomeKind,
          amountCents: amount ?? 0,
          occurredAt,
          categoryId,
          description,
          paymentMethodId: paymentMethodId || null,
          notes,
          cashAccountId,
          idempotencyKey: key,
        },
        { onSuccess },
      );
    }
  }

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const errors = action.fieldErrors;

  return (
    <DialogContent
      title={mode === "expense" ? "Registrar despesa" : "Registrar entrada"}
      description={
        mode === "expense"
          ? "Saídas operacionais do negócio (frete, embalagens, taxas, publicidade…)."
          : "Dinheiro que entra no caixa sem ser venda. Não conta como faturamento."
      }
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="finance-entry-form" loading={action.pending} disabled={!options || !amount}>
            {mode === "expense" ? "Registrar despesa" : "Registrar entrada"}
          </Button>
        </>
      }
    >
      {!options ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted">
          <Spinner /> Carregando…
        </div>
      ) : (
        <form id="finance-entry-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          {mode === "income" && (
            <Field label="Tipo de entrada" className="sm:col-span-2">
              {() => (
                <Segmented
                  name="incomeKind"
                  value={incomeKind}
                  onChange={setIncomeKind}
                  options={[
                    { value: "CAPITAL_CONTRIBUTION", label: "Aporte de capital" },
                    { value: "OTHER_INCOME", label: "Outra entrada" },
                  ]}
                />
              )}
            </Field>
          )}
          <Field label="Valor" required error={firstError(errors, "amountCents")}>
            {(p) => <MoneyInput {...p} autoFocus value={amount} onValueChange={setAmount} />}
          </Field>
          <Field label="Data" required error={firstError(errors, mode === "expense" ? "incurredAt" : "occurredAt")}>
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                value={occurredAt}
                max={`${todayString(tz)}T23:59`}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Categoria"
            required
            error={firstError(errors, "categoryId")}
            hint={
              selectedCategory?.isDirectCost
                ? "Custo direto das vendas: entra no cálculo do lucro estimado."
                : undefined
            }
          >
            {(p) => (
              <Select {...p} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Forma de pagamento">
            {(p) => (
              <Select {...p} value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
                <option value="">Não informada</option>
                {options.paymentMethods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {options.accounts.length > 1 && (
            <Field label="Conta de caixa" className="sm:col-span-2">
              {(p) => (
                <Select {...p} value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)}>
                  {options.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {formatBRL(a.balance)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Descrição" required className="sm:col-span-2" error={firstError(errors, "description")}>
            {(p) => <Input {...p} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          {mode === "expense" && (
            <Field label="Fornecedor" className="sm:col-span-2">
              {(p) => <Input {...p} value={supplier} onChange={(e) => setSupplier(e.target.value)} />}
            </Field>
          )}
          <Field label="Observações" className="sm:col-span-2">
            {(p) => <Textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </form>
      )}
    </DialogContent>
  );
}
