import "server-only";
import type { CashAccount, FinancialCategory } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/server/db";
import { DomainError, NotFoundError } from "@/server/errors";
import { dec, type Dec } from "@/server/money";

export async function getDefaultCashAccount(db: Tx = prisma): Promise<CashAccount> {
  const account =
    (await db.cashAccount.findFirst({ where: { isDefault: true, active: true } })) ??
    (await db.cashAccount.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } }));
  if (!account) {
    throw new DomainError("Nenhuma conta de caixa ativa. Cadastre uma em Configurações.", "NO_CASH_ACCOUNT");
  }
  return account;
}

export async function resolveCashAccount(db: Tx, cashAccountId?: string | null): Promise<CashAccount> {
  if (!cashAccountId) return getDefaultCashAccount(db);
  const account = await db.cashAccount.findUnique({ where: { id: cashAccountId } });
  if (!account || !account.active) throw new NotFoundError("Conta de caixa não encontrada ou inativa.");
  return account;
}

/**
 * Bloqueia a conta de caixa até o fim da transação. Serializa operações que dependem
 * do saldo (retiradas, estornos) e impede que duas retiradas simultâneas excedam o saldo.
 */
export async function lockCashAccount(tx: Tx, cashAccountId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM cash_accounts WHERE id = ${cashAccountId}::uuid FOR UPDATE`;
}

/** Saldo = saldo inicial + entradas confirmadas − saídas confirmadas. */
export async function getAccountBalance(db: Tx, cashAccountId: string): Promise<Dec> {
  const account = await db.cashAccount.findUnique({
    where: { id: cashAccountId },
    select: { openingBalance: true },
  });
  if (!account) throw new NotFoundError("Conta de caixa não encontrada.");
  const sums = await db.financialTransaction.groupBy({
    by: ["direction"],
    where: { cashAccountId },
    _sum: { amount: true },
  });
  const inflow = dec(sums.find((s) => s.direction === "IN")?._sum.amount);
  const outflow = dec(sums.find((s) => s.direction === "OUT")?._sum.amount);
  return dec(account.openingBalance).add(inflow).sub(outflow);
}

/** Saldo consolidado de todas as contas ativas. */
export async function getTotalBalance(db: Tx = prisma): Promise<Dec> {
  const accounts = await db.cashAccount.findMany({ where: { active: true }, select: { id: true, openingBalance: true } });
  if (accounts.length === 0) return dec(0);
  const ids = accounts.map((a) => a.id);
  const sums = await db.financialTransaction.groupBy({
    by: ["direction"],
    where: { cashAccountId: { in: ids } },
    _sum: { amount: true },
  });
  const opening = accounts.reduce((acc, a) => acc.add(dec(a.openingBalance)), dec(0));
  const inflow = dec(sums.find((s) => s.direction === "IN")?._sum.amount);
  const outflow = dec(sums.find((s) => s.direction === "OUT")?._sum.amount);
  return opening.add(inflow).sub(outflow);
}

export async function getSystemCategory(db: Tx, systemKey: string): Promise<FinancialCategory> {
  const category = await db.financialCategory.findUnique({ where: { systemKey } });
  if (!category) {
    throw new DomainError(
      `Categoria de sistema "${systemKey}" ausente. Execute o seed (npm run db:seed).`,
      "MISSING_SYSTEM_CATEGORY",
    );
  }
  return category;
}

export async function getActivePaymentMethod(db: Tx, paymentMethodId: string) {
  const method = await db.paymentMethod.findUnique({ where: { id: paymentMethodId } });
  if (!method || !method.active) throw new DomainError("Forma de pagamento inválida ou inativa.", "INVALID_PAYMENT_METHOD", "paymentMethodId");
  return method;
}
