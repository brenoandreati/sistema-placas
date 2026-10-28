import "server-only";
import { Prisma, type TransactionOrigin } from "@/generated/prisma/client";
import { dateOnlyToDb, dbDateToString } from "@/lib/dates";
import { formatBRL, formatRecordNumber } from "@/lib/format";
import {
  categorySchema,
  expenseSchema,
  incomeSchema,
  openingBalanceSchema,
  paymentMethodSchema,
  reverseTransactionSchema,
  type CategoryInput,
  type ExpenseInput,
  type IncomeInput,
  type OpeningBalanceInput,
  type PaymentMethodInput,
  type ReverseTransactionInput,
} from "@/lib/validation/finance";
import type { Actor } from "@/server/context";
import { prisma } from "@/server/db";
import { DomainError, NotFoundError, isUniqueViolation } from "@/server/errors";
import { parseBusinessDateTime, runIdempotent } from "@/server/guards";
import { dec, fromCents, num } from "@/server/money";
import { pageArgs, paginated, type PageParams, type Paginated } from "@/server/pagination";
import { audit } from "./audit";
import { getActivePaymentMethod, resolveCashAccount } from "./cash";
import { getSettings } from "./settings";
import { reverseWithdrawalTx } from "./withdrawals";

export const ORIGIN_LABELS: Record<TransactionOrigin, string> = {
  SALE_PAYMENT: "Recebimento de venda",
  SALE_REFUND: "Estorno de venda",
  STOCK_PURCHASE: "Compra de estoque",
  EXPENSE: "Despesa",
  WITHDRAWAL: "Retirada",
  CAPITAL_CONTRIBUTION: "Aporte de capital",
  OTHER_INCOME: "Outra entrada",
  REVERSAL: "Estorno de lançamento",
};

// ───────────────────────── Despesas ─────────────────────────

export async function registerExpense(actor: Actor, input: ExpenseInput) {
  const data = expenseSchema.parse(input);
  const findExisting = () =>
    data.idempotencyKey
      ? prisma.expense.findUnique({ where: { idempotencyKey: data.idempotencyKey } })
      : Promise.resolve(null);
  return runIdempotent(
    data.idempotencyKey,
    () =>
      prisma.$transaction(async (tx) => {
        if (data.idempotencyKey) {
          const existing = await tx.expense.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
          if (existing) return existing;
        }
        const settings = await getSettings(tx);
        const incurredAt = parseBusinessDateTime(data.incurredAt, settings.timezone, "a data da despesa", "incurredAt");
        const category = await tx.financialCategory.findUnique({ where: { id: data.categoryId } });
        if (!category || category.group !== "EXPENSE" || !category.active) {
          throw new DomainError("Categoria de despesa inválida.", "INVALID_CATEGORY", "categoryId");
        }
        const method = data.paymentMethodId ? await getActivePaymentMethod(tx, data.paymentMethodId) : null;
        const account = await resolveCashAccount(tx, data.cashAccountId);
        if (data.saleId) {
          const sale = await tx.sale.findUnique({ where: { id: data.saleId }, select: { id: true } });
          if (!sale) throw new NotFoundError("Venda vinculada não encontrada.");
        }
        const amount = fromCents(data.amountCents);
        const expense = await tx.expense.create({
          data: {
            cashAccountId: account.id,
            categoryId: category.id,
            amount: amount.toFixed(2),
            description: data.description,
            paymentMethodId: method?.id ?? null,
            incurredAt,
            supplier: data.supplier ?? null,
            notes: data.notes ?? null,
            saleId: data.saleId ?? null,
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
            origin: "EXPENSE",
            description: `${category.name}: ${data.description}`,
            paymentMethodId: method?.id ?? null,
            occurredAt: incurredAt,
            notes: data.notes ?? null,
            expenseId: expense.id,
            saleId: data.saleId ?? null,
            createdById: actor.userId,
          },
        });
        await audit(tx, actor, {
          action: "expense.create",
          entityType: "expense",
          entityId: expense.id,
          summary: `Despesa ${formatRecordNumber("DES", expense.number)}: ${category.name} — ${data.description}`,
          after: { amount: amount.toNumber(), category: category.name },
          metadata: { amount: amount.toNumber(), expenseId: expense.id },
        });
        return expense;
      }),
    findExisting,
  );
}

// ───────────────────────── Aportes e outras entradas ─────────────────────────

export async function registerIncome(actor: Actor, input: IncomeInput) {
  const data = incomeSchema.parse(input);
  const findExisting = () =>
    data.idempotencyKey
      ? prisma.financialTransaction.findUnique({ where: { idempotencyKey: data.idempotencyKey } })
      : Promise.resolve(null);
  return runIdempotent(
    data.idempotencyKey,
    () =>
      prisma.$transaction(async (tx) => {
        if (data.idempotencyKey) {
          const existing = await tx.financialTransaction.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
          if (existing) return existing;
        }
        const settings = await getSettings(tx);
        const occurredAt = parseBusinessDateTime(data.occurredAt, settings.timezone, "a data", "occurredAt");
        const category = await tx.financialCategory.findUnique({ where: { id: data.categoryId } });
        if (!category || category.group !== data.kind || !category.active) {
          throw new DomainError("Categoria inválida para este tipo de entrada.", "INVALID_CATEGORY", "categoryId");
        }
        const method = data.paymentMethodId ? await getActivePaymentMethod(tx, data.paymentMethodId) : null;
        const account = await resolveCashAccount(tx, data.cashAccountId);
        const amount = fromCents(data.amountCents);
        const transaction = await tx.financialTransaction.create({
          data: {
            cashAccountId: account.id,
            direction: "IN",
            amount: amount.toFixed(2),
            categoryId: category.id,
            origin: data.kind,
            description: data.description,
            paymentMethodId: method?.id ?? null,
            occurredAt,
            notes: data.notes ?? null,
            idempotencyKey: data.idempotencyKey ?? null,
            createdById: actor.userId,
          },
        });
        await audit(tx, actor, {
          action: data.kind === "CAPITAL_CONTRIBUTION" ? "finance.capital_contribution" : "finance.other_income",
          entityType: "financial_transaction",
          entityId: transaction.id,
          summary: `${ORIGIN_LABELS[data.kind]} ${formatRecordNumber("MOV", transaction.number)}: ${data.description}`,
          after: { amount: amount.toNumber(), category: category.name },
          metadata: { amount: amount.toNumber(), transactionId: transaction.id },
        });
        return transaction;
      }),
    findExisting,
  );
}

// ───────────────────────── Estornos de lançamentos ─────────────────────────

/**
 * Estorna um lançamento do livro-caixa com um movimento compensatório (o original permanece).
 * Recebimentos e estornos de vendas devem ser tratados pela venda para manter os saldos em sincronia.
 */
export async function reverseTransaction(actor: Actor, input: ReverseTransactionInput) {
  const data = reverseTransactionSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM financial_transactions WHERE id = ${data.transactionId}::uuid FOR UPDATE`;
    const original = await tx.financialTransaction.findUnique({
      where: { id: data.transactionId },
      include: { reversal: { select: { id: true } } },
    });
    if (!original) throw new NotFoundError("Lançamento não encontrado.");
    if (original.origin === "REVERSAL")
      throw new DomainError("Estornos não podem ser estornados.", "CANNOT_REVERSE_REVERSAL");
    if (original.reversal) throw new DomainError("Este lançamento já foi estornado.", "ALREADY_REVERSED");
    if (original.origin === "SALE_PAYMENT" || original.origin === "SALE_REFUND") {
      throw new DomainError(
        "Recebimentos de vendas são estornados pela própria venda (Vendas → detalhes → Estornar).",
        "USE_SALE_REFUND",
      );
    }
    if (original.origin === "WITHDRAWAL" && original.withdrawalId) {
      await reverseWithdrawalTx(tx, actor, original.withdrawalId, data.reason);
      return tx.financialTransaction.findUniqueOrThrow({ where: { reversalOfId: original.id } });
    }

    const reversal = await tx.financialTransaction.create({
      data: {
        cashAccountId: original.cashAccountId,
        direction: original.direction === "IN" ? "OUT" : "IN",
        amount: original.amount,
        categoryId: original.categoryId,
        origin: "REVERSAL",
        description: `Estorno de ${formatRecordNumber("MOV", original.number)}: ${original.description}`,
        paymentMethodId: original.paymentMethodId,
        occurredAt: new Date(),
        expenseId: original.expenseId,
        stockEntryId: original.stockEntryId,
        saleId: original.saleId,
        reversalOfId: original.id,
        reversalReason: data.reason,
        createdById: actor.userId,
      },
    });
    if (original.origin === "EXPENSE" && original.expenseId) {
      await tx.expense.update({
        where: { id: original.expenseId },
        data: { status: "REVERSED", reversedAt: new Date(), reversalReason: data.reason, reversedById: actor.userId },
      });
    }
    await audit(tx, actor, {
      action: "finance.reverse",
      entityType: "financial_transaction",
      entityId: original.id,
      summary: `Lançamento ${formatRecordNumber("MOV", original.number)} estornado (${ORIGIN_LABELS[original.origin]})`,
      reason: data.reason,
      metadata: { amount: num(original.amount), transactionId: original.id, reversalId: reversal.id },
    });
    return reversal;
  });
}

// ───────────────────────── Livro-caixa ─────────────────────────

export interface LedgerEntry {
  id: string;
  number: number;
  occurredAt: string;
  description: string;
  category: string;
  categoryGroup: string;
  direction: "IN" | "OUT";
  amount: number;
  signedAmount: number;
  paymentMethod: string | null;
  origin: TransactionOrigin;
  originLabel: string;
  notes: string | null;
  reversalReason: string | null;
  cashAccount: string;
  balanceAfter: number;
  reversed: boolean;
  reversible: boolean;
  reference: {
    type: "sale" | "withdrawal" | "expense" | "stock_entry" | "transaction";
    id: string;
    label: string;
  } | null;
  createdBy: string | null;
}

export interface LedgerFilters extends PageParams {
  from?: Date;
  to?: Date;
  direction?: "IN" | "OUT";
  categoryId?: string;
  origin?: TransactionOrigin;
  search?: string;
  cashAccountId?: string;
}

/**
 * Livro-caixa em ordem cronológica decrescente. O "saldo após" é calculado sobre todos os
 * lançamentos da conta (função de janela), independentemente dos filtros aplicados.
 */
export async function getLedger(filters: LedgerFilters): Promise<Paginated<LedgerEntry>> {
  const { page, pageSize, skip, take } = pageArgs(filters);
  const conditions: Prisma.Sql[] = [];
  if (filters.from) conditions.push(Prisma.sql`l.occurred_at >= ${filters.from}`);
  if (filters.to) conditions.push(Prisma.sql`l.occurred_at < ${filters.to}`);
  if (filters.direction) conditions.push(Prisma.sql`l.direction = ${filters.direction}::"TransactionDirection"`);
  if (filters.categoryId) conditions.push(Prisma.sql`l.category_id = ${filters.categoryId}::uuid`);
  if (filters.origin) conditions.push(Prisma.sql`l.origin = ${filters.origin}::"TransactionOrigin"`);
  if (filters.cashAccountId) conditions.push(Prisma.sql`l.cash_account_id = ${filters.cashAccountId}::uuid`);
  if (filters.search?.trim()) {
    const term = filters.search.trim();
    const numberMatch = /^(?:MOV-?)?0*(\d+)$/i.exec(term);
    conditions.push(
      numberMatch
        ? Prisma.sql`(l.description ILIKE ${`%${term}%`} OR l.number = ${Number(numberMatch[1])})`
        : Prisma.sql`l.description ILIKE ${`%${term}%`}`,
    );
  }
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

  const rows = await prisma.$queryRaw<{ id: string; balance_after: Prisma.Decimal | string; full_count: bigint }[]>`
    WITH l AS (
      SELECT ft.*,
             ca.opening_balance + SUM(CASE WHEN ft.direction = 'IN' THEN ft.amount ELSE -ft.amount END)
               OVER (PARTITION BY ft.cash_account_id ORDER BY ft.occurred_at, ft.number) AS balance_after
        FROM financial_transactions ft
        JOIN cash_accounts ca ON ca.id = ft.cash_account_id
    )
    SELECT l.id, l.balance_after, COUNT(*) OVER() AS full_count
      FROM l
      ${where}
     ORDER BY l.occurred_at DESC, l.number DESC
     LIMIT ${take} OFFSET ${skip}`;

  const total = rows.length
    ? Number(rows[0].full_count)
    : Number(
        (
          await prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*) AS count FROM financial_transactions l ${where}`
        )[0]?.count ?? 0,
      );
  const ids = rows.map((r) => r.id);
  const balanceById = new Map(rows.map((r) => [r.id, num(r.balance_after)]));
  const details = await prisma.financialTransaction.findMany({
    where: { id: { in: ids } },
    include: {
      category: { select: { name: true, group: true } },
      paymentMethod: { select: { name: true } },
      cashAccount: { select: { name: true } },
      reversal: { select: { id: true } },
      sale: { select: { number: true } },
      withdrawal: { select: { number: true } },
      expense: { select: { number: true } },
      stockEntry: { select: { number: true } },
      reversalOf: { select: { number: true } },
    },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(details.map((d) => d.createdById))] } },
    select: { id: true, name: true },
  });
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const byId = new Map(details.map((d) => [d.id, d]));

  const items: LedgerEntry[] = ids.map((id) => {
    const t = byId.get(id)!;
    const amount = num(t.amount);
    let reference: LedgerEntry["reference"] = null;
    if (t.saleId && t.sale)
      reference = { type: "sale", id: t.saleId, label: `PED-${String(t.sale.number).padStart(5, "0")}` };
    else if (t.withdrawalId && t.withdrawal)
      reference = { type: "withdrawal", id: t.withdrawalId, label: formatRecordNumber("RET", t.withdrawal.number) };
    else if (t.expenseId && t.expense)
      reference = { type: "expense", id: t.expenseId, label: formatRecordNumber("DES", t.expense.number) };
    else if (t.stockEntryId && t.stockEntry)
      reference = { type: "stock_entry", id: t.stockEntryId, label: formatRecordNumber("ENT", t.stockEntry.number) };
    else if (t.reversalOfId && t.reversalOf)
      reference = { type: "transaction", id: t.reversalOfId, label: formatRecordNumber("MOV", t.reversalOf.number) };
    const reversible =
      !t.reversal && t.origin !== "REVERSAL" && t.origin !== "SALE_PAYMENT" && t.origin !== "SALE_REFUND";
    return {
      id: t.id,
      number: t.number,
      occurredAt: t.occurredAt.toISOString(),
      description: t.description,
      category: t.category.name,
      categoryGroup: t.category.group,
      direction: t.direction,
      amount,
      signedAmount: t.direction === "IN" ? amount : -amount,
      paymentMethod: t.paymentMethod?.name ?? null,
      origin: t.origin,
      originLabel: ORIGIN_LABELS[t.origin],
      notes: t.notes,
      reversalReason: t.reversalReason,
      cashAccount: t.cashAccount.name,
      balanceAfter: balanceById.get(t.id) ?? 0,
      reversed: Boolean(t.reversal),
      reversible,
      reference,
      createdBy: userName.get(t.createdById) ?? null,
    };
  });
  return paginated(items, total, page, pageSize);
}

// ───────────────────────── Saldo inicial e contas ─────────────────────────

export async function listCashAccounts() {
  const accounts = await prisma.cashAccount.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    openingBalance: num(a.openingBalance),
    openingBalanceDate: a.openingBalanceDate ? dbDateToString(a.openingBalanceDate) : null,
    isDefault: a.isDefault,
    active: a.active,
  }));
}

/**
 * Define o saldo inicial do caixa. A primeira definição (implantação) dispensa justificativa;
 * alterações posteriores exigem motivo e ficam registradas na auditoria.
 */
export async function setOpeningBalance(
  actor: Actor,
  input: OpeningBalanceInput,
  options: { initialSetup?: boolean } = {},
) {
  const data = openingBalanceSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM cash_accounts WHERE id = ${data.cashAccountId}::uuid FOR UPDATE`;
    const account = await tx.cashAccount.findUnique({ where: { id: data.cashAccountId } });
    if (!account) throw new NotFoundError("Conta de caixa não encontrada.");
    const settings = await getSettings(tx);
    const previouslyDefined = account.openingBalanceDate !== null || !dec(account.openingBalance).isZero();
    const isChange = previouslyDefined || (settings.setupCompletedAt !== null && !options.initialSetup);
    if (isChange && !data.reason) {
      throw new DomainError("Informe o motivo da alteração do saldo inicial.", "REASON_REQUIRED", "reason");
    }
    const amount = fromCents(data.amountCents);
    const updated = await tx.cashAccount.update({
      where: { id: account.id },
      data: { openingBalance: amount.toFixed(2), openingBalanceDate: dateOnlyToDb(data.date) },
    });
    await audit(tx, actor, {
      action: isChange ? "cash.opening_balance_change" : "cash.opening_balance_set",
      entityType: "cash_account",
      entityId: account.id,
      summary: isChange
        ? `Saldo inicial de ${account.name} alterado de ${formatBRL(num(account.openingBalance))} para ${formatBRL(num(amount))}`
        : `Saldo inicial de ${account.name} definido em ${formatBRL(num(amount))}`,
      reason: data.reason ?? null,
      before: {
        openingBalance: num(account.openingBalance),
        openingBalanceDate: account.openingBalanceDate ? dbDateToString(account.openingBalanceDate) : null,
      },
      after: { openingBalance: num(amount), openingBalanceDate: data.date },
    });
    return updated;
  });
}

export async function getOpeningBalanceHistory() {
  const logs = await prisma.auditLog.findMany({
    where: { entityType: "cash_account", action: { in: ["cash.opening_balance_set", "cash.opening_balance_change"] } },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true } } },
    take: 50,
  });
  return logs.map((l) => ({
    id: l.id,
    summary: l.summary,
    reason: l.reason,
    createdAt: l.createdAt.toISOString(),
    user: l.user?.name ?? null,
  }));
}

// ───────────────────────── Categorias e formas de pagamento ─────────────────────────

export async function listCategories(options: { includeInactive?: boolean } = {}) {
  const categories = await prisma.financialCategory.findMany({
    where: options.includeInactive ? {} : { active: true },
    orderBy: [{ group: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    group: c.group,
    direction: c.direction,
    isDirectCost: c.isDirectCost,
    withdrawalKind: c.withdrawalKind,
    isSystem: c.systemKey !== null,
    active: c.active,
  }));
}

export async function saveCategory(actor: Actor, input: CategoryInput) {
  const data = categorySchema.parse(input);
  const direction = data.group === "EXPENSE" || data.group === "WITHDRAWAL" ? "OUT" : "IN";
  try {
    return await prisma.$transaction(async (tx) => {
      if (data.categoryId) {
        const existing = await tx.financialCategory.findUnique({ where: { id: data.categoryId } });
        if (!existing) throw new NotFoundError("Categoria não encontrada.");
        if (existing.systemKey)
          throw new DomainError("Categorias de sistema não podem ser alteradas.", "SYSTEM_CATEGORY");
        if (existing.group !== data.group) {
          const used = await tx.financialTransaction.count({ where: { categoryId: existing.id } });
          if (used > 0)
            throw new DomainError("Categoria já utilizada: o grupo não pode ser alterado.", "CATEGORY_IN_USE");
        }
        const updated = await tx.financialCategory.update({
          where: { id: existing.id },
          data: {
            name: data.name,
            group: data.group,
            direction,
            isDirectCost: data.group === "EXPENSE" ? data.isDirectCost : false,
            withdrawalKind: data.group === "WITHDRAWAL" ? (data.withdrawalKind ?? "OTHER") : null,
            active: data.active,
          },
        });
        await audit(tx, actor, {
          action: "category.update",
          entityType: "financial_category",
          entityId: updated.id,
          summary: `Categoria ${updated.name} atualizada`,
          before: { name: existing.name, active: existing.active, isDirectCost: existing.isDirectCost },
          after: { name: updated.name, active: updated.active, isDirectCost: updated.isDirectCost },
        });
        return updated;
      }
      const created = await tx.financialCategory.create({
        data: {
          name: data.name,
          group: data.group,
          direction,
          isDirectCost: data.group === "EXPENSE" ? data.isDirectCost : false,
          withdrawalKind: data.group === "WITHDRAWAL" ? (data.withdrawalKind ?? "OTHER") : null,
          active: data.active,
          sortOrder: 100,
        },
      });
      await audit(tx, actor, {
        action: "category.create",
        entityType: "financial_category",
        entityId: created.id,
        summary: `Categoria ${created.name} criada`,
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new DomainError("Já existe uma categoria com esse nome neste grupo.", "DUPLICATE", "name");
    throw error;
  }
}

export async function listPaymentMethods(options: { includeInactive?: boolean } = {}) {
  const methods = await prisma.paymentMethod.findMany({
    where: options.includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return methods.map((m) => ({ id: m.id, name: m.name, kind: m.kind, active: m.active }));
}

export async function savePaymentMethod(actor: Actor, input: PaymentMethodInput) {
  const data = paymentMethodSchema.parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      if (data.paymentMethodId) {
        const existing = await tx.paymentMethod.findUnique({ where: { id: data.paymentMethodId } });
        if (!existing) throw new NotFoundError("Forma de pagamento não encontrada.");
        const updated = await tx.paymentMethod.update({
          where: { id: existing.id },
          data: { name: data.name, kind: data.kind, active: data.active },
        });
        await audit(tx, actor, {
          action: "payment_method.update",
          entityType: "payment_method",
          entityId: updated.id,
          summary: `Forma de pagamento ${updated.name} atualizada`,
          before: { name: existing.name, active: existing.active },
          after: { name: updated.name, active: updated.active },
        });
        return updated;
      }
      const created = await tx.paymentMethod.create({
        data: { name: data.name, kind: data.kind, active: data.active, sortOrder: 100 },
      });
      await audit(tx, actor, {
        action: "payment_method.create",
        entityType: "payment_method",
        entityId: created.id,
        summary: `Forma de pagamento ${created.name} criada`,
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new DomainError("Já existe uma forma de pagamento com esse nome.", "DUPLICATE", "name");
    throw error;
  }
}

export async function getExpense(expenseId: string) {
  return prisma.expense.findUnique({ where: { id: expenseId }, include: { category: true } });
}

export type ExpenseFilters = PageParams & { from?: Date; to?: Date; categoryId?: string };

export async function listExpenses(filters: ExpenseFilters) {
  const { page, pageSize, skip, take } = pageArgs(filters);
  const where: Prisma.ExpenseWhereInput = {
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.from || filters.to
      ? { incurredAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lt: filters.to } : {}) } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [{ incurredAt: "desc" }, { number: "desc" }],
      skip,
      take,
      include: { category: { select: { name: true, isDirectCost: true } }, paymentMethod: { select: { name: true } } },
    }),
    prisma.expense.count({ where }),
  ]);
  return paginated(
    rows.map((e) => ({
      id: e.id,
      number: e.number,
      amount: num(e.amount),
      description: e.description,
      category: e.category.name,
      isDirectCost: e.category.isDirectCost,
      paymentMethod: e.paymentMethod?.name ?? null,
      incurredAt: e.incurredAt.toISOString(),
      supplier: e.supplier,
      status: e.status,
      saleId: e.saleId,
    })),
    total,
    page,
    pageSize,
  );
}
