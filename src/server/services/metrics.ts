import "server-only";
import { Prisma, type FinancialCategoryGroup } from "@/generated/prisma/client";
import {
  bucketGranularity,
  dateOnlyToDb,
  formatBucketLabel,
  periodBuckets,
  todayString,
  type DateRange,
  type Period,
} from "@/lib/dates";
import { prisma, type Tx } from "@/server/db";
import { dec, num, type Dec } from "@/server/money";
import { getTotalBalance } from "./cash";

// Definições dos indicadores (documentadas em docs/REGRAS-DE-NEGOCIO.md):
// - Vendas canceladas não entram em faturamento, unidades vendidas nem CMV.
// - Faturamento usa a data da venda (competência). Valores recebidos usam a data do recebimento (caixa).
// - Estornos de lançamentos reduzem o grupo do lançamento original (ex.: despesa estornada).

export interface SalesMetrics {
  orders: number;
  units: number;
  /** Σ quantidade × preço (antes de descontos). */
  gross: number;
  discounts: number;
  /** Bruto − descontos (receita líquida dos produtos). */
  netProducts: number;
  shipping: number;
  /** Líquido + frete (valor total das vendas). */
  total: number;
  /** Quanto das vendas do período já foi pago e quanto falta. */
  paidOfPeriodSales: number;
  pendingOfPeriodSales: number;
  cancelledOrders: number;
  averageTicket: number;
}

export async function getSalesMetrics(range: DateRange, db: Tx = prisma): Promise<SalesMetrics> {
  const active = { status: { not: "CANCELLED" as const }, saleDate: { gte: range.start, lt: range.end } };
  const [agg, units, cancelled] = await Promise.all([
    db.sale.aggregate({
      where: active,
      _count: { _all: true },
      _sum: { subtotal: true, discount: true, shipping: true, total: true, amountPaid: true },
    }),
    db.saleItem.aggregate({ where: { sale: active }, _sum: { quantity: true } }),
    db.sale.count({ where: { status: "CANCELLED", saleDate: { gte: range.start, lt: range.end } } }),
  ]);
  const gross = dec(agg._sum.subtotal);
  const discounts = dec(agg._sum.discount);
  const shipping = dec(agg._sum.shipping);
  const total = dec(agg._sum.total);
  const paid = dec(agg._sum.amountPaid);
  const orders = agg._count._all;
  return {
    orders,
    units: units._sum.quantity ?? 0,
    gross: num(gross),
    discounts: num(discounts),
    netProducts: num(gross.sub(discounts)),
    shipping: num(shipping),
    total: num(total),
    paidOfPeriodSales: num(paid),
    pendingOfPeriodSales: num(total.sub(paid)),
    cancelledOrders: cancelled,
    averageTicket: orders > 0 ? num(total.div(orders)) : 0,
  };
}

export interface CashFlowMetrics {
  salesReceipts: number;
  salesRefunds: number;
  /** Recebimentos de vendas − estornos. */
  netSalesReceipts: number;
  capitalContributions: number;
  otherIncome: number;
  expenses: number;
  directCostExpenses: number;
  withdrawals: number;
  stockPurchases: number;
  totalIn: number;
  totalOut: number;
  net: number;
}

const IN_GROUPS: FinancialCategoryGroup[] = ["SALES_RECEIPT", "CAPITAL_CONTRIBUTION", "OTHER_INCOME"];

/** Fluxo de caixa do período, por grupo de categoria, já líquido de estornos. */
export async function getCashFlowMetrics(range: DateRange, db: Tx = prisma): Promise<CashFlowMetrics> {
  const [rows, categories] = await Promise.all([
    db.financialTransaction.groupBy({
      by: ["categoryId", "direction"],
      where: { occurredAt: { gte: range.start, lt: range.end } },
      _sum: { amount: true },
    }),
    db.financialCategory.findMany({ select: { id: true, group: true, isDirectCost: true } }),
  ]);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const byGroup = new Map<FinancialCategoryGroup, Dec>();
  let directCost = dec(0);
  let totalIn = dec(0);
  let totalOut = dec(0);
  for (const row of rows) {
    const category = categoryById.get(row.categoryId);
    if (!category) continue;
    const amount = dec(row._sum.amount);
    if (row.direction === "IN") totalIn = totalIn.add(amount);
    else totalOut = totalOut.add(amount);
    const natural = IN_GROUPS.includes(category.group) ? "IN" : "OUT";
    const signed = row.direction === natural ? amount : amount.neg();
    byGroup.set(category.group, (byGroup.get(category.group) ?? dec(0)).add(signed));
    if (category.group === "EXPENSE" && category.isDirectCost) directCost = directCost.add(signed);
  }
  const get = (g: FinancialCategoryGroup) => byGroup.get(g) ?? dec(0);
  return {
    salesReceipts: num(get("SALES_RECEIPT")),
    salesRefunds: num(get("SALES_REFUND")),
    netSalesReceipts: num(get("SALES_RECEIPT").sub(get("SALES_REFUND"))),
    capitalContributions: num(get("CAPITAL_CONTRIBUTION")),
    otherIncome: num(get("OTHER_INCOME")),
    expenses: num(get("EXPENSE")),
    directCostExpenses: num(directCost),
    withdrawals: num(get("WITHDRAWAL")),
    stockPurchases: num(get("STOCK_PURCHASE")),
    totalIn: num(totalIn),
    totalOut: num(totalOut),
    net: num(totalIn.sub(totalOut)),
  };
}

export interface ProfitMetrics {
  netRevenue: number;
  shippingRevenue: number;
  costOfGoodsSold: number;
  directCosts: number;
  cancellationLosses: number;
  profit: number;
  /** Falso quando há unidades vendidas sem custo de aquisição conhecido. */
  complete: boolean;
  unitsWithoutCost: number;
  margin: number | null;
}

/**
 * Lucro estimado = receita líquida (produtos − descontos + frete cobrado)
 *                − custo das mercadorias vendidas (custo médio no momento da venda)
 *                − despesas diretamente atribuídas às vendas (frete, embalagens, taxas)
 *                − custo das placas não devolvidas em cancelamentos.
 * Compras de estoque e retiradas NÃO entram (evita dupla contagem).
 */
export async function getProfitMetrics(range: DateRange, db: Tx = prisma): Promise<ProfitMetrics> {
  const active = { status: { not: "CANCELLED" as const }, saleDate: { gte: range.start, lt: range.end } };
  const [agg, unknown, cashFlow, lossRows] = await Promise.all([
    db.sale.aggregate({ where: active, _sum: { subtotal: true, discount: true, shipping: true, costOfGoods: true } }),
    db.saleItem.aggregate({ where: { sale: active, unitCost: null }, _sum: { quantity: true } }),
    getCashFlowMetrics(range, db),
    db.saleItem.findMany({
      where: { sale: { status: "CANCELLED", cancelledAt: { gte: range.start, lt: range.end } } },
      select: { quantity: true, returnedQuantity: true, unitCost: true },
    }),
  ]);
  let losses = dec(0);
  let lossUnknown = 0;
  for (const item of lossRows) {
    const lost = item.quantity - item.returnedQuantity;
    if (lost <= 0) continue;
    if (item.unitCost === null) lossUnknown += lost;
    else losses = losses.add(dec(item.unitCost).mul(lost));
  }
  const netRevenue = dec(agg._sum.subtotal).sub(dec(agg._sum.discount));
  const shipping = dec(agg._sum.shipping);
  const cogs = dec(agg._sum.costOfGoods);
  const direct = dec(cashFlow.directCostExpenses);
  const profit = netRevenue.add(shipping).sub(cogs).sub(direct).sub(losses);
  const unitsWithoutCost = (unknown._sum.quantity ?? 0) + lossUnknown;
  const revenue = netRevenue.add(shipping);
  return {
    netRevenue: num(netRevenue),
    shippingRevenue: num(shipping),
    costOfGoodsSold: num(cogs),
    directCosts: num(direct),
    cancellationLosses: num(losses),
    profit: num(profit),
    complete: unitsWithoutCost === 0,
    unitsWithoutCost,
    margin: revenue.greaterThan(0) ? profit.div(revenue).toNumber() : null,
  };
}

/** Contas a receber (posição atual, independente de período). */
export async function getReceivablesPosition(tz: string, db: Tx = prisma) {
  const rows = await db.sale.findMany({
    where: { status: { not: "CANCELLED" }, paymentStatus: { in: ["PENDING", "PARTIAL"] } },
    select: { total: true, amountPaid: true, dueDate: true },
  });
  const today = dateOnlyToDb(todayString(tz));
  let total = dec(0);
  let overdue = dec(0);
  let overdueCount = 0;
  for (const r of rows) {
    const pending = dec(r.total).sub(dec(r.amountPaid));
    total = total.add(pending);
    if (r.dueDate && r.dueDate.getTime() < today.getTime()) {
      overdue = overdue.add(pending);
      overdueCount += 1;
    }
  }
  return { total: num(total), count: rows.length, overdue: num(overdue), overdueCount };
}

/** Valores recebidos de vendas canceladas que ainda precisam ser devolvidos. */
export async function getRefundsDue(db: Tx = prisma) {
  const agg = await db.sale.aggregate({
    where: { status: "CANCELLED", amountPaid: { gt: 0 } },
    _sum: { amountPaid: true },
    _count: { _all: true },
  });
  return { total: num(agg._sum.amountPaid), count: agg._count._all };
}

export async function getCurrentPosition(tz: string, db: Tx = prisma) {
  const [balance, opening, stock, receivables, refundsDue] = await Promise.all([
    getTotalBalance(db),
    db.cashAccount.aggregate({ where: { active: true }, _sum: { openingBalance: true } }),
    db.product.aggregate({ where: { active: true }, _sum: { currentStock: true } }),
    getReceivablesPosition(tz, db),
    getRefundsDue(db),
  ]);
  return {
    balance: num(balance),
    openingBalance: num(opening._sum.openingBalance),
    availableUnits: stock._sum.currentStock ?? 0,
    receivables,
    refundsDue,
  };
}

// ───────────────────────── Séries temporais ─────────────────────────

export interface SeriesPoint {
  key: string;
  label: string;
  salesTotal: number;
  units: number;
  received: number;
  inflows: number;
  withdrawals: number;
  expenses: number;
}

export async function getTimeSeries(
  period: Period,
  tz: string,
): Promise<{ granularity: "day" | "month"; points: SeriesPoint[] }> {
  const granularity = bucketGranularity(period);
  const fmt = granularity === "day" ? "YYYY-MM-DD" : "YYYY-MM";
  const [sales, units, flows] = await Promise.all([
    prisma.$queryRaw<{ bucket: string; total: Prisma.Decimal | string }[]>`
      SELECT to_char(s.sale_date AT TIME ZONE ${tz}, ${fmt}) AS bucket, SUM(s.total) AS total
        FROM sales s
       WHERE s.status <> 'CANCELLED' AND s.sale_date >= ${period.start} AND s.sale_date < ${period.end}
       GROUP BY bucket`,
    prisma.$queryRaw<{ bucket: string; units: bigint }[]>`
      SELECT to_char(s.sale_date AT TIME ZONE ${tz}, ${fmt}) AS bucket, SUM(i.quantity) AS units
        FROM sales s JOIN sale_items i ON i.sale_id = s.id
       WHERE s.status <> 'CANCELLED' AND s.sale_date >= ${period.start} AND s.sale_date < ${period.end}
       GROUP BY bucket`,
    prisma.$queryRaw<
      { bucket: string; grp: FinancialCategoryGroup; direction: "IN" | "OUT"; amount: Prisma.Decimal | string }[]
    >`
      SELECT to_char(ft.occurred_at AT TIME ZONE ${tz}, ${fmt}) AS bucket, c."group"::text AS grp, ft.direction::text AS direction,
             SUM(ft.amount) AS amount
        FROM financial_transactions ft JOIN financial_categories c ON c.id = ft.category_id
       WHERE ft.occurred_at >= ${period.start} AND ft.occurred_at < ${period.end}
       GROUP BY bucket, c."group", ft.direction`,
  ]);

  const points = new Map<string, SeriesPoint>(
    periodBuckets(period, granularity).map((key) => [
      key,
      {
        key,
        label: formatBucketLabel(key, granularity),
        salesTotal: 0,
        units: 0,
        received: 0,
        inflows: 0,
        withdrawals: 0,
        expenses: 0,
      },
    ]),
  );
  for (const row of sales) {
    const p = points.get(row.bucket);
    if (p) p.salesTotal = num(row.total);
  }
  for (const row of units) {
    const p = points.get(row.bucket);
    if (p) p.units = Number(row.units);
  }
  const acc = new Map<string, { received: Dec; inflows: Dec; withdrawals: Dec; expenses: Dec }>();
  for (const row of flows) {
    const entry = acc.get(row.bucket) ?? { received: dec(0), inflows: dec(0), withdrawals: dec(0), expenses: dec(0) };
    const natural = IN_GROUPS.includes(row.grp) ? "IN" : "OUT";
    const signed = row.direction === natural ? dec(row.amount) : dec(row.amount).neg();
    if (row.grp === "SALES_RECEIPT") entry.received = entry.received.add(signed);
    if (row.grp === "SALES_REFUND") entry.received = entry.received.sub(signed);
    if (IN_GROUPS.includes(row.grp)) entry.inflows = entry.inflows.add(signed);
    if (row.grp === "SALES_REFUND") entry.inflows = entry.inflows.sub(signed);
    if (row.grp === "WITHDRAWAL") entry.withdrawals = entry.withdrawals.add(signed);
    if (row.grp === "EXPENSE" || row.grp === "STOCK_PURCHASE") entry.expenses = entry.expenses.add(signed);
    acc.set(row.bucket, entry);
  }
  for (const [bucket, values] of acc) {
    const p = points.get(bucket);
    if (!p) continue;
    p.received = num(values.received);
    p.inflows = num(values.inflows);
    p.withdrawals = num(values.withdrawals);
    p.expenses = num(values.expenses);
  }
  return { granularity, points: [...points.values()] };
}

// ───────────────────────── Atividades recentes ─────────────────────────

const ACTIVITY_ACTIONS = [
  "sale.create",
  "sale.cancel",
  "payment.receive",
  "payment.refund",
  "stock.entry",
  "stock.adjust",
  "withdrawal.create",
  "withdrawal.reverse",
  "expense.create",
  "finance.capital_contribution",
  "finance.other_income",
  "finance.reverse",
];

export interface ActivityItem {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
  amount: number | null;
  quantity: number | null;
  href: string | null;
  tone: "positive" | "negative" | "neutral";
}

const NEGATIVE_ACTIONS = new Set(["sale.cancel", "payment.refund", "withdrawal.create", "expense.create"]);
const POSITIVE_ACTIONS = new Set([
  "payment.receive",
  "finance.capital_contribution",
  "finance.other_income",
  "withdrawal.reverse",
]);

export async function getRecentActivity(limit = 10): Promise<ActivityItem[]> {
  const logs = await prisma.auditLog.findMany({
    where: { action: { in: ACTIVITY_ACTIONS } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return logs.map((log) => {
    const meta = (log.metadata ?? {}) as Record<string, unknown>;
    const amount = typeof meta.amount === "number" ? meta.amount : null;
    const quantity = typeof meta.quantity === "number" ? meta.quantity : null;
    let href: string | null = null;
    if (log.entityType === "sale" && log.entityId) href = `/vendas/${log.entityId}`;
    else if (log.entityType === "withdrawal" && log.entityId) href = `/retiradas?id=${log.entityId}`;
    else if (log.entityType === "stock_entry" || log.action === "stock.adjust") href = `/estoque?aba=movimentacoes`;
    else if (log.entityType === "expense" || log.entityType === "financial_transaction") href = `/financeiro`;
    return {
      id: log.id,
      action: log.action,
      summary: log.summary,
      createdAt: log.createdAt.toISOString(),
      amount,
      quantity,
      href,
      tone: NEGATIVE_ACTIONS.has(log.action) ? "negative" : POSITIVE_ACTIONS.has(log.action) ? "positive" : "neutral",
    };
  });
}

// ───────────────────────── Verificações de consistência ─────────────────────────

export interface Divergence {
  kind: "stock" | "sale_payments" | "payment_transaction" | "negative_balance";
  message: string;
  href: string;
}

/**
 * Verifica se os valores mantidos em cache batem com a fonte de verdade
 * (movimentações de estoque, pagamentos e livro-caixa).
 */
export async function findDivergences(): Promise<Divergence[]> {
  const [stock, salePayments, paymentTx, balance] = await Promise.all([
    prisma.$queryRaw<{ id: string; name: string; current_stock: number; movements: bigint }[]>`
      SELECT p.id, p.name, p.current_stock, COALESCE(SUM(m.quantity), 0) AS movements
        FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
       GROUP BY p.id
      HAVING p.current_stock <> COALESCE(SUM(m.quantity), 0)`,
    prisma.$queryRaw<{ id: string; number: number }[]>`
      SELECT s.id, s.number
        FROM sales s LEFT JOIN payments p ON p.sale_id = s.id
       GROUP BY s.id
      HAVING s.amount_paid <> COALESCE(SUM(CASE WHEN p.kind = 'RECEIPT' THEN p.amount ELSE -p.amount END), 0)`,
    prisma.$queryRaw<{ id: string; sale_id: string; number: number }[]>`
      SELECT p.id, p.sale_id, p.number
        FROM payments p LEFT JOIN financial_transactions ft ON ft.payment_id = p.id
       WHERE ft.id IS NULL OR ft.amount <> p.amount
          OR (p.kind = 'RECEIPT' AND ft.direction <> 'IN') OR (p.kind = 'REFUND' AND ft.direction <> 'OUT')`,
    getTotalBalance(),
  ]);
  const result: Divergence[] = [];
  for (const p of stock) {
    result.push({
      kind: "stock",
      message: `Estoque de ${p.name} (${p.current_stock}) difere do histórico de movimentações (${Number(p.movements)}).`,
      href: "/estoque?aba=movimentacoes",
    });
  }
  for (const s of salePayments) {
    result.push({
      kind: "sale_payments",
      message: `Valor recebido da venda PED-${String(s.number).padStart(5, "0")} difere dos pagamentos registrados.`,
      href: `/vendas/${s.id}`,
    });
  }
  for (const p of paymentTx) {
    result.push({
      kind: "payment_transaction",
      message: `Pagamento nº ${p.number} sem lançamento correspondente no livro-caixa.`,
      href: `/vendas/${p.sale_id}`,
    });
  }
  if (balance.lessThan(0)) {
    result.push({
      kind: "negative_balance",
      message: "O saldo de caixa está negativo. Verifique lançamentos ou registre um aporte de capital.",
      href: "/financeiro",
    });
  }
  return result;
}
