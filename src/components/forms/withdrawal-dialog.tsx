"use client";

import { ArrowLeft, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { cn } from "@/lib/cn";
import { DEFAULT_TIMEZONE, toLocalDateTimeInput, todayString } from "@/lib/dates";
import { formatBRL, formatCents } from "@/lib/format";
import { getFinanceFormOptionsAction, registerWithdrawalAction } from "@/server/actions/finance";
import { firstError, useIdempotencyKey, useServerAction } from "./use-action";

type Options = Awaited<ReturnType<typeof getFinanceFormOptionsAction>>;

type WithdrawalDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

export function WithdrawalDialog(props: WithdrawalDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <WithdrawalDialogBody {...props} />}
    </Dialog>
  );
}

function WithdrawalDialogBody({ onOpenChange }: WithdrawalDialogProps) {
  const [options, setOptions] = useState<Options | null>(null);
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [amount, setAmount] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [withdrawnAt, setWithdrawnAt] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [justification, setJustification] = useState("");
  const [key, renewKey] = useIdempotencyKey();
  const { run, pending, fieldErrors, clear } = useServerAction(registerWithdrawalAction);

  useEffect(() => {
    getFinanceFormOptionsAction().then((data) => {
      setOptions(data);
      setCategoryId(data.categories.find((c) => c.group === "WITHDRAWAL")?.id ?? "");
      setPaymentMethodId(data.paymentMethods[0]?.id ?? "");
      setCashAccountId(data.defaultAccountId);
      setWithdrawnAt(toLocalDateTimeInput(new Date(), data.timezone));
    });
  }, []);

  const account = options?.accounts.find((a) => a.id === cashAccountId);
  const balanceCents = account ? Math.round(account.balance * 100) : 0;
  const remaining = balanceCents - (amount ?? 0);
  const tz = options?.timezone ?? DEFAULT_TIMEZONE;
  const category = options?.categories.find((c) => c.id === categoryId);

  function goToConfirm(e: React.FormEvent) {
    e.preventDefault();
    clear();
    if (!amount || amount <= 0 || !description.trim()) return;
    setStep("confirm");
  }

  function confirm() {
    run(
      {
        amountCents: amount ?? 0,
        withdrawnAt,
        paymentMethodId,
        categoryId,
        description,
        notes,
        cashAccountId,
        negativeBalanceJustification: remaining < 0 ? justification : undefined,
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

  const blocked = remaining < 0 && !options?.allowNegativeBalance;

  return (
    <DialogContent
      title={step === "form" ? "Retirada de dinheiro" : "Confirme a retirada"}
      description={
        step === "form"
          ? "Retiradas reduzem o saldo do caixa, mas não alteram o faturamento nem as despesas."
          : "Confira os valores antes de registrar."
      }
      footer={
        step === "form" ? (
          <>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="withdrawal-form" disabled={!options || !amount || !description.trim()}>
              Continuar
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="secondary" onClick={() => setStep("form")}>
              <ArrowLeft /> Voltar
            </Button>
            <Button
              type="button"
              variant={remaining < 0 ? "danger" : "primary"}
              onClick={confirm}
              loading={pending}
              disabled={blocked || (remaining < 0 && justification.trim().length < 5)}
            >
              Confirmar retirada de {formatCents(amount ?? 0)}
            </Button>
          </>
        )
      }
    >
      {!options ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted">
          <Spinner /> Carregando…
        </div>
      ) : step === "form" ? (
        <form id="withdrawal-form" onSubmit={goToConfirm} className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Valor da retirada"
            required
            error={firstError(fieldErrors, "amountCents")}
            hint={account ? `Saldo disponível: ${formatBRL(account.balance)}` : undefined}
          >
            {(p) => <MoneyInput {...p} autoFocus value={amount} onValueChange={setAmount} />}
          </Field>
          <Field label="Data" required error={firstError(fieldErrors, "withdrawnAt")}>
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                value={withdrawnAt}
                max={`${todayString(tz)}T23:59`}
                onChange={(e) => setWithdrawnAt(e.target.value)}
              />
            )}
          </Field>
          <Field label="Categoria" required error={firstError(fieldErrors, "categoryId")}>
            {(p) => (
              <Select {...p} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {options.categories
                  .filter((c) => c.group === "WITHDRAWAL")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Forma de retirada" required error={firstError(fieldErrors, "paymentMethodId")}>
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
          <Field label="Descrição" required className="sm:col-span-2" error={firstError(fieldErrors, "description")}>
            {(p) => (
              <Input
                {...p}
                value={description}
                placeholder="Ex.: Pró-labore de outubro"
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            {(p) => <Textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="overflow-hidden rounded-xl border border-line">
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-sm text-ink-2">
                Saldo atual{options.accounts.length > 1 ? ` (${account?.name})` : ""}
              </dt>
              <dd className="tabular font-medium">{formatCents(balanceCents)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-line px-4 py-3">
              <dt className="text-sm text-ink-2">Retirada · {category?.name}</dt>
              <dd className="tabular font-medium text-negative">− {formatCents(amount ?? 0)}</dd>
            </div>
            <div
              className={cn(
                "flex items-center justify-between border-t border-line px-4 py-3.5",
                remaining < 0 ? "bg-negative-soft" : "bg-surface-2",
              )}
            >
              <dt className="text-sm font-medium text-ink">Saldo restante</dt>
              <dd className={cn("figure font-display text-xl font-semibold", remaining < 0 && "text-negative")}>
                {formatCents(remaining)}
              </dd>
            </div>
          </dl>
          {remaining < 0 && (
            <div className="flex gap-3 rounded-xl border border-negative/25 bg-negative-soft p-3.5 text-sm text-negative">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {blocked ? (
                <p>
                  O valor é maior que o saldo disponível. Reduza a retirada ou, se o caixa recebeu dinheiro não
                  registrado, lance a entrada antes.
                </p>
              ) : (
                <p>
                  A retirada deixará o saldo negativo. Informe a justificativa abaixo — ela fica registrada na
                  auditoria.
                </p>
              )}
            </div>
          )}
          {remaining < 0 && !blocked && (
            <Field
              label="Justificativa do saldo negativo"
              required
              error={firstError(fieldErrors, "negativeBalanceJustification")}
            >
              {(p) => (
                <Textarea {...p} rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} />
              )}
            </Field>
          )}
          <p className="text-[13px] text-muted">
            {description}
            {withdrawnAt
              ? ` · ${withdrawnAt.slice(8, 10)}/${withdrawnAt.slice(5, 7)}/${withdrawnAt.slice(0, 4)} ${withdrawnAt.slice(11, 16)}`
              : ""}
          </p>
        </div>
      )}
    </DialogContent>
  );
}
