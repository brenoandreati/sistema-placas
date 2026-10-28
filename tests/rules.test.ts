// Regras de negócio, integridade e concorrência.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resolvePeriod, toLocalDateTimeInput } from "@/lib/dates";
import type { Actor } from "@/server/context";
import { disconnectDb, prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { Decimal } from "@/server/money";
import { getTotalBalance } from "@/server/services/cash";
import { deleteCustomer, createCustomer, setCustomerActive } from "@/server/services/customers";
import { registerExpense, registerIncome, reverseTransaction } from "@/server/services/finance";
import { adjustStock, registerStockEntry, setAverageCost, weightedAverageCost } from "@/server/services/inventory";
import { findDivergences, getProfitMetrics } from "@/server/services/metrics";
import {
  computeSaleTotals,
  createSale,
  derivePaymentStatus,
  refundPayment,
  registerPayment,
  updateSale,
} from "@/server/services/sales";
import { registerWithdrawal, reverseWithdrawal } from "@/server/services/withdrawals";
import {
  TZ,
  categoryId,
  key,
  makeCustomer,
  makeProduct,
  now,
  paymentMethodId,
  resetDatabase,
  setBalance,
} from "./helpers";

let actor: Actor;

beforeEach(async () => {
  actor = await resetDatabase();
});

afterAll(async () => {
  await disconnectDb();
});

const balance = async () => (await getTotalBalance()).toNumber();
const D = (v: number | string) => new Decimal(v);

async function sellOne(
  productId: string,
  customerId: string,
  quantity: number,
  status: "PAID" | "PENDING" = "PENDING",
  idem?: string,
) {
  return createSale(actor, {
    customerId,
    items: [{ productId, quantity, unitPriceCents: 3000 }],
    saleDate: now(),
    paymentMethodId: await paymentMethodId(),
    paymentStatus: status,
    idempotencyKey: idem,
  });
}

describe("regras puras", () => {
  it("calcula o custo médio ponderado", () => {
    expect(weightedAverageCost(0, null, 100, D(10))?.toNumber()).toBe(10);
    expect(weightedAverageCost(10, D(8), 20, D(10))?.toFixed(4)).toBe("9.3333");
    // Entrada sem custo mantém o custo vigente quando há saldo...
    expect(weightedAverageCost(10, D(8), 5, null)?.toNumber()).toBe(8);
    // ...e fica desconhecido quando o saldo era zero.
    expect(weightedAverageCost(0, D(8), 5, null)).toBeNull();
    // Saldo sem custo conhecido passa a valer o custo da nova entrada.
    expect(weightedAverageCost(5, null, 5, D(12))?.toNumber()).toBe(12);
  });

  it("calcula totais da venda com desconto e frete", () => {
    const totals = computeSaleTotals([{ quantity: 5, unitPrice: D("30.00") }], D("10.00"), D("15.50"));
    expect(totals.subtotal.toNumber()).toBe(150);
    expect(totals.total.toNumber()).toBe(155.5);
    expect(() => computeSaleTotals([{ quantity: 1, unitPrice: D(10) }], D(11), D(0))).toThrow(DomainError);
  });

  it("deriva o status financeiro sem misturar com o status operacional", () => {
    const base = { total: D(150), amountRefunded: D(0), cancelled: false };
    expect(derivePaymentStatus({ ...base, amountPaid: D(0) })).toBe("PENDING");
    expect(derivePaymentStatus({ ...base, amountPaid: D(50) })).toBe("PARTIAL");
    expect(derivePaymentStatus({ ...base, amountPaid: D(150) })).toBe("PAID");
    expect(derivePaymentStatus({ ...base, amountPaid: D(0), amountRefunded: D(150), cancelled: true })).toBe(
      "REFUNDED",
    );
    expect(derivePaymentStatus({ ...base, amountPaid: D(0), cancelled: true })).toBe("CANCELLED");
  });
});

describe("estoque", () => {
  it("não permite vender mais do que o disponível", async () => {
    const product = await makeProduct(actor, { stock: 3 });
    const customer = await makeCustomer(actor);
    await expect(sellOne(product.id, customer.id, 4)).rejects.toThrow(/Estoque insuficiente/);
    const stored = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.currentStock).toBe(3);
    // Nada foi gravado parcialmente.
    expect(await prisma.sale.count()).toBe(0);
    expect(await prisma.stockMovement.count({ where: { type: "SALE" } })).toBe(0);
  });

  it("vendas simultâneas nunca ultrapassam o estoque", async () => {
    const product = await makeProduct(actor, { stock: 100 });
    const customer = await makeCustomer(actor);
    const results = await Promise.allSettled([
      sellOne(product.id, customer.id, 60),
      sellOne(product.id, customer.id, 60),
      sellOne(product.id, customer.id, 30),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const stored = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.currentStock).toBeGreaterThanOrEqual(0);
    const sold = await prisma.saleItem.aggregate({ _sum: { quantity: true } });
    expect(100 - (sold._sum.quantity ?? 0)).toBe(stored.currentStock);
    expect(fulfilled).toBeGreaterThanOrEqual(1);
    expect(sold._sum.quantity).toBeLessThanOrEqual(100);
    expect(await findDivergences()).toEqual([]);
  });

  it("ajuste manual exige justificativa e gera movimentação", async () => {
    const product = await makeProduct(actor, { stock: 10 });
    await expect(
      adjustStock(actor, { productId: product.id, direction: "OUT", quantity: 1, reason: "", occurredAt: now() }),
    ).rejects.toThrow();
    await adjustStock(actor, {
      productId: product.id,
      direction: "OUT",
      quantity: 2,
      reason: "Placas danificadas",
      occurredAt: now(),
    });
    await expect(
      adjustStock(actor, {
        productId: product.id,
        direction: "OUT",
        quantity: 50,
        reason: "Contagem física",
        occurredAt: now(),
      }),
    ).rejects.toThrow(/Estoque insuficiente/);
    const movements = await prisma.stockMovement.findMany({
      where: { productId: product.id },
      orderBy: { number: "asc" },
    });
    expect(movements.map((m) => [m.type, m.quantity, m.balanceAfter])).toEqual([
      ["ENTRY", 10, 10],
      ["ADJUSTMENT_OUT", -2, 8],
    ]);
  });

  it("editar dados da venda não baixa o estoque novamente", async () => {
    const product = await makeProduct(actor, { stock: 10 });
    const customer = await makeCustomer(actor);
    const sale = await sellOne(product.id, customer.id, 3);
    await updateSale(actor, {
      saleId: sale.id,
      customerId: customer.id,
      saleDate: now(),
      status: "SHIPPED",
      paymentMethodId: sale.paymentMethodId,
      discountCents: 500,
      shippingCents: 1000,
      trackingCode: "BR123",
    });
    const stored = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.currentStock).toBe(7);
    const updated = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(Number(updated.total)).toBe(95);
    expect(updated.status).toBe("SHIPPED");
  });

  it("custo informado depois pode ser aplicado às vendas sem custo", async () => {
    const product = await makeProduct(actor, { stock: 10, unitCostCents: null });
    const customer = await makeCustomer(actor);
    await sellOne(product.id, customer.id, 2, "PAID");
    const period = resolvePeriod("today", TZ);
    expect((await getProfitMetrics(period)).complete).toBe(false);

    await setAverageCost(actor, {
      productId: product.id,
      unitCostCents: 1200,
      reason: "Nota fiscal localizada",
      applyToUnknownSales: true,
    });
    const profit = await getProfitMetrics(period);
    expect(profit.complete).toBe(true);
    expect(profit.costOfGoodsSold).toBe(24);
    expect(profit.profit).toBe(36);
  });
});

describe("pagamentos", () => {
  it("não aceita pagamento acima do saldo pendente nem em venda quitada", async () => {
    const product = await makeProduct(actor, { stock: 10 });
    const customer = await makeCustomer(actor);
    const sale = await sellOne(product.id, customer.id, 5);
    await expect(
      registerPayment(actor, {
        saleId: sale.id,
        amountCents: 15_001,
        paymentMethodId: await paymentMethodId(),
        paidAt: now(),
      }),
    ).rejects.toThrow(/excede o saldo pendente/);
    await registerPayment(actor, {
      saleId: sale.id,
      amountCents: 15_000,
      paymentMethodId: await paymentMethodId(),
      paidAt: now(),
    });
    await expect(
      registerPayment(actor, {
        saleId: sale.id,
        amountCents: 100,
        paymentMethodId: await paymentMethodId(),
        paidAt: now(),
      }),
    ).rejects.toThrow(/quitada/);
  });

  it("a mesma chave de idempotência não duplica pagamentos nem vendas", async () => {
    const product = await makeProduct(actor, { stock: 10 });
    const customer = await makeCustomer(actor);
    const saleKey = key();
    const [a, b] = await Promise.all([
      sellOne(product.id, customer.id, 2, "PENDING", saleKey),
      sellOne(product.id, customer.id, 2, "PENDING", saleKey),
    ]);
    expect(a.id).toBe(b.id);
    expect(await prisma.sale.count()).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock).toBe(8);

    const paymentKey = key();
    const input = {
      saleId: a.id,
      amountCents: 1000,
      paymentMethodId: await paymentMethodId(),
      paidAt: now(),
      idempotencyKey: paymentKey,
    };
    await registerPayment(actor, input);
    await registerPayment(actor, input);
    expect(await prisma.payment.count()).toBe(1);
    expect(await balance()).toBe(10);
  });

  it("estorno de pagamento gera saída compensatória e volta a venda para pendente", async () => {
    const product = await makeProduct(actor, { stock: 10 });
    const customer = await makeCustomer(actor);
    const sale = await sellOne(product.id, customer.id, 5, "PAID");
    const receipt = await prisma.payment.findFirstOrThrow({ where: { saleId: sale.id } });
    await expect(
      refundPayment(actor, {
        paymentId: receipt.id,
        amountCents: 20_000,
        paidAt: now(),
        reason: "Valor lançado errado",
      }),
    ).rejects.toThrow(/excede/);
    await refundPayment(actor, {
      paymentId: receipt.id,
      amountCents: 15_000,
      paidAt: now(),
      reason: "Pagamento não compensado",
    });
    const updated = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(updated.paymentStatus).toBe("PENDING");
    expect(Number(updated.amountPaid)).toBe(0);
    expect(await balance()).toBe(0);
    expect(await prisma.financialTransaction.count()).toBe(2);
  });
});

describe("caixa e retiradas", () => {
  it("não permite retirar mais que o saldo disponível", async () => {
    await setBalance(actor, 10_000);
    await expect(
      registerWithdrawal(actor, {
        amountCents: 10_001,
        withdrawnAt: now(),
        paymentMethodId: await paymentMethodId(),
        categoryId: await categoryId("Retirada pessoal do proprietário"),
        description: "Teste",
      }),
    ).rejects.toThrow(/Saldo insuficiente/);
    expect(await balance()).toBe(100);
  });

  it("retiradas simultâneas não deixam o saldo negativo", async () => {
    await setBalance(actor, 10_000);
    const category = await categoryId("Retirada pessoal do proprietário");
    const method = await paymentMethodId();
    const results = await Promise.allSettled(
      [1, 2, 3].map(() =>
        registerWithdrawal(actor, {
          amountCents: 4_000,
          withdrawnAt: now(),
          paymentMethodId: method,
          categoryId: category,
          description: "Concorrente",
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await balance()).toBe(20);
  });

  it("estorno de retirada é auditável e não pode ser repetido", async () => {
    await setBalance(actor, 10_000);
    const withdrawal = await registerWithdrawal(actor, {
      amountCents: 3_000,
      withdrawnAt: now(),
      paymentMethodId: await paymentMethodId(),
      categoryId: await categoryId("Reembolso"),
      description: "Lançada em duplicidade",
    });
    expect(await balance()).toBe(70);
    await reverseWithdrawal(actor, { withdrawalId: withdrawal.id, reason: "Registro duplicado" });
    expect(await balance()).toBe(100);
    await expect(reverseWithdrawal(actor, { withdrawalId: withdrawal.id, reason: "De novo" })).rejects.toThrow(
      /já foi estornada/,
    );
    const transactions = await prisma.financialTransaction.findMany({ where: { withdrawalId: withdrawal.id } });
    expect(transactions.map((t) => t.origin).sort()).toEqual(["REVERSAL", "WITHDRAWAL"]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "withdrawal.reverse" } });
    expect(log.reason).toBe("Registro duplicado");
  });

  it("despesas diretas entram no lucro e estornos compensam sem apagar", async () => {
    await setBalance(actor, 10_000);
    const product = await makeProduct(actor, { stock: 10, unitCostCents: 1000 });
    const customer = await makeCustomer(actor);
    await sellOne(product.id, customer.id, 5, "PAID");
    const expense = await registerExpense(actor, {
      amountCents: 1_000,
      incurredAt: now(),
      categoryId: await categoryId("Embalagens"),
      description: "Envelopes",
    });
    const period = resolvePeriod("today", TZ);
    expect((await getProfitMetrics(period)).profit).toBe(90);

    const tx = await prisma.financialTransaction.findFirstOrThrow({ where: { expenseId: expense.id } });
    await reverseTransaction(actor, { transactionId: tx.id, reason: "Despesa de outro negócio" });
    expect((await getProfitMetrics(period)).profit).toBe(100);
    expect(await prisma.financialTransaction.count({ where: { expenseId: expense.id } })).toBe(2);
    await expect(reverseTransaction(actor, { transactionId: tx.id, reason: "Repetido" })).rejects.toThrow(
      /já foi estornado/,
    );
  });

  it("aporte aumenta o caixa sem virar receita de vendas", async () => {
    await registerIncome(actor, {
      kind: "CAPITAL_CONTRIBUTION",
      amountCents: 50_000,
      occurredAt: now(),
      categoryId: await categoryId("Aporte de capital"),
      description: "Aporte inicial",
    });
    expect(await balance()).toBe(500);
    const profit = await getProfitMetrics(resolvePeriod("today", TZ));
    expect(profit.netRevenue).toBe(0);
  });

  it("não aceita lançamentos com data futura", async () => {
    await setBalance(actor, 10_000);
    const future = toLocalDateTimeInput(new Date(Date.now() + 3 * 86_400_000), TZ);
    await expect(
      registerExpense(actor, {
        amountCents: 100,
        incurredAt: future,
        categoryId: await categoryId("Frete"),
        description: "x",
      }),
    ).rejects.toThrow(/futuro/);
  });
});

describe("integridade no banco", () => {
  it("bloqueia alteração e exclusão de lançamentos confirmados", async () => {
    await setBalance(actor, 0);
    await registerIncome(actor, {
      kind: "OTHER_INCOME",
      amountCents: 1_000,
      occurredAt: now(),
      categoryId: await categoryId("Outras entradas"),
      description: "Teste",
    });
    const tx = await prisma.financialTransaction.findFirstOrThrow();
    await expect(
      prisma.financialTransaction.update({ where: { id: tx.id }, data: { amount: "1.00" } }),
    ).rejects.toThrow();
    await expect(prisma.financialTransaction.delete({ where: { id: tx.id } })).rejects.toThrow();
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow();
  });

  it("estoque negativo é barrado também pelo banco", async () => {
    const product = await makeProduct(actor, { stock: 1 });
    await expect(prisma.product.update({ where: { id: product.id }, data: { currentStock: -1 } })).rejects.toThrow();
  });
});

describe("clientes", () => {
  it("evita duplicidade por e-mail, telefone e CNPJ", async () => {
    await createCustomer(actor, {
      businessName: "Ótica Visão",
      contactName: "João",
      email: "contato@otica.com",
      phone: "(11) 98765-4321",
    });
    await expect(
      createCustomer(actor, { businessName: "Outra", contactName: "Ana", email: "CONTATO@otica.com" }),
    ).rejects.toThrow(/e-mail/);
    await expect(
      createCustomer(actor, { businessName: "Outra", contactName: "Ana", phone: "11987654321" }),
    ).rejects.toThrow(/telefone/);
    await expect(createCustomer(actor, { businessName: "X", contactName: "Y", email: "invalido" })).rejects.toThrow();
  });

  it("cliente com vendas não pode ser excluído, apenas desativado", async () => {
    const product = await makeProduct(actor, { stock: 5 });
    const customer = await makeCustomer(actor);
    await sellOne(product.id, customer.id, 1);
    await expect(deleteCustomer(actor, customer.id)).rejects.toThrow(/Desative/);
    const deactivated = await setCustomerActive(actor, customer.id, false);
    expect(deactivated.active).toBe(false);
    await expect(sellOne(product.id, customer.id, 1)).rejects.toThrow(/desativado/);
    const other = await makeCustomer(actor, "Sem compras");
    await deleteCustomer(actor, other.id);
    expect(await prisma.customer.count()).toBe(1);
  });
});

describe("compra de estoque sem pagamento", () => {
  it("entrada sem custo não gera saída de caixa e sinaliza custo desconhecido", async () => {
    const product = await makeProduct(actor, { stock: 0 });
    await registerStockEntry(actor, { productId: product.id, quantity: 10, entryDate: now(), paidNow: false });
    const stored = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.averageCost).toBeNull();
    expect(await balance()).toBe(0);
    await expect(
      registerStockEntry(actor, {
        productId: product.id,
        quantity: 10,
        entryDate: now(),
        paidNow: true,
        paymentMethodId: await paymentMethodId(),
      }),
    ).rejects.toThrow();
  });
});
