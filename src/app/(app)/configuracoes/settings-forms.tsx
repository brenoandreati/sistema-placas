"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { firstError, useServerAction } from "@/components/forms/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { PERIOD_LABELS } from "@/lib/dates";
import { formatBRL, numberToCents } from "@/lib/format";
import { TIMEZONES } from "@/lib/validation/finance";
import { changePasswordAction } from "@/server/actions/auth";
import {
  saveCategoryAction,
  savePaymentMethodAction,
  setOpeningBalanceAction,
  updateSettingsAction,
} from "@/server/actions/finance";

// ───────────────────────── Negócio e preferências ─────────────────────────

export interface SettingsFormProps {
  businessName: string;
  displayName: string;
  currency: string;
  timezone: string;
  defaultSalePrice: number | null;
  defaultMinStock: number;
  defaultDueDays: number;
  recentWithdrawalDays: number;
  dashboardDefaultPeriod: string;
  pageSize: number;
  allowNegativeBalance: boolean;
}

export function SettingsForm({ initial }: { initial: SettingsFormProps }) {
  const [form, setForm] = useState({
    ...initial,
    defaultSalePriceCents: initial.defaultSalePrice === null ? null : numberToCents(initial.defaultSalePrice),
  });
  const { run, pending, fieldErrors } = useServerAction(updateSettingsAction);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        run({
          businessName: form.businessName,
          displayName: form.displayName,
          timezone: form.timezone,
          defaultSalePriceCents: form.defaultSalePriceCents,
          defaultMinStock: form.defaultMinStock,
          defaultDueDays: form.defaultDueDays,
          recentWithdrawalDays: form.recentWithdrawalDays,
          dashboardDefaultPeriod: form.dashboardDefaultPeriod,
          pageSize: form.pageSize,
          allowNegativeBalance: form.allowNegativeBalance,
        });
      }}
    >
      <section className="grid gap-4 sm:grid-cols-2">
        <h3 className="text-[13px] font-semibold text-ink sm:col-span-2">Negócio</h3>
        <Field label="Nome do negócio" required error={firstError(fieldErrors, "businessName")}>
          {(p) => <Input {...p} value={form.businessName} onChange={(e) => set("businessName", e.target.value)} />}
        </Field>
        <Field label="Nome exibido no painel" required error={firstError(fieldErrors, "displayName")}>
          {(p) => (
            <Input
              {...p}
              value={form.displayName}
              maxLength={60}
              onChange={(e) => set("displayName", e.target.value)}
            />
          )}
        </Field>
        <Field label="Moeda" hint="Valores são registrados em reais.">
          {(p) => <Input {...p} value="Real brasileiro (R$ · BRL)" disabled />}
        </Field>
        <Field
          label="Fuso horário"
          error={firstError(fieldErrors, "timezone")}
          hint="Define o que é “hoje” e o início de cada mês nos filtros."
        >
          {(p) => (
            <Select {...p} value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {TIMEZONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </section>

      <section className="grid gap-4 border-t border-line pt-6 sm:grid-cols-2">
        <h3 className="text-[13px] font-semibold text-ink sm:col-span-2">Padrões de produtos e vendas</h3>
        <Field label="Preço padrão para novos produtos" hint="O preço de cada produto é definido no Estoque.">
          {(p) => (
            <MoneyInput
              {...p}
              value={form.defaultSalePriceCents}
              onValueChange={(v) => set("defaultSalePriceCents", v)}
            />
          )}
        </Field>
        <Field label="Estoque mínimo padrão" error={firstError(fieldErrors, "defaultMinStock")}>
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              value={form.defaultMinStock}
              onChange={(e) => set("defaultMinStock", Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
            />
          )}
        </Field>
        <Field
          label="Prazo padrão de vencimento (dias)"
          error={firstError(fieldErrors, "defaultDueDays")}
          hint="Para vendas não pagas no ato."
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              max={365}
              value={form.defaultDueDays}
              onChange={(e) => set("defaultDueDays", Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
            />
          )}
        </Field>
      </section>

      <section className="grid gap-4 border-t border-line pt-6 sm:grid-cols-2">
        <h3 className="text-[13px] font-semibold text-ink sm:col-span-2">Preferências de exibição e alertas</h3>
        <Field label="Período padrão do dashboard">
          {(p) => (
            <Select
              {...p}
              value={form.dashboardDefaultPeriod}
              onChange={(e) => set("dashboardDefaultPeriod", e.target.value)}
            >
              {(["today", "7d", "30d", "month", "year"] as const).map((k) => (
                <option key={k} value={k}>
                  {PERIOD_LABELS[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Itens por página nas tabelas">
          {(p) => (
            <Select {...p} value={form.pageSize} onChange={(e) => set("pageSize", Number(e.target.value))}>
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Alertar retiradas dos últimos (dias)" error={firstError(fieldErrors, "recentWithdrawalDays")}>
          {(p) => (
            <Input
              {...p}
              type="number"
              min={1}
              max={90}
              value={form.recentWithdrawalDays}
              onChange={(e) => set("recentWithdrawalDays", Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Checkbox
            label="Permitir retiradas que deixem o saldo negativo"
            description="Desativado por padrão. Quando ativo, cada retirada acima do saldo exige justificativa registrada na auditoria."
            checked={form.allowNegativeBalance}
            onChange={(e) => set("allowNegativeBalance", e.target.checked)}
          />
        </div>
      </section>

      <div className="flex justify-end border-t border-line pt-5">
        <Button type="submit" loading={pending}>
          Salvar configurações
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────── Saldo inicial ─────────────────────────

export function OpeningBalanceForm({
  account,
  today,
}: {
  account: { id: string; name: string; openingBalance: number; openingBalanceDate: string | null };
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(numberToCents(account.openingBalance));
  const [date, setDate] = useState(account.openingBalanceDate ?? today);
  const [reason, setReason] = useState("");
  const { run, pending, fieldErrors } = useServerAction(setOpeningBalanceAction);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Pencil /> Alterar saldo inicial
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Alterar saldo inicial"
          description={`${account.name} · atual ${formatBRL(account.openingBalance)}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                loading={pending}
                disabled={amount === null || reason.trim().length < 5}
                onClick={() =>
                  run(
                    { cashAccountId: account.id, amountCents: amount ?? 0, date, reason },
                    {
                      onSuccess: () => {
                        setOpen(false);
                        setReason("");
                      },
                    },
                  )
                }
              >
                Salvar alteração
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
              Alterar o saldo inicial muda o saldo disponível atual e todos os saldos acumulados. A alteração fica
              registrada com valor anterior, novo valor e motivo.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Novo saldo inicial" required error={firstError(fieldErrors, "amountCents")}>
                {(p) => <MoneyInput {...p} allowNegative value={amount} onValueChange={setAmount} />}
              </Field>
              <Field label="Data de referência" required error={firstError(fieldErrors, "date")}>
                {(p) => <Input {...p} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />}
              </Field>
            </div>
            <Field label="Motivo" required error={firstError(fieldErrors, "reason")}>
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex.: saldo informado na implantação estava errado"
                />
              )}
            </Field>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ───────────────────────── Categorias ─────────────────────────

const GROUP_OPTIONS = [
  { value: "EXPENSE", label: "Despesa" },
  { value: "WITHDRAWAL", label: "Retirada" },
  { value: "CAPITAL_CONTRIBUTION", label: "Aporte de capital" },
  { value: "OTHER_INCOME", label: "Outra entrada" },
] as const;

const KIND_OPTIONS = [
  { value: "OWNER_DRAW", label: "Retirada pessoal" },
  { value: "PROFIT_DISTRIBUTION", label: "Distribuição de lucros" },
  { value: "REIMBURSEMENT", label: "Reembolso" },
  { value: "OTHER", label: "Outra" },
] as const;

export interface CategoryRow {
  id: string;
  name: string;
  group: string;
  isDirectCost: boolean;
  withdrawalKind: string | null;
  isSystem: boolean;
  active: boolean;
}

export function CategoryEditor({ category }: { category?: CategoryRow }) {
  const [open, setOpen] = useState(false);
  const init = () => ({
    name: category?.name ?? "",
    group: (category?.group as (typeof GROUP_OPTIONS)[number]["value"]) ?? "EXPENSE",
    isDirectCost: category?.isDirectCost ?? false,
    withdrawalKind: (category?.withdrawalKind as (typeof KIND_OPTIONS)[number]["value"] | null) ?? "OTHER",
    active: category?.active ?? true,
  });
  const [form, setForm] = useState(init);
  const { run, pending, fieldErrors } = useServerAction(saveCategoryAction);
  return (
    <>
      {category ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setForm(init());
            setOpen(true);
          }}
          aria-label={`Editar ${category.name}`}
        >
          <Pencil />
        </Button>
      ) : (
        <Button
          variant="secondary"
          onClick={() => {
            setForm(init());
            setOpen(true);
          }}
        >
          <Plus /> Nova categoria
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          size="sm"
          title={category ? "Editar categoria" : "Nova categoria"}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                loading={pending}
                onClick={() =>
                  run(
                    {
                      categoryId: category?.id,
                      name: form.name,
                      group: form.group,
                      isDirectCost: form.isDirectCost,
                      withdrawalKind: form.group === "WITHDRAWAL" ? form.withdrawalKind : null,
                      active: form.active,
                    },
                    { onSuccess: () => setOpen(false) },
                  )
                }
              >
                Salvar categoria
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            <Field label="Nome" required error={firstError(fieldErrors, "name")}>
              {(p) => (
                <Input
                  {...p}
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              )}
            </Field>
            <Field label="Grupo" error={firstError(fieldErrors, "group")}>
              {(p) => (
                <Select
                  {...p}
                  value={form.group}
                  onChange={(e) => setForm({ ...form, group: e.target.value as typeof form.group })}
                >
                  {GROUP_OPTIONS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {form.group === "EXPENSE" && (
              <Checkbox
                label="Custo diretamente atribuído às vendas"
                description="Entra no cálculo do lucro estimado (ex.: frete, embalagens, taxas)."
                checked={form.isDirectCost}
                onChange={(e) => setForm({ ...form, isDirectCost: e.target.checked })}
              />
            )}
            {form.group === "WITHDRAWAL" && (
              <Field label="Natureza da retirada">
                {(p) => (
                  <Select
                    {...p}
                    value={form.withdrawalKind ?? "OTHER"}
                    onChange={(e) => setForm({ ...form, withdrawalKind: e.target.value as typeof form.withdrawalKind })}
                  >
                    {KIND_OPTIONS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {category && (
              <Checkbox
                label="Categoria ativa"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function GroupBadge({ group }: { group: string }) {
  const labels: Record<string, string> = {
    SALES_RECEIPT: "Recebimento",
    SALES_REFUND: "Estorno",
    STOCK_PURCHASE: "Compra de estoque",
    EXPENSE: "Despesa",
    WITHDRAWAL: "Retirada",
    CAPITAL_CONTRIBUTION: "Aporte",
    OTHER_INCOME: "Outra entrada",
  };
  return <Badge tone="neutral">{labels[group] ?? group}</Badge>;
}

// ───────────────────────── Formas de pagamento ─────────────────────────

const METHOD_KINDS = [
  { value: "PIX", label: "PIX" },
  { value: "CASH", label: "Dinheiro" },
  { value: "CARD", label: "Cartão" },
  { value: "BANK_TRANSFER", label: "Transferência" },
  { value: "OTHER", label: "Outro" },
] as const;

export function PaymentMethodEditor({
  method,
}: {
  method?: { id: string; name: string; kind: string; active: boolean };
}) {
  const [open, setOpen] = useState(false);
  const init = () => ({
    name: method?.name ?? "",
    kind: (method?.kind as (typeof METHOD_KINDS)[number]["value"]) ?? "OTHER",
    active: method?.active ?? true,
  });
  const [form, setForm] = useState(init);
  const { run, pending, fieldErrors } = useServerAction(savePaymentMethodAction);
  return (
    <>
      {method ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setForm(init());
            setOpen(true);
          }}
          aria-label={`Editar ${method.name}`}
        >
          <Pencil />
        </Button>
      ) : (
        <Button
          variant="secondary"
          onClick={() => {
            setForm(init());
            setOpen(true);
          }}
        >
          <Plus /> Nova forma de pagamento
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          size="sm"
          title={method ? "Editar forma de pagamento" : "Nova forma de pagamento"}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                loading={pending}
                onClick={() => run({ paymentMethodId: method?.id, ...form }, { onSuccess: () => setOpen(false) })}
              >
                Salvar
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            <Field label="Nome" required error={firstError(fieldErrors, "name")}>
              {(p) => (
                <Input
                  {...p}
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex.: Cartão de crédito (maquininha)"
                />
              )}
            </Field>
            <Field label="Tipo">
              {(p) => (
                <Select
                  {...p}
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}
                >
                  {METHOD_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {method && (
              <Checkbox
                label="Ativa"
                description="Inativas não aparecem nos formulários, mas o histórico é mantido."
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ───────────────────────── Senha ─────────────────────────

export function ChangePasswordForm() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const { run, pending, fieldErrors } = useServerAction(changePasswordAction);
  return (
    <form
      className="grid max-w-md gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(form, { onSuccess: () => setForm({ currentPassword: "", newPassword: "", confirmPassword: "" }) });
      }}
    >
      <Field label="Senha atual" required error={firstError(fieldErrors, "currentPassword")}>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
          />
        )}
      </Field>
      <Field
        label="Nova senha"
        required
        error={firstError(fieldErrors, "newPassword")}
        hint="Ao menos 10 caracteres, com letras e números."
      >
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            value={form.newPassword}
            onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
          />
        )}
      </Field>
      <Field label="Confirme a nova senha" required error={firstError(fieldErrors, "confirmPassword")}>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
          />
        )}
      </Field>
      <div>
        <Button type="submit" loading={pending}>
          Alterar senha
        </Button>
      </div>
    </form>
  );
}
