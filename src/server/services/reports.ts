import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { periodLengthInDays, type Period } from "@/lib/dates";
import { prisma } from "@/server/db";
import { dec, num, type Dec } from "@/server/money";
import { getCashFlowMetrics, getProfitMetrics, getSalesMetrics } from "./metrics";
import { stockStatus } from "./inventory";

// Relatórios: sempre calculados a partir dos dados reais, respeitando o período filtrado.

/** Saldo de todas as contas ativas no instante informado (exclusive). */
export async function getBalanceAt(at: Date): Promise<number> {
  const accounts = await prisma.cashAccount.findMany({
    where: { active: true },
    select: { id: true, openingBalance: true },
  });
  const sums = await prisma.financialTransaction.groupBy({
    by: ["direction"],
    where: { cashAccountId: { in: accounts.map((a) => a.id) }, occurredAt: { lt: at } },
    _sum: { amount: true },
  });
  const opening = accounts.reduce((acc, a) => acc.add(dec(a.openingBalance)), dec(0));
  const inflow = dec(sums.find((s) => s.direction === "IN")?._sum.amount);
  const outflow = dec(sums.find((s) => s.direction === "OUT")?._sum.amount);
  return num(opening.add(inflow).sub(outflow));
}

// ───────────────────────── Vendas ─────────────────────────

export async function getSalesReport(period: Period) {
  const [metrics, cash, rows] = await Promise.all([
    getSalesMetrics(period),
    getCashFlowMetrics(period),
    prisma.sale.findMany({
      where: { saleDate: { gte: period.start, lt: period.end } },
      orderBy: [{ saleDate: "asc" }, { number: "asc" }],
      include: {
        customer: { select: { businessName: true } },
        paymentMethod: { select: { name: true } },
        items: { select: { quantity: true } },
      },
    }),
  ]);
  return {
    metrics,
    received: cash.netSalesReceipts,
    rows: rows.map((s) => ({
      id: s.id,
      number: s.number,
      saleDate: s.saleDate.toISOString(),
      customer: s.customer.businessName,
      units: s.items.reduce((a, i) => a + i.quantity, 0),
      gross: num(s.subtotal),
      discount: num(s.discount),
      shipping: num(s.shipping),
      total: num(s.total),
      paid: num(s.amountPaid),
      pending: s.status === "CANCELLED" ? 0 : num(dec(s.total).sub(dec(s.amountPaid))),
      status: s.status,
      paymentStatus: s.paymentStatus,
      paymentMethod: s.paymentMethod.name,
    })),
  };
}

// ───────────────────────── Estoque ─────────────────────────

export async function getStockReport(period: Period) {
  const [products, movements] = await Promise.all([
    prisma.product.findMany({ orderBy: { name: "asc" } }),
    prisma.stockMovement.groupBy({
      by: ["productId", "type"],
      where: { occurredAt: { gte: period.start, lt: period.end } },
      _sum: { quantity: true },
    }),
  ]);
  const byProduct = (productId: string, type: string) =>
    movements.find((m) => m.productId === productId && m.type === type)?._sum.quantity ?? 0;
  const rows = products.map((p) => {
    const entries = byProduct(p.id, "ENTRY");
    const sold = -byProduct(p.id, "SALE");
    const returned = byProduct(p.id, "SALE_RETURN");
    const adjustments = byProduct(p.id, "ADJUSTMENT_IN") + byProduct(p.id, "ADJUSTMENT_OUT");
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      active: p.active,
      currentStock: p.currentStock,
      minStock: p.minStock,
      status: stockStatus(p),
      entries,
      sold,
      returned,
      adjustments,
      averageCost: p.averageCost === null ? null : dec(p.averageCost).toNumber(),
      stockValue: p.averageCost === null ? null : num(dec(p.averageCost).mul(p.currentStock)),
    };
  });
  const totals = rows.reduce(
    (acc, r) => ({
      currentStock: acc.currentStock + r.currentStock,
      entries: acc.entries + r.entries,
      sold: acc.sold + r.sold,
      returned: acc.returned + r.returned,
      adjustments: acc.adjustments + r.adjustments,
      stockValue: acc.stockValue + (r.stockValue ?? 0),
      valueComplete: acc.valueComplete && (r.stockValue !== null || r.currentStock === 0),
    }),
    { currentStock: 0, entries: 0, sold: 0, returned: 0, adjustments: 0, stockValue: 0, valueComplete: true },
  );
  const totalUnitsWithCost = rows.reduce((acc, r) => acc + (r.averageCost !== null ? r.currentStock : 0), 0);
  return {
    rows,
    totals: { ...totals, averageCost: totalUnitsWithCost > 0 ? totals.stockValue / totalUnitsWithCost : null },
  };
}

// ───────────────────────── Clientes ─────────────────────────

interface CustomerReportRow {
  id: string;
  business_name: string;
  contact_name: string;
  period_orders: bigint;
  period_units: bigint | null;
  period_total: Prisma.Decimal | string | null;
  all_orders: bigint;
  all_total: Prisma.Decimal | string | null;
}

export async function getCustomersReport(period: Period) {
  const [registered, newInPeriod, rows] = await Promise.all([
    prisma.customer.count(),
    prisma.customer.count({ where: { createdAt: { gte: period.start, lt: period.end } } }),
    prisma.$queryRaw<CustomerReportRow[]>`
      WITH units AS (SELECT sale_id, SUM(quantity) AS units FROM sale_items GROUP BY sale_id),
      active AS (
        SELECT s.id, s.customer_id, s.total, s.sale_date, COALESCE(u.units, 0) AS units
          FROM sales s LEFT JOIN units u ON u.sale_id = s.id
         WHERE s.status <> 'CANCELLED'
      )
      SELECT c.id, c.business_name, c.contact_name,
             COUNT(a.id) FILTER (WHERE a.sale_date >= ${period.start} AND a.sale_date < ${period.end}) AS period_orders,
             SUM(a.units) FILTER (WHERE a.sale_date >= ${period.start} AND a.sale_date < ${period.end}) AS period_units,
             SUM(a.total) FILTER (WHERE a.sale_date >= ${period.start} AND a.sale_date < ${period.end}) AS period_total,
             COUNT(a.id) AS all_orders,
             SUM(a.total) AS all_total
        FROM customers c
        JOIN active a ON a.customer_id = c.id
       GROUP BY c.id
      HAVING COUNT(a.id) FILTER (WHERE a.sale_date >= ${period.start} AND a.sale_date < ${period.end}) > 0
       ORDER BY SUM(a.total) FILTER (WHERE a.sale_date >= ${period.start} AND a.sale_date < ${period.end}) DESC NULLS LAST`,
  ]);
  const mapped = rows.map((r) => ({
    id: r.id,
    businessName: r.business_name,
    contactName: r.contact_name,
    periodOrders: Number(r.period_orders),
    periodUnits: Number(r.period_units ?? 0),
    periodTotal: num(r.period_total),
    allOrders: Number(r.all_orders),
    allTotal: num(r.all_total),
    recurring: Number(r.all_orders) >= 2,
  }));
  return {
    registered,
    newInPeriod,
    buyers: mapped.length,
    recurring: mapped.filter((r) => r.recurring).length,
    rows: mapped,
  };
}

// ───────────────────────── Financeiro ─────────────────────────

export async function getFinancialReport(period: Period) {
  const [cash, profit, openingBalance, closingBalance, byCategory, categories] = await Promise.all([
    getCashFlowMetrics(period),
    getProfitMetrics(period),
    getBalanceAt(period.start),
    getBalanceAt(period.end),
    prisma.financialTransaction.groupBy({
      by: ["categoryId", "direction"],
      where: { occurredAt: { gte: period.start, lt: period.end } },
      _sum: { amount: true },
    }),
    prisma.financialCategory.findMany(),
  ]);
  const categoryRows = categories
    .map((c) => {
      const inflow = dec(byCategory.find((r) => r.categoryId === c.id && r.direction === "IN")?._sum.amount);
      const outflow = dec(byCategory.find((r) => r.categoryId === c.id && r.direction === "OUT")?._sum.amount);
      return {
        id: c.id,
        name: c.name,
        group: c.group,
        inflow: num(inflow),
        outflow: num(outflow),
        net: num(inflow.sub(outflow)),
      };
    })
    .filter((r) => r.inflow !== 0 || r.outflow !== 0)
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  return { cash, profit, openingBalance, closingBalance, categoryRows };
}

// ───────────────────────── Retiradas ─────────────────────────

export async function getWithdrawalsReport(period: Period, previous: Period) {
  const sumFor = async (p: Period) =>
    dec(
      (
        await prisma.withdrawal.aggregate({
          where: { status: "ACTIVE", withdrawnAt: { gte: p.start, lt: p.end } },
          _sum: { amount: true },
        })
      )._sum.amount,
    );
  const [total, previousTotal, rows] = await Promise.all([
    sumFor(period),
    sumFor(previous),
    prisma.withdrawal.findMany({
      where: { withdrawnAt: { gte: period.start, lt: period.end } },
      orderBy: [{ withdrawnAt: "asc" }, { number: "asc" }],
      include: { category: { select: { name: true } }, paymentMethod: { select: { name: true } } },
    }),
  ]);
  const months = Math.max(1, periodLengthInDays(period) / 30.4375);
  const byCategory = new Map<string, Dec>();
  for (const r of rows) {
    if (r.status !== "ACTIVE") continue;
    byCategory.set(r.category.name, (byCategory.get(r.category.name) ?? dec(0)).add(dec(r.amount)));
  }
  return {
    total: num(total),
    previousTotal: num(previousTotal),
    monthlyAverage: num(total.div(months)),
    byCategory: [...byCategory.entries()].map(([name, amount]) => ({ name, amount: num(amount) })),
    rows: rows.map((r) => ({
      id: r.id,
      number: r.number,
      withdrawnAt: r.withdrawnAt.toISOString(),
      amount: num(r.amount),
      category: r.category.name,
      paymentMethod: r.paymentMethod.name,
      description: r.description,
      balanceAfter: num(r.balanceAfter),
      status: r.status,
      reversalReason: r.reversalReason,
    })),
  };
}

// ───────────────────────── CSV ─────────────────────────

const amountFormat = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

/** Valor monetário no padrão de planilhas pt-BR (vírgula decimal, sem separador de milhar). */
export function csvMoney(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : amountFormat.format(value);
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Evita injeção de fórmulas ao abrir no Excel/Planilhas.
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(,\d+)?$/.test(text)) text = `'${text}`;
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV separado por ponto e vírgula, com BOM UTF-8 (abre corretamente no Excel em português). */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}
