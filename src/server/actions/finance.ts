"use server";

import type {
  CategoryInput,
  ExpenseInput,
  IncomeInput,
  OpeningBalanceInput,
  PaymentMethodInput,
  ReverseTransactionInput,
  ReverseWithdrawalInput,
  SettingsInput,
  WithdrawalInput,
} from "@/lib/validation/finance";
import { requireActor } from "@/server/auth/guard";
import { num } from "@/server/money";
import { getAccountBalance, getDefaultCashAccount, resolveCashAccount } from "@/server/services/cash";
import {
  listCashAccounts,
  listCategories,
  listPaymentMethods,
  registerExpense,
  registerIncome,
  reverseTransaction,
  saveCategory,
  savePaymentMethod,
  setOpeningBalance,
} from "@/server/services/finance";
import { getSettings, updateSettings } from "@/server/services/settings";
import { registerWithdrawal, reverseWithdrawal } from "@/server/services/withdrawals";
import { prisma } from "@/server/db";
import { runAction } from "./run";

/** Opções dos formulários financeiros + saldo atual (para a confirmação da retirada). */
export async function getFinanceFormOptionsAction() {
  await requireActor("finance.read");
  const [categories, paymentMethods, accounts, settings, defaultAccount] = await Promise.all([
    listCategories(),
    listPaymentMethods(),
    listCashAccounts(),
    getSettings(),
    getDefaultCashAccount(),
  ]);
  const balances = await Promise.all(
    accounts
      .filter((a) => a.active)
      .map(async (a) => ({ id: a.id, balance: num(await getAccountBalance(prisma, a.id)) })),
  );
  return {
    categories,
    paymentMethods,
    accounts: accounts
      .filter((a) => a.active)
      .map((a) => ({ ...a, balance: balances.find((b) => b.id === a.id)?.balance ?? 0 })),
    defaultAccountId: defaultAccount.id,
    allowNegativeBalance: settings.allowNegativeBalance,
    timezone: settings.timezone,
  };
}

export async function getAccountBalanceAction(cashAccountId?: string) {
  await requireActor("finance.read");
  const account = await resolveCashAccount(prisma, cashAccountId);
  return { id: account.id, name: account.name, balance: num(await getAccountBalance(prisma, account.id)) };
}

export async function registerWithdrawalAction(input: WithdrawalInput) {
  return runAction(
    "withdrawals.write",
    async (actor) => {
      const w = await registerWithdrawal(actor, input);
      return { id: w.id, balanceAfter: num(w.balanceAfter) };
    },
    { message: "Retirada registrada." },
  );
}

export async function reverseWithdrawalAction(input: ReverseWithdrawalInput) {
  return runAction(
    "finance.reverse",
    async (actor) => {
      await reverseWithdrawal(actor, input);
      return undefined;
    },
    { message: "Retirada estornada." },
  );
}

export async function registerExpenseAction(input: ExpenseInput) {
  return runAction(
    "finance.write",
    async (actor) => {
      const e = await registerExpense(actor, input);
      return { id: e.id };
    },
    { message: "Despesa registrada." },
  );
}

export async function registerIncomeAction(input: IncomeInput) {
  return runAction(
    "finance.write",
    async (actor) => {
      const t = await registerIncome(actor, input);
      return { id: t.id };
    },
    { message: "Entrada registrada." },
  );
}

export async function reverseTransactionAction(input: ReverseTransactionInput) {
  return runAction(
    "finance.reverse",
    async (actor) => {
      await reverseTransaction(actor, input);
      return undefined;
    },
    { message: "Lançamento estornado." },
  );
}

export async function setOpeningBalanceAction(input: OpeningBalanceInput) {
  return runAction(
    "settings.write",
    async (actor) => {
      await setOpeningBalance(actor, input);
      return undefined;
    },
    { message: "Saldo inicial atualizado." },
  );
}

export async function saveCategoryAction(input: CategoryInput) {
  return runAction(
    "settings.write",
    async (actor) => {
      const c = await saveCategory(actor, input);
      return { id: c.id };
    },
    { message: "Categoria salva." },
  );
}

export async function savePaymentMethodAction(input: PaymentMethodInput) {
  return runAction(
    "settings.write",
    async (actor) => {
      const m = await savePaymentMethod(actor, input);
      return { id: m.id };
    },
    { message: "Forma de pagamento salva." },
  );
}

export async function updateSettingsAction(input: SettingsInput) {
  return runAction(
    "settings.write",
    async (actor) => {
      await updateSettings(actor, input);
      return undefined;
    },
    { message: "Configurações salvas." },
  );
}
