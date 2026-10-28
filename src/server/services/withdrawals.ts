import "server-only";
import type { Prisma, Withdrawal } from "@/generated/prisma/client";
import { startOfLocalDay, todayString } from "@/lib/dates";
import { formatBRL, formatRecordNumber } from "@/lib/format";
import {
  reverseWithdrawalSchema,
  withdrawalSchema,
  type ReverseWithdrawalInput,
  type WithdrawalInput,
} from "@/lib/validation/finance";
import type { Actor } from "@/server/context";
import { prisma, type Tx } from "@/server/db";
import { DomainError, NotFoundError } from "@/server/errors";
import { parseBusinessDateTime, runIdempotent } from "@/server/guards";
import { dec, fromCents, num } from "@/server/money";
import { pageArgs, paginated, type PageParams, type Paginated } from "@/server/pagination";
import { audit } from "./audit";
import { getAccountBalance, getActivePaymentMethod, lockCashAccount, resolveCashAccount } from "./cash";
import { getSettings } from "./settings";

/**
 * Registra uma retirada: reduz o saldo de caixa, mas não altera faturamento nem despesas operacionais.
 * Não permite saldo negativo, salvo se a configuração permitir e houver justificativa.
 */
export async function registerWithdrawal(actor: Actor, input: WithdrawalInput): Promise<Withdrawal> {
  const data = withdrawalSchema.parse(input);
  const findExisting = () =>
    data.idempotencyKey
      ? prisma.withdrawal.findUnique({ where: { idempotencyKey: data.idempotencyKey } })
      : Promise.resolve(null);
  return runIdempotent(
    data.idempotencyKey,
    () =>
      prisma.$transaction(async (tx) => {
        if (data.idempotencyKey) {
          const existing = await tx.withdrawal.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
          if (existing) return existing;
        }
        const settings = await getSettings(tx);
        const withdrawnAt = parseBusinessDateTime(
          data.withdrawnAt,
          settings.timezone,
          "a data da retirada",
          "withdrawnAt",
        );
        const category = await tx.financialCategory.findUnique({ where: { id: data.categoryId } });
        if (!category || category.group !== "WITHDRAWAL" || !category.active) {
          throw new DomainError("Categoria de retirada inválida.", "INVALID_CATEGORY", "categoryId");
        }
        const method = await getActivePaymentMethod(tx, data.paymentMethodId);
        const account = await resolveCashAccount(tx, data.cashAccountId);

        await lockCashAccount(tx, account.id);
        const balanceBefore = await getAccountBalance(tx, account.id);
        const amount = fromCents(data.amountCents);
        const balanceAfter = balanceBefore.sub(amount);
        if (balanceAfter.lessThan(0)) {
          if (!settings.allowNegativeBalance) {
            throw new DomainError(
              `Saldo insuficiente em ${account.name}: disponível ${formatBRL(num(balanceBefore))}, retirada de ${formatBRL(num(amount))}.`,
              "INSUFFICIENT_BALANCE",
              "amountCents",
            );
          }
          if (!data.negativeBalanceJustification) {
            throw new DomainError(
              "A retirada deixará o saldo negativo. Informe a justificativa para continuar.",
              "NEGATIVE_BALANCE_JUSTIFICATION_REQUIRED",
              "negativeBalanceJustification",
            );
          }
        }

        const withdrawal = await tx.withdrawal.create({
          data: {
            cashAccountId: account.id,
            categoryId: category.id,
            amount: amount.toFixed(2),
            paymentMethodId: method.id,
            withdrawnAt,
            description: data.description,
            notes: data.notes ?? null,
            balanceBefore: balanceBefore.toFixed(2),
            balanceAfter: balanceAfter.toFixed(2),
            negativeBalanceJustification: balanceAfter.lessThan(0) ? (data.negativeBalanceJustification ?? null) : null,
            idempotencyKey: data.idempotencyKey ?? null,
            createdById: actor.userId,
          },
        });
        await tx.financialTransaction.create({
          data: {
            cashAccountId: account.id,
            direction: "OUT",
            amount: amount.toFixed(2),
            categoryId: category.id,
            origin: "WITHDRAWAL",
            description: `${category.name}: ${data.description}`,
            paymentMethodId: method.id,
            occurredAt: withdrawnAt,
            notes: data.notes ?? null,
            withdrawalId: withdrawal.id,
            createdById: actor.userId,
          },
        });
        await audit(tx, actor, {
          action: "withdrawal.create",
          entityType: "withdrawal",
          entityId: withdrawal.id,
          summary: `Retirada ${formatRecordNumber("RET", withdrawal.number)} (${category.name})`,
          reason: withdrawal.negativeBalanceJustification,
          after: {
            amount: amount.toNumber(),
            balanceBefore: balanceBefore.toNumber(),
            balanceAfter: balanceAfter.toNumber(),
            category: category.name,
          },
          metadata: { amount: amount.toNumber(), withdrawalId: withdrawal.id },
        });
        return withdrawal;
      }),
    findExisting,
  );
}

/** Estorno auditável de uma retirada lançada incorretamente: gera entrada compensatória. */
export async function reverseWithdrawal(actor: Actor, input: ReverseWithdrawalInput) {
  const data = reverseWithdrawalSchema.parse(input);
  return prisma.$transaction(async (tx) => reverseWithdrawalTx(tx, actor, data.withdrawalId, data.reason));
}

export async function reverseWithdrawalTx(tx: Tx, actor: Actor, withdrawalId: string, reason: string) {
  await tx.$queryRaw`SELECT id FROM withdrawals WHERE id = ${withdrawalId}::uuid FOR UPDATE`;
  const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) throw new NotFoundError("Retirada não encontrada.");
  if (withdrawal.status === "REVERSED") throw new DomainError("Esta retirada já foi estornada.", "ALREADY_REVERSED");
  const original = await tx.financialTransaction.findFirst({ where: { withdrawalId, origin: "WITHDRAWAL" } });
  if (!original) throw new DomainError("Lançamento financeiro da retirada não encontrado.", "MISSING_TRANSACTION");

  await tx.financialTransaction.create({
    data: {
      cashAccountId: original.cashAccountId,
      direction: "IN",
      amount: original.amount,
      categoryId: original.categoryId,
      origin: "REVERSAL",
      description: `Estorno da retirada ${formatRecordNumber("RET", withdrawal.number)}`,
      paymentMethodId: original.paymentMethodId,
      occurredAt: new Date(),
      withdrawalId,
      reversalOfId: original.id,
      reversalReason: reason,
      createdById: actor.userId,
    },
  });
  const updated = await tx.withdrawal.update({
    where: { id: withdrawalId },
    data: { status: "REVERSED", reversedAt: new Date(), reversalReason: reason, reversedById: actor.userId },
  });
  await audit(tx, actor, {
    action: "withdrawal.reverse",
    entityType: "withdrawal",
    entityId: withdrawalId,
    summary: `Retirada ${formatRecordNumber("RET", withdrawal.number)} estornada`,
    reason,
    before: { status: "ACTIVE" },
    after: { status: "REVERSED" },
    metadata: { amount: num(withdrawal.amount), withdrawalId },
  });
  return updated;
}

// ───────────────────────── Consultas ─────────────────────────

export interface WithdrawalView {
  id: string;
  number: number;
  amount: number;
  withdrawnAt: string;
  category: string;
  categoryId: string;
  withdrawalKind: string | null;
  paymentMethod: string;
  description: string;
  notes: string | null;
  balanceBefore: number;
  balanceAfter: number;
  negativeBalanceJustification: string | null;
  status: "ACTIVE" | "REVERSED";
  reversedAt: string | null;
  reversalReason: string | null;
  cashAccount: string;
  createdAt: string;
  createdBy: string | null;
  reversedBy: string | null;
}

export interface WithdrawalFilters extends PageParams {
  from?: Date;
  to?: Date;
  categoryId?: string;
  status?: "ACTIVE" | "REVERSED";
}

export async function listWithdrawals(filters: WithdrawalFilters): Promise<Paginated<WithdrawalView>> {
  const { page, pageSize, skip, take } = pageArgs(filters);
  const where: Prisma.WithdrawalWhereInput = {
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.from || filters.to
      ? { withdrawnAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lt: filters.to } : {}) } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.withdrawal.findMany({
      where,
      orderBy: [{ withdrawnAt: "desc" }, { number: "desc" }],
      skip,
      take,
      include: {
        category: { select: { name: true, withdrawalKind: true } },
        paymentMethod: { select: { name: true } },
        cashAccount: { select: { name: true } },
      },
    }),
    prisma.withdrawal.count({ where }),
  ]);
  const userIds = [...new Set(rows.flatMap((r) => [r.createdById, r.reversedById].filter(Boolean) as string[]))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const userName = new Map(users.map((u) => [u.id, u.name]));
  return paginated(
    rows.map((w) => ({
      id: w.id,
      number: w.number,
      amount: num(w.amount),
      withdrawnAt: w.withdrawnAt.toISOString(),
      category: w.category.name,
      categoryId: w.categoryId,
      withdrawalKind: w.category.withdrawalKind,
      paymentMethod: w.paymentMethod.name,
      description: w.description,
      notes: w.notes,
      balanceBefore: num(w.balanceBefore),
      balanceAfter: num(w.balanceAfter),
      negativeBalanceJustification: w.negativeBalanceJustification,
      status: w.status,
      reversedAt: w.reversedAt?.toISOString() ?? null,
      reversalReason: w.reversalReason,
      cashAccount: w.cashAccount.name,
      createdAt: w.createdAt.toISOString(),
      createdBy: userName.get(w.createdById) ?? null,
      reversedBy: w.reversedById ? (userName.get(w.reversedById) ?? null) : null,
    })),
    total,
    page,
    pageSize,
  );
}

export interface WithdrawalSummary {
  month: number;
  year: number;
  allTime: number;
  last: { amount: number; withdrawnAt: string; category: string } | null;
  byKind: { kind: string; amount: number }[];
}

/** Totais de retiradas ativas (estornadas não contam). */
export async function getWithdrawalSummary(tz: string): Promise<WithdrawalSummary> {
  const today = todayString(tz);
  const monthStart = startOfLocalDay(`${today.slice(0, 7)}-01`, tz);
  const yearStart = startOfLocalDay(`${today.slice(0, 4)}-01-01`, tz);
  const active = { status: "ACTIVE" as const };
  const [month, year, allTime, last, byCategory] = await Promise.all([
    prisma.withdrawal.aggregate({ where: { ...active, withdrawnAt: { gte: monthStart } }, _sum: { amount: true } }),
    prisma.withdrawal.aggregate({ where: { ...active, withdrawnAt: { gte: yearStart } }, _sum: { amount: true } }),
    prisma.withdrawal.aggregate({ where: active, _sum: { amount: true } }),
    prisma.withdrawal.findFirst({
      where: active,
      orderBy: [{ withdrawnAt: "desc" }, { number: "desc" }],
      include: { category: { select: { name: true } } },
    }),
    prisma.withdrawal.groupBy({ by: ["categoryId"], where: active, _sum: { amount: true } }),
  ]);
  const categories = await prisma.financialCategory.findMany({
    where: { id: { in: byCategory.map((c) => c.categoryId) } },
    select: { id: true, withdrawalKind: true },
  });
  const kindById = new Map(categories.map((c) => [c.id, c.withdrawalKind ?? "OTHER"]));
  const byKind = new Map<string, ReturnType<typeof dec>>();
  for (const row of byCategory) {
    const kind = kindById.get(row.categoryId) ?? "OTHER";
    byKind.set(kind, (byKind.get(kind) ?? dec(0)).add(dec(row._sum.amount)));
  }
  return {
    month: num(month._sum.amount),
    year: num(year._sum.amount),
    allTime: num(allTime._sum.amount),
    last: last
      ? { amount: num(last.amount), withdrawnAt: last.withdrawnAt.toISOString(), category: last.category.name }
      : null,
    byKind: [...byKind.entries()].map(([kind, amount]) => ({ kind, amount: num(amount) })),
  };
}
