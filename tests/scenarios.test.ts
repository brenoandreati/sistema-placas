// Cenários de aceitação A–H do documento de requisitos (seção 17).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resolvePeriod } from "@/lib/dates";
import type { Actor } from "@/server/context";
import { disconnectDb, prisma } from "@/server/db";
import { getTotalBalance } from "@/server/services/cash";
import { getLedger } from "@/server/services/finance";
import { registerStockEntry } from "@/server/services/inventory";
import { findDivergences, getCashFlowMetrics, getProfitMetrics, getSalesMetrics } from "@/server/services/metrics";
import { cancelSale, createSale, registerPayment } from "@/server/services/sales";
import { getWithdrawalSummary, listWithdrawals, registerWithdrawal } from "@/server/services/withdrawals";
import { TZ, categoryId, key, makeCustomer, makeProduct, now, paymentMethodId, resetDatabase, setBalance } from "./helpers";

let actor: Actor;
const today = () => resolvePeriod("today", TZ);

beforeEach(async () => {
  actor = await resetDatabase();
});

afterAll(async () => {
  await disconnectDb();
});

async function stockOf(productId: string) {
  return (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).currentStock;
}

async function balance() {
  return (await getTotalBalance()).toNumber();
}

describe("Cenário A — entrada de estoque", () => {
  it("entrada de 100 placas com estoque zerado resulta em 100 disponíveis e registra a movimentação", async () => {
    const product = await makeProduct(actor, { stock: 0 });
    expect(product.currentStock).toBe(0);

    await registerStockEntry(actor, {
      productId: product.id,
      quantity: 100,
      unitCostCents: 1000,
      entryDate: now(),
      supplier: "Fornecedor X",
      paidNow: false,
      idempotencyKey: key(),
    });

    expect(await stockOf(product.id)).toBe(100);
    const movements = await prisma.stockMovement.findMany({ where: { productId: product.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: "ENTRY", quantity: 100, balanceAfter: 100 });
    // Sem pagamento imediato: o caixa não muda.
    expect(await balance()).toBe(0);
  });
});

describe("Cenário B — venda paga", () => {
  it("vende 5 placas a R$ 30,00 com pagamento no ato", async () => {
    await setBalance(actor, 50_000);
    const product = await makeProduct(actor, { stock: 100, unitCostCents: 1000 });
    const customer = await makeCustomer(actor);
    const before = await balance();

    const sale = await createSale(actor, {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 5, unitPriceCents: 3000 }],
      saleDate: now(),
      paymentMethodId: await paymentMethodId(),
      paymentStatus: "PAID",
      idempotencyKey: key(),
    });

    expect(await stockOf(product.id)).toBe(95);
    expect(sale.paymentStatus).toBe("PAID");
    expect(Number(sale.subtotal)).toBe(150);
    expect(Number(sale.amountPaid)).toBe(150);

    const metrics = await getSalesMetrics(today());
    expect(metrics.gross).toBe(150);
    expect(metrics.units).toBe(5);
    expect(metrics.pendingOfPeriodSales).toBe(0);
    const cash = await getCashFlowMetrics(today());
    expect(cash.netSalesReceipts).toBe(150);
    expect(await balance()).toBe(before + 150);
  });
});

describe("Cenário C — venda pendente", () => {
  it("entra no faturamento, gera pendência e não altera o caixa", async () => {
    await setBalance(actor, 10_000);
    const product = await makeProduct(actor, { stock: 100 });
    const customer = await makeCustomer(actor);

    const sale = await createSale(actor, {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 5, unitPriceCents: 3000 }],
      saleDate: now(),
      paymentMethodId: await paymentMethodId(),
      paymentStatus: "PENDING",
    });

    expect(sale.paymentStatus).toBe("PENDING");
    expect(sale.dueDate).not.toBeNull();
    const metrics = await getSalesMetrics(today());
    expect(metrics.total).toBe(150);
    expect(metrics.pendingOfPeriodSales).toBe(150);
    expect((await getCashFlowMetrics(today())).netSalesReceipts).toBe(0);
    expect(await balance()).toBe(100);
    expect(await stockOf(product.id)).toBe(95);
  });
});

describe("Cenário D — pagamento parcial", () => {
  it("recebe R$ 50 de uma venda de R$ 150", async () => {
    const product = await makeProduct(actor, { stock: 100 });
    const customer = await makeCustomer(actor);
    const sale = await createSale(actor, {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 5, unitPriceCents: 3000 }],
      saleDate: now(),
      paymentMethodId: await paymentMethodId(),
      paymentStatus: "PENDING",
    });

    await registerPayment(actor, {
      saleId: sale.id,
      amountCents: 5000,
      paymentMethodId: await paymentMethodId("Dinheiro"),
      paidAt: now(),
      idempotencyKey: key(),
    });

    const updated = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(updated.paymentStatus).toBe("PARTIAL");
    expect(Number(updated.amountPaid)).toBe(50);
    expect(Number(updated.total) - Number(updated.amountPaid)).toBe(100);
    const entries = await prisma.financialTransaction.findMany({ where: { saleId: sale.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ direction: "IN", origin: "SALE_PAYMENT" });
    expect(Number(entries[0].amount)).toBe(50);
  });

  it("partial informado no ato da venda gera uma entrada com o valor recebido", async () => {
    const product = await makeProduct(actor, { stock: 10 });
    const customer = await makeCustomer(actor);
    const sale = await createSale(actor, {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 5, unitPriceCents: 3000 }],
      saleDate: now(),
      paymentMethodId: await paymentMethodId(),
      paymentStatus: "PARTIAL",
      amountReceivedCents: 5000,
    });
    expect(sale.paymentStatus).toBe("PARTIAL");
    expect(Number(sale.amountPaid)).toBe(50);
    expect(await balance()).toBe(50);
  });
});

describe("Cenário E — retirada", () => {
  it("retira R$ 250 de um saldo de R$ 1.000 sem afetar o faturamento", async () => {
    await setBalance(actor, 100_000);
    const product = await makeProduct(actor, { stock: 10 });
    const customer = await makeCustomer(actor);
    await createSale(actor, {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 1, unitPriceCents: 3000 }],
      saleDate: now(),
      paymentMethodId: await paymentMethodId(),
      paymentStatus: "PENDING",
    });
    const salesBefore = await getSalesMetrics(today());
    expect(await balance()).toBe(1000);

    const withdrawal = await registerWithdrawal(actor, {
      amountCents: 25_000,
      withdrawnAt: now(),
      paymentMethodId: await paymentMethodId(),
      categoryId: await categoryId("Retirada pessoal do proprietário"),
      description: "Retirada mensal",
      idempotencyKey: key(),
    });

    expect(await balance()).toBe(750);
    expect(Number(withdrawal.balanceBefore)).toBe(1000);
    expect(Number(withdrawal.balanceAfter)).toBe(750);
    const summary = await getWithdrawalSummary(TZ);
    expect(summary.month).toBe(250);
    expect(summary.allTime).toBe(250);
    expect(await getSalesMetrics(today())).toEqual(salesBefore);
    const history = await listWithdrawals({});
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ amount: 250, category: "Retirada pessoal do proprietário", status: "ACTIVE" });
    // Retirada não é despesa operacional.
    const cash = await getCashFlowMetrics(today());
    expect(cash.withdrawals).toBe(250);
    expect(cash.expenses).toBe(0);
  });
});

describe("Cenário F — cancelamento de venda confirmada", () => {
  it("devolve unidades em condição de revenda, estorna recebimentos e preserva o histórico", async () => {
    await setBalance(actor, 10_000);
    const product = await makeProduct(actor, { stock: 100, unitCostCents: 1000 });
    const customer = await makeCustomer(actor);
    const sale = await createSale(actor, {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 5, unitPriceCents: 3000 }],
      saleDate: now(),
      paymentMethodId: await paymentMethodId(),
      paymentStatus: "PAID",
    });
    expect(await balance()).toBe(250);
    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });

    const cancelled = await cancelSale(actor, {
      saleId: sale.id,
      reason: "Cliente desistiu da compra",
      returns: [{ saleItemId: item.id, returnQuantity: 4 }],
      refundMode: "REFUND_NOW",
    });

    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.paymentStatus).toBe("REFUNDED");
    expect(Number(cancelled.amountPaid)).toBe(0);
    // 4 placas voltam ao estoque; 1 (já personalizada) fica como perda.
    expect(await stockOf(product.id)).toBe(99);
    expect(await balance()).toBe(100);

    const payments = await prisma.payment.findMany({ where: { saleId: sale.id }, orderBy: { number: "asc" } });
    expect(payments.map((p) => p.kind)).toEqual(["RECEIPT", "REFUND"]);
    const ledger = await prisma.financialTransaction.findMany({ where: { saleId: sale.id }, orderBy: { number: "asc" } });
    expect(ledger.map((t) => `${t.direction}:${t.origin}`)).toEqual(["IN:SALE_PAYMENT", "OUT:SALE_REFUND"]);

    const metrics = await getSalesMetrics(today());
    expect(metrics.orders).toBe(0);
    expect(metrics.cancelledOrders).toBe(1);
    const profit = await getProfitMetrics(today());
    expect(profit.cancellationLosses).toBe(10);
    expect(profit.profit).toBe(-10);
    const logs = await prisma.auditLog.findMany({ where: { entityId: sale.id, action: "sale.cancel" } });
    expect(logs).toHaveLength(1);
    expect(logs[0].reason).toBe("Cliente desistiu da compra");
    expect(await findDivergences()).toEqual([]);
  });

  it("pode registrar o valor como 'a devolver' e quitar a devolução depois", async () => {
    const product = await makeProduct(actor, { stock: 10 });
    const customer = await makeCustomer(actor);
    const sale = await createSale(actor, {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 2, unitPriceCents: 3000 }],
      saleDate: now(),
      paymentMethodId: await paymentMethodId(),
      paymentStatus: "PAID",
    });
    const cancelled = await cancelSale(actor, {
      saleId: sale.id,
      reason: "Arte errada na placa",
      returns: [],
      refundMode: "REFUND_LATER",
    });
    expect(cancelled.paymentStatus).toBe("PAID");
    expect(Number(cancelled.amountPaid)).toBe(60);
    expect(await stockOf(product.id)).toBe(10);
    expect(await balance()).toBe(60);

    const { settlePendingRefund } = await import("@/server/services/sales");
    const settled = await settlePendingRefund(actor, {
      saleId: sale.id,
      amountCents: 6000,
      paidAt: now(),
      reason: "Devolvido via PIX",
    });
    expect(settled.paymentStatus).toBe("REFUNDED");
    expect(await balance()).toBe(0);
  });
});

describe("Cenário G — compra de estoque", () => {
  it("compra 20 placas a R$ 10 com pagamento imediato", async () => {
    await setBalance(actor, 100_000);
    const product = await makeProduct(actor, { stock: 10, unitCostCents: 800 });

    await registerStockEntry(actor, {
      productId: product.id,
      quantity: 20,
      unitCostCents: 1000,
      entryDate: now(),
      paidNow: true,
      paymentMethodId: await paymentMethodId(),
    });

    expect(await stockOf(product.id)).toBe(30);
    expect(await balance()).toBe(800);
    const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    // (10 × 8 + 20 × 10) / 30 = 9,3333
    expect(Number(updated.averageCost)).toBeCloseTo(9.3333, 4);
    const cash = await getCashFlowMetrics(today());
    expect(cash.stockPurchases).toBe(200);
    // Compra de estoque não é custo das placas vendidas.
    const profit = await getProfitMetrics(today());
    expect(profit.costOfGoodsSold).toBe(0);
    expect(profit.profit).toBe(0);
  });
});

describe("Cenário H — consistência financeira", () => {
  it("venda, recebimento e retirada mantêm dashboard, livro-caixa, vendas e retiradas coerentes", async () => {
    await setBalance(actor, 20_000);
    const product = await makeProduct(actor, { stock: 50, unitCostCents: 1000 });
    const customer = await makeCustomer(actor);
    const sale = await createSale(actor, {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 10, unitPriceCents: 3000 }],
      saleDate: now(),
      paymentMethodId: await paymentMethodId(),
      paymentStatus: "PENDING",
      discountCents: 2000,
      shippingCents: 1500,
    });
    await registerPayment(actor, {
      saleId: sale.id,
      amountCents: 29_500,
      paymentMethodId: await paymentMethodId(),
      paidAt: now(),
    });
    await registerWithdrawal(actor, {
      amountCents: 10_000,
      withdrawnAt: now(),
      paymentMethodId: await paymentMethodId(),
      categoryId: await categoryId("Distribuição de lucros"),
      description: "Distribuição",
    });

    const month = resolvePeriod("month", TZ);
    const salesMetrics = await getSalesMetrics(month);
    const cash = await getCashFlowMetrics(month);
    const profit = await getProfitMetrics(month);
    const ledger = await getLedger({ pageSize: 50 });
    const withdrawals = await getWithdrawalSummary(TZ);

    expect(salesMetrics.gross).toBe(300);
    expect(salesMetrics.discounts).toBe(20);
    expect(salesMetrics.netProducts).toBe(280);
    expect(salesMetrics.total).toBe(295);
    expect(salesMetrics.pendingOfPeriodSales).toBe(0);
    expect(cash.netSalesReceipts).toBe(295);
    expect(cash.withdrawals).toBe(100);
    expect(withdrawals.month).toBe(100);
    // Saldo = 200 (inicial) + 295 (recebido) − 100 (retirada)
    expect(await balance()).toBe(395);
    expect(ledger.items).toHaveLength(2);
    expect(ledger.items[0].balanceAfter).toBe(395);
    expect(ledger.items.reduce((acc, t) => acc + t.signedAmount, 0)).toBe(195);
    // Lucro = 280 + 15 (frete) − 100 (CMV) = 195; retirada não reduz lucro.
    expect(profit.profit).toBe(195);
    expect(profit.complete).toBe(true);
    expect(await findDivergences()).toEqual([]);
  });
});
