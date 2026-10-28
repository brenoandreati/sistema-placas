import "server-only";
import { Prisma, type Payment, type Sale, type SalePaymentStatus, type SaleStatus } from "@/generated/prisma/client";
import { addDaysToDate, dateOnlyToDb, dbDateToString, toLocalDateString } from "@/lib/dates";
import {
  cancelSaleSchema,
  createSaleSchema,
  refundPaymentSchema,
  registerPaymentSchema,
  settleRefundSchema,
  updateSaleSchema,
  updateSaleStatusSchema,
  type CancelSaleInput,
  type CreateSaleInput,
  type RefundPaymentInput,
  type RegisterPaymentInput,
  type SettleRefundInput,
  type UpdateSaleInput,
} from "@/lib/validation/sales";
import { formatOrderNumber } from "@/lib/format";
import { SYSTEM_CATEGORY } from "@/server/reference-data";
import type { Actor } from "@/server/context";
import { prisma, type Tx } from "@/server/db";
import { DomainError, NotFoundError } from "@/server/errors";
import { parseBusinessDateTime, runIdempotent } from "@/server/guards";
import { dec, fromCents, num, numOrNull, round2, type Dec } from "@/server/money";
import { pageArgs, paginated, type PageParams, type Paginated } from "@/server/pagination";
import { audit } from "./audit";
import { getActivePaymentMethod, getSystemCategory, resolveCashAccount } from "./cash";
import { addStockTx, removeStockTx } from "./inventory";
import { getSettings } from "./settings";

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  REGISTERED: "Registrada",
  PREPARING: "Em preparação",
  SHIPPED: "Enviada",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelada",
};

export const PAYMENT_STATUS_LABELS: Record<SalePaymentStatus, string> = {
  PENDING: "Pendente",
  PARTIAL: "Parcialmente pago",
  PAID: "Pago",
  REFUNDED: "Estornado",
  CANCELLED: "Sem cobrança",
};

// ───────────────────────── Regras puras ─────────────────────────

export interface SaleTotals {
  subtotal: Dec;
  discount: Dec;
  shipping: Dec;
  total: Dec;
}

/** Total dos produtos = Σ quantidade × preço; total da venda = produtos − desconto + frete. */
export function computeSaleTotals(
  items: { quantity: number; unitPrice: Dec }[],
  discount: Dec,
  shipping: Dec,
): SaleTotals {
  const subtotal = round2(items.reduce((acc, i) => acc.add(i.unitPrice.mul(i.quantity)), dec(0)));
  if (discount.greaterThan(subtotal)) {
    throw new DomainError(
      "O desconto não pode ser maior que o total dos produtos.",
      "INVALID_DISCOUNT",
      "discountCents",
    );
  }
  return {
    subtotal,
    discount: round2(discount),
    shipping: round2(shipping),
    total: round2(subtotal.sub(discount).add(shipping)),
  };
}

/**
 * Status financeiro derivado dos valores. O status operacional (entrega) é independente.
 * - Venda ativa: pendente / parcialmente paga / paga.
 * - Venda cancelada: estornada (se havia recebimento e tudo foi devolvido), "sem cobrança"
 *   (nunca houve recebimento) ou mantém pago/parcial enquanto houver valor a devolver.
 */
export function derivePaymentStatus(args: {
  total: Dec;
  amountPaid: Dec;
  amountRefunded: Dec;
  cancelled: boolean;
}): SalePaymentStatus {
  const { total, amountPaid, amountRefunded, cancelled } = args;
  if (cancelled) {
    if (amountPaid.greaterThan(0)) return amountPaid.greaterThanOrEqualTo(total) ? "PAID" : "PARTIAL";
    return amountRefunded.greaterThan(0) ? "REFUNDED" : "CANCELLED";
  }
  if (amountPaid.lessThanOrEqualTo(0)) return "PENDING";
  if (amountPaid.lessThan(total)) return "PARTIAL";
  return "PAID";
}

// ───────────────────────── Primitivas ─────────────────────────

async function lockSale(tx: Tx, saleId: string): Promise<Sale> {
  await tx.$queryRaw`SELECT id FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`;
  const sale = await tx.sale.findUnique({ where: { id: saleId } });
  if (!sale) throw new NotFoundError("Venda não encontrada.");
  return sale;
}

async function createReceiptTx(
  tx: Tx,
  actor: Actor,
  sale: Pick<Sale, "id" | "number">,
  args: {
    amount: Dec;
    paymentMethodId: string;
    cashAccountId: string;
    paidAt: Date;
    notes?: string | null;
    idempotencyKey?: string | null;
    customerName: string;
  },
): Promise<Payment> {
  const category = await getSystemCategory(tx, SYSTEM_CATEGORY.saleReceipt);
  const payment = await tx.payment.create({
    data: {
      saleId: sale.id,
      kind: "RECEIPT",
      amount: args.amount.toFixed(2),
      paymentMethodId: args.paymentMethodId,
      cashAccountId: args.cashAccountId,
      paidAt: args.paidAt,
      notes: args.notes ?? null,
      idempotencyKey: args.idempotencyKey ?? null,
      createdById: actor.userId,
    },
  });
  await tx.financialTransaction.create({
    data: {
      cashAccountId: args.cashAccountId,
      direction: "IN",
      amount: args.amount.toFixed(2),
      categoryId: category.id,
      origin: "SALE_PAYMENT",
      description: `Recebimento ${formatOrderNumber(sale.number)} — ${args.customerName}`,
      paymentMethodId: args.paymentMethodId,
      occurredAt: args.paidAt,
      paymentId: payment.id,
      saleId: sale.id,
      createdById: actor.userId,
    },
  });
  return payment;
}

async function createRefundTx(
  tx: Tx,
  actor: Actor,
  sale: Pick<Sale, "id" | "number">,
  receipt: Payment,
  args: { amount: Dec; paidAt: Date; reason: string; idempotencyKey?: string | null; customerName: string },
): Promise<Payment> {
  const category = await getSystemCategory(tx, SYSTEM_CATEGORY.saleRefund);
  const refund = await tx.payment.create({
    data: {
      saleId: sale.id,
      kind: "REFUND",
      amount: args.amount.toFixed(2),
      paymentMethodId: receipt.paymentMethodId,
      cashAccountId: receipt.cashAccountId,
      paidAt: args.paidAt,
      reason: args.reason,
      refundOfId: receipt.id,
      idempotencyKey: args.idempotencyKey ?? null,
      createdById: actor.userId,
    },
  });
  await tx.financialTransaction.create({
    data: {
      cashAccountId: receipt.cashAccountId,
      direction: "OUT",
      amount: args.amount.toFixed(2),
      categoryId: category.id,
      origin: "SALE_REFUND",
      description: `Estorno ${formatOrderNumber(sale.number)} — ${args.customerName}`,
      paymentMethodId: receipt.paymentMethodId,
      occurredAt: args.paidAt,
      notes: args.reason,
      paymentId: refund.id,
      saleId: sale.id,
      createdById: actor.userId,
    },
  });
  return refund;
}

/** Valor ainda estornável de cada recebimento da venda. */
async function refundableReceipts(tx: Tx, saleId: string) {
  const payments = await tx.payment.findMany({ where: { saleId }, orderBy: { paidAt: "asc" } });
  const refundedByReceipt = new Map<string, Dec>();
  for (const p of payments) {
    if (p.kind === "REFUND" && p.refundOfId) {
      refundedByReceipt.set(p.refundOfId, (refundedByReceipt.get(p.refundOfId) ?? dec(0)).add(dec(p.amount)));
    }
  }
  return payments
    .filter((p) => p.kind === "RECEIPT")
    .map((p) => ({ receipt: p, refundable: dec(p.amount).sub(refundedByReceipt.get(p.id) ?? dec(0)) }))
    .filter((r) => r.refundable.greaterThan(0));
}

/** Atualiza os totais pagos/estornados e o status financeiro após mudanças nos pagamentos. */
async function syncSalePaymentsTx(tx: Tx, saleId: string): Promise<Sale> {
  const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId } });
  const sums = await tx.payment.groupBy({ by: ["kind"], where: { saleId }, _sum: { amount: true } });
  const received = dec(sums.find((s) => s.kind === "RECEIPT")?._sum.amount);
  const refunded = dec(sums.find((s) => s.kind === "REFUND")?._sum.amount);
  const amountPaid = received.sub(refunded);
  const paymentStatus = derivePaymentStatus({
    total: dec(sale.total),
    amountPaid,
    amountRefunded: refunded,
    cancelled: sale.status === "CANCELLED",
  });
  return tx.sale.update({
    where: { id: saleId },
    data: { amountPaid: amountPaid.toFixed(2), amountRefunded: refunded.toFixed(2), paymentStatus },
  });
}

// ───────────────────────── Criação ─────────────────────────

export async function createSale(actor: Actor, input: CreateSaleInput) {
  const data = createSaleSchema.parse(input);
  const findExisting = () =>
    data.idempotencyKey
      ? prisma.sale.findUnique({ where: { idempotencyKey: data.idempotencyKey } })
      : Promise.resolve(null);

  return runIdempotent(
    data.idempotencyKey,
    () =>
      prisma.$transaction(async (tx) => {
        if (data.idempotencyKey) {
          const existing = await tx.sale.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
          if (existing) return existing;
        }
        const settings = await getSettings(tx);
        const tz = settings.timezone;
        const saleDate = parseBusinessDateTime(data.saleDate, tz, "a data da venda", "saleDate");

        const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
        if (!customer) throw new NotFoundError("Cliente não encontrado.");
        if (!customer.active)
          throw new DomainError(
            "Cliente desativado. Reative o cadastro para vender.",
            "INACTIVE_CUSTOMER",
            "customerId",
          );
        const paymentMethod = await getActivePaymentMethod(tx, data.paymentMethodId);

        const products = await tx.product.findMany({ where: { id: { in: data.items.map((i) => i.productId) } } });
        const productById = new Map(products.map((p) => [p.id, p]));
        for (const item of data.items) {
          const product = productById.get(item.productId);
          if (!product) throw new NotFoundError("Produto não encontrado.");
          if (!product.active) throw new DomainError(`${product.name} está inativo.`, "INACTIVE_PRODUCT");
        }

        const lines = data.items.map((i) => ({ ...i, unitPrice: fromCents(i.unitPriceCents) }));
        const totals = computeSaleTotals(lines, fromCents(data.discountCents), fromCents(data.shippingCents));

        let initialPayment = dec(0);
        if (data.paymentStatus === "PAID") initialPayment = totals.total;
        if (data.paymentStatus === "PARTIAL") {
          initialPayment = fromCents(data.amountReceivedCents ?? 0);
          if (initialPayment.greaterThanOrEqualTo(totals.total)) {
            throw new DomainError(
              "O valor recebido cobre o total da venda. Marque o pagamento como pago.",
              "INVALID_PARTIAL",
              "amountReceivedCents",
            );
          }
        }

        const dueDate =
          data.dueDate ??
          (initialPayment.lessThan(totals.total)
            ? addDaysToDate(toLocalDateString(saleDate, tz), settings.defaultDueDays)
            : undefined);

        const sale = await tx.sale.create({
          data: {
            customerId: customer.id,
            saleDate,
            status: data.status,
            paymentStatus: "PENDING",
            paymentMethodId: paymentMethod.id,
            subtotal: totals.subtotal.toFixed(2),
            discount: totals.discount.toFixed(2),
            shipping: totals.shipping.toFixed(2),
            total: totals.total.toFixed(2),
            dueDate: dueDate ? dateOnlyToDb(dueDate) : null,
            notes: data.notes ?? null,
            trackingCode: data.trackingCode ?? null,
            deliveryAddress: data.deliveryAddress ?? customer.address ?? null,
            expectedDeliveryDate: data.expectedDeliveryDate ? dateOnlyToDb(data.expectedDeliveryDate) : null,
            deliveredAt: data.status === "DELIVERED" ? saleDate : null,
            idempotencyKey: data.idempotencyKey ?? null,
            createdById: actor.userId,
          },
        });

        // Baixa de estoque em ordem determinística (evita deadlocks entre vendas simultâneas).
        let costOfGoods = dec(0);
        let costComplete = true;
        for (const line of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
          // Bloqueia o produto para que o custo médio lido seja o mesmo da baixa.
          await tx.$queryRaw`SELECT id FROM products WHERE id = ${line.productId}::uuid FOR UPDATE`;
          const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId } });
          const unitCost = product.averageCost === null ? null : dec(product.averageCost);
          const totalCost = unitCost === null ? null : round2(unitCost.mul(line.quantity));
          if (totalCost === null) costComplete = false;
          else costOfGoods = costOfGoods.add(totalCost);
          const item = await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: line.productId,
              quantity: line.quantity,
              unitPrice: line.unitPrice.toFixed(2),
              total: round2(line.unitPrice.mul(line.quantity)).toFixed(2),
              unitCost: unitCost?.toFixed(4) ?? null,
              totalCost: totalCost?.toFixed(2) ?? null,
            },
          });
          await removeStockTx(tx, actor, {
            productId: line.productId,
            quantity: line.quantity,
            type: "SALE",
            occurredAt: saleDate,
            reason: `Venda ${formatOrderNumber(sale.number)}`,
            saleId: sale.id,
            saleItemId: item.id,
          });
        }
        await tx.sale.update({
          where: { id: sale.id },
          data: { costOfGoods: costOfGoods.toFixed(2), costComplete },
        });

        if (initialPayment.greaterThan(0)) {
          const account = await resolveCashAccount(tx, null);
          await createReceiptTx(tx, actor, sale, {
            amount: initialPayment,
            paymentMethodId: paymentMethod.id,
            cashAccountId: account.id,
            paidAt: saleDate,
            notes: "Recebido no registro da venda",
            customerName: customer.businessName,
          });
        }
        const finalSale = await syncSalePaymentsTx(tx, sale.id);

        const units = lines.reduce((acc, l) => acc + l.quantity, 0);
        await audit(tx, actor, {
          action: "sale.create",
          entityType: "sale",
          entityId: sale.id,
          summary: `Venda ${formatOrderNumber(sale.number)} para ${customer.businessName}: ${units} placa(s)`,
          after: {
            total: totals.total.toNumber(),
            subtotal: totals.subtotal.toNumber(),
            discount: totals.discount.toNumber(),
            shipping: totals.shipping.toNumber(),
            units,
            paymentStatus: finalSale.paymentStatus,
            amountPaid: num(finalSale.amountPaid),
          },
          metadata: { amount: totals.total.toNumber(), quantity: units, saleId: sale.id },
        });
        if (initialPayment.greaterThan(0)) {
          await audit(tx, actor, {
            action: "payment.receive",
            entityType: "sale",
            entityId: sale.id,
            summary: `Recebimento de ${formatOrderNumber(sale.number)} (${customer.businessName})`,
            metadata: { amount: initialPayment.toNumber(), saleId: sale.id },
          });
        }
        return finalSale;
      }),
    findExisting,
  );
}

// ───────────────────────── Edição ─────────────────────────

/**
 * Edita dados que não alteram quantidades (cliente, datas, entrega, desconto, frete...).
 * Itens e quantidades não são editáveis: para corrigir, cancele e registre outra venda,
 * preservando o rastro de estoque.
 */
export async function updateSale(actor: Actor, input: UpdateSaleInput) {
  const data = updateSaleSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const sale = await lockSale(tx, data.saleId);
    if (sale.status === "CANCELLED")
      throw new DomainError("Vendas canceladas não podem ser editadas.", "SALE_CANCELLED");
    const settings = await getSettings(tx);
    const saleDate = parseBusinessDateTime(data.saleDate, settings.timezone, "a data da venda", "saleDate");

    if (data.customerId !== sale.customerId) {
      const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
      if (!customer || !customer.active)
        throw new DomainError("Cliente inválido ou desativado.", "INVALID_CUSTOMER", "customerId");
    }
    if (data.paymentMethodId !== sale.paymentMethodId) await getActivePaymentMethod(tx, data.paymentMethodId);

    const discount = fromCents(data.discountCents);
    const shipping = fromCents(data.shippingCents);
    const subtotal = dec(sale.subtotal);
    if (discount.greaterThan(subtotal)) {
      throw new DomainError(
        "O desconto não pode ser maior que o total dos produtos.",
        "INVALID_DISCOUNT",
        "discountCents",
      );
    }
    const total = round2(subtotal.sub(discount).add(shipping));
    if (total.lessThan(dec(sale.amountPaid))) {
      throw new DomainError(
        "O novo total ficaria menor que o valor já recebido. Estorne parte do pagamento antes de reduzir o valor.",
        "TOTAL_BELOW_PAID",
        "discountCents",
      );
    }

    const updated = await tx.sale.update({
      where: { id: sale.id },
      data: {
        customerId: data.customerId,
        saleDate,
        status: data.status,
        paymentMethodId: data.paymentMethodId,
        discount: discount.toFixed(2),
        shipping: shipping.toFixed(2),
        total: total.toFixed(2),
        dueDate: data.dueDate ? dateOnlyToDb(data.dueDate) : null,
        notes: data.notes ?? null,
        trackingCode: data.trackingCode ?? null,
        deliveryAddress: data.deliveryAddress ?? null,
        expectedDeliveryDate: data.expectedDeliveryDate ? dateOnlyToDb(data.expectedDeliveryDate) : null,
        deliveredAt: data.status === "DELIVERED" ? (sale.deliveredAt ?? new Date()) : null,
      },
    });
    const synced = await syncSalePaymentsTx(tx, sale.id);

    const snapshot = (s: Sale) => ({
      customerId: s.customerId,
      saleDate: s.saleDate.toISOString(),
      status: s.status,
      paymentMethodId: s.paymentMethodId,
      discount: num(s.discount),
      shipping: num(s.shipping),
      total: num(s.total),
      dueDate: s.dueDate ? dbDateToString(s.dueDate) : null,
      notes: s.notes,
      trackingCode: s.trackingCode,
      deliveryAddress: s.deliveryAddress,
      expectedDeliveryDate: s.expectedDeliveryDate ? dbDateToString(s.expectedDeliveryDate) : null,
    });
    const before = snapshot(sale);
    const after = snapshot(updated);
    const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
    if (changed.length > 0) {
      await audit(tx, actor, {
        action: "sale.update",
        entityType: "sale",
        entityId: sale.id,
        summary: `Venda ${formatOrderNumber(sale.number)} editada (${changed.join(", ")})`,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])),
        after: Object.fromEntries(changed.map((k) => [k, after[k]])),
      });
    }
    return synced;
  });
}

export async function updateSaleStatus(actor: Actor, input: { saleId: string; status: string }) {
  const data = updateSaleStatusSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const sale = await lockSale(tx, data.saleId);
    if (sale.status === "CANCELLED")
      throw new DomainError("Vendas canceladas não podem mudar de status.", "SALE_CANCELLED");
    if (sale.status === data.status) return sale;
    const updated = await tx.sale.update({
      where: { id: sale.id },
      data: { status: data.status, deliveredAt: data.status === "DELIVERED" ? new Date() : null },
    });
    await audit(tx, actor, {
      action: "sale.status_change",
      entityType: "sale",
      entityId: sale.id,
      summary: `Venda ${formatOrderNumber(sale.number)}: ${SALE_STATUS_LABELS[sale.status]} → ${SALE_STATUS_LABELS[data.status]}`,
      before: { status: sale.status },
      after: { status: data.status },
    });
    return updated;
  });
}

// ───────────────────────── Pagamentos ─────────────────────────

export async function registerPayment(actor: Actor, input: RegisterPaymentInput) {
  const data = registerPaymentSchema.parse(input);
  const findExisting = () =>
    data.idempotencyKey
      ? prisma.payment.findUnique({ where: { idempotencyKey: data.idempotencyKey } })
      : Promise.resolve(null);
  return runIdempotent(
    data.idempotencyKey,
    () =>
      prisma.$transaction(async (tx) => {
        if (data.idempotencyKey) {
          const existing = await tx.payment.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
          if (existing) return existing;
        }
        const sale = await lockSale(tx, data.saleId);
        if (sale.status === "CANCELLED") {
          throw new DomainError("Não é possível receber pagamento de uma venda cancelada.", "SALE_CANCELLED");
        }
        const settings = await getSettings(tx);
        const paidAt = parseBusinessDateTime(data.paidAt, settings.timezone, "a data do recebimento", "paidAt");
        const amount = fromCents(data.amountCents);
        const pending = dec(sale.total).sub(dec(sale.amountPaid));
        if (pending.lessThanOrEqualTo(0)) throw new DomainError("Esta venda já está quitada.", "ALREADY_PAID");
        if (amount.greaterThan(pending)) {
          throw new DomainError(
            `O valor excede o saldo pendente de ${pending.toFixed(2).replace(".", ",")}.`,
            "AMOUNT_EXCEEDS_PENDING",
            "amountCents",
          );
        }
        const method = await getActivePaymentMethod(tx, data.paymentMethodId);
        const account = await resolveCashAccount(tx, data.cashAccountId);
        const customer = await tx.customer.findUniqueOrThrow({ where: { id: sale.customerId } });
        const payment = await createReceiptTx(tx, actor, sale, {
          amount,
          paymentMethodId: method.id,
          cashAccountId: account.id,
          paidAt,
          notes: data.notes ?? null,
          idempotencyKey: data.idempotencyKey ?? null,
          customerName: customer.businessName,
        });
        const updated = await syncSalePaymentsTx(tx, sale.id);
        await audit(tx, actor, {
          action: "payment.receive",
          entityType: "sale",
          entityId: sale.id,
          summary: `Recebimento de ${formatOrderNumber(sale.number)} (${customer.businessName})`,
          after: { amountPaid: num(updated.amountPaid), paymentStatus: updated.paymentStatus },
          metadata: { amount: amount.toNumber(), saleId: sale.id, paymentId: payment.id },
        });
        return payment;
      }),
    findExisting,
  );
}

/** Estorno de um recebimento (lançado por engano ou devolvido ao cliente). Gera saída compensatória. */
export async function refundPayment(actor: Actor, input: RefundPaymentInput) {
  const data = refundPaymentSchema.parse(input);
  const findExisting = () =>
    data.idempotencyKey
      ? prisma.payment.findUnique({ where: { idempotencyKey: data.idempotencyKey } })
      : Promise.resolve(null);
  return runIdempotent(
    data.idempotencyKey,
    () =>
      prisma.$transaction(async (tx) => {
        if (data.idempotencyKey) {
          const existing = await tx.payment.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
          if (existing) return existing;
        }
        const receipt = await tx.payment.findUnique({ where: { id: data.paymentId } });
        if (!receipt || receipt.kind !== "RECEIPT") throw new NotFoundError("Recebimento não encontrado.");
        const sale = await lockSale(tx, receipt.saleId);
        const settings = await getSettings(tx);
        const paidAt = parseBusinessDateTime(data.paidAt, settings.timezone, "a data do estorno", "paidAt");
        if (paidAt.getTime() < receipt.paidAt.getTime()) {
          throw new DomainError("O estorno não pode ser anterior ao recebimento.", "INVALID_DATE", "paidAt");
        }
        const amount = fromCents(data.amountCents);
        const refundable =
          (await refundableReceipts(tx, sale.id)).find((r) => r.receipt.id === receipt.id)?.refundable ?? dec(0);
        if (refundable.lessThanOrEqualTo(0))
          throw new DomainError("Este recebimento já foi totalmente estornado.", "ALREADY_REFUNDED");
        if (amount.greaterThan(refundable)) {
          throw new DomainError(
            `O valor excede o máximo estornável deste recebimento (${refundable.toFixed(2).replace(".", ",")}).`,
            "AMOUNT_EXCEEDS_REFUNDABLE",
            "amountCents",
          );
        }
        const customer = await tx.customer.findUniqueOrThrow({ where: { id: sale.customerId } });
        const refund = await createRefundTx(tx, actor, sale, receipt, {
          amount,
          paidAt,
          reason: data.reason,
          idempotencyKey: data.idempotencyKey ?? null,
          customerName: customer.businessName,
        });
        const updated = await syncSalePaymentsTx(tx, sale.id);
        await audit(tx, actor, {
          action: "payment.refund",
          entityType: "sale",
          entityId: sale.id,
          summary: `Estorno de pagamento de ${formatOrderNumber(sale.number)} (${customer.businessName})`,
          reason: data.reason,
          before: { amountPaid: num(sale.amountPaid), paymentStatus: sale.paymentStatus },
          after: { amountPaid: num(updated.amountPaid), paymentStatus: updated.paymentStatus },
          metadata: { amount: amount.toNumber(), saleId: sale.id, paymentId: refund.id },
        });
        return refund;
      }),
    findExisting,
  );
}

/** Devolve ao cliente valores recebidos de uma venda cancelada (registrados como "a devolver"). */
export async function settlePendingRefund(actor: Actor, input: SettleRefundInput) {
  const data = settleRefundSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const sale = await lockSale(tx, data.saleId);
    if (sale.status !== "CANCELLED")
      throw new DomainError("Somente vendas canceladas têm valores a devolver.", "SALE_NOT_CANCELLED");
    const settings = await getSettings(tx);
    const paidAt = parseBusinessDateTime(data.paidAt, settings.timezone, "a data da devolução", "paidAt");
    const amount = fromCents(data.amountCents);
    const due = dec(sale.amountPaid);
    if (due.lessThanOrEqualTo(0)) throw new DomainError("Não há valores a devolver nesta venda.", "NOTHING_TO_REFUND");
    if (amount.greaterThan(due)) {
      throw new DomainError(
        `O valor excede o total a devolver (${due.toFixed(2).replace(".", ",")}).`,
        "AMOUNT_EXCEEDS_DUE",
        "amountCents",
      );
    }
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: sale.customerId } });
    await refundAcrossReceiptsTx(tx, actor, sale, amount, paidAt, data.reason, customer.businessName);
    const updated = await syncSalePaymentsTx(tx, sale.id);
    await audit(tx, actor, {
      action: "payment.refund",
      entityType: "sale",
      entityId: sale.id,
      summary: `Devolução ao cliente da venda cancelada ${formatOrderNumber(sale.number)}`,
      reason: data.reason,
      after: { amountPaid: num(updated.amountPaid), paymentStatus: updated.paymentStatus },
      metadata: { amount: amount.toNumber(), saleId: sale.id },
    });
    return updated;
  });
}

async function refundAcrossReceiptsTx(
  tx: Tx,
  actor: Actor,
  sale: Sale,
  amount: Dec,
  paidAt: Date,
  reason: string,
  customerName: string,
) {
  let remaining = amount;
  // Estorna dos recebimentos mais recentes para os mais antigos.
  const receipts = (await refundableReceipts(tx, sale.id)).reverse();
  for (const { receipt, refundable } of receipts) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const part = refundable.lessThan(remaining) ? refundable : remaining;
    const date = paidAt.getTime() < receipt.paidAt.getTime() ? receipt.paidAt : paidAt;
    await createRefundTx(tx, actor, sale, receipt, { amount: part, paidAt: date, reason, customerName });
    remaining = remaining.sub(part);
  }
  if (remaining.greaterThan(0))
    throw new DomainError("Valor de estorno maior que o recebido.", "AMOUNT_EXCEEDS_REFUNDABLE");
}

// ───────────────────────── Cancelamento ─────────────────────────

/**
 * Cancela a venda preservando o histórico:
 * - devolve ao estoque as unidades em condição de revenda (as demais ficam registradas como perda);
 * - estorna os recebimentos agora (saída de caixa) ou os mantém como "valor a devolver".
 */
export async function cancelSale(actor: Actor, input: CancelSaleInput) {
  const data = cancelSaleSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const sale = await lockSale(tx, data.saleId);
    if (sale.status === "CANCELLED") throw new DomainError("Esta venda já foi cancelada.", "ALREADY_CANCELLED");
    const settings = await getSettings(tx);
    const now = new Date();
    const refundDate = data.refundDate
      ? parseBusinessDateTime(data.refundDate, settings.timezone, "a data do estorno", "refundDate")
      : now;

    const items = await tx.saleItem.findMany({ where: { saleId: sale.id }, include: { product: true } });
    const returnsById = new Map(data.returns.map((r) => [r.saleItemId, r.returnQuantity]));
    for (const id of returnsById.keys()) {
      if (!items.some((i) => i.id === id)) throw new DomainError("Item de devolução inválido.", "INVALID_RETURN");
    }

    let returnedUnits = 0;
    let lostUnits = 0;
    for (const item of [...items].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const returnQuantity = returnsById.get(item.id) ?? item.quantity;
      if (returnQuantity > item.quantity) {
        throw new DomainError(`Devolução maior que a quantidade vendida de ${item.product.name}.`, "INVALID_RETURN");
      }
      if (returnQuantity > 0) {
        await addStockTx(tx, actor, {
          productId: item.productId,
          quantity: returnQuantity,
          unitCost: item.unitCost === null ? null : dec(item.unitCost),
          type: "SALE_RETURN",
          occurredAt: now,
          reason: `Cancelamento ${formatOrderNumber(sale.number)}`,
          notes: data.reason,
          saleId: sale.id,
          saleItemId: item.id,
        });
        await tx.saleItem.update({ where: { id: item.id }, data: { returnedQuantity: returnQuantity } });
      }
      returnedUnits += returnQuantity;
      lostUnits += item.quantity - returnQuantity;
    }

    const customer = await tx.customer.findUniqueOrThrow({ where: { id: sale.customerId } });
    await tx.sale.update({
      where: { id: sale.id },
      data: { status: "CANCELLED", cancelledAt: now, cancellationReason: data.reason, cancelledById: actor.userId },
    });

    const paid = dec(sale.amountPaid);
    if (paid.greaterThan(0) && data.refundMode === "REFUND_NOW") {
      await refundAcrossReceiptsTx(
        tx,
        actor,
        sale,
        paid,
        refundDate,
        `Cancelamento: ${data.reason}`,
        customer.businessName,
      );
    }
    const updated = await syncSalePaymentsTx(tx, sale.id);

    await audit(tx, actor, {
      action: "sale.cancel",
      entityType: "sale",
      entityId: sale.id,
      summary: `Venda ${formatOrderNumber(sale.number)} cancelada (${customer.businessName})`,
      reason: data.reason,
      before: { status: sale.status, paymentStatus: sale.paymentStatus, amountPaid: num(sale.amountPaid) },
      after: {
        status: "CANCELLED",
        paymentStatus: updated.paymentStatus,
        amountPaid: num(updated.amountPaid),
        returnedUnits,
        lostUnits,
        refundMode: paid.greaterThan(0) ? data.refundMode : null,
      },
      metadata: { amount: num(sale.total), quantity: returnedUnits + lostUnits, saleId: sale.id },
    });
    if (paid.greaterThan(0) && data.refundMode === "REFUND_NOW") {
      await audit(tx, actor, {
        action: "payment.refund",
        entityType: "sale",
        entityId: sale.id,
        summary: `Estorno dos recebimentos de ${formatOrderNumber(sale.number)} (cancelamento)`,
        reason: data.reason,
        metadata: { amount: paid.toNumber(), saleId: sale.id },
      });
    }
    return updated;
  });
}

// ───────────────────────── Consultas ─────────────────────────

export interface SaleListItem {
  id: string;
  number: number;
  saleDate: string;
  customerId: string;
  customerName: string;
  contactName: string;
  units: number;
  total: number;
  amountPaid: number;
  pending: number;
  refundDue: number;
  paymentMethod: string;
  status: SaleStatus;
  paymentStatus: SalePaymentStatus;
  dueDate: string | null;
  overdue: boolean;
}

export interface SaleFilters extends PageParams {
  search?: string;
  customerId?: string;
  status?: SaleStatus;
  paymentStatus?: SalePaymentStatus;
  paymentMethodId?: string;
  from?: Date;
  to?: Date;
  minTotal?: number;
  maxTotal?: number;
}

function buildSaleWhere(filters: SaleFilters): Prisma.SaleWhereInput {
  const and: Prisma.SaleWhereInput[] = [];
  if (filters.customerId) and.push({ customerId: filters.customerId });
  if (filters.status) and.push({ status: filters.status });
  if (filters.paymentStatus) and.push({ paymentStatus: filters.paymentStatus });
  if (filters.paymentMethodId) and.push({ paymentMethodId: filters.paymentMethodId });
  if (filters.from) and.push({ saleDate: { gte: filters.from } });
  if (filters.to) and.push({ saleDate: { lt: filters.to } });
  if (filters.minTotal !== undefined) and.push({ total: { gte: filters.minTotal } });
  if (filters.maxTotal !== undefined) and.push({ total: { lte: filters.maxTotal } });
  const search = filters.search?.trim();
  if (search) {
    const numberMatch = /^(?:PED-?)?0*(\d+)$/i.exec(search);
    and.push({
      OR: [
        ...(numberMatch ? [{ number: Number(numberMatch[1]) }] : []),
        { customer: { businessName: { contains: search, mode: "insensitive" } } },
        { customer: { contactName: { contains: search, mode: "insensitive" } } },
        { customer: { publicPlaceName: { contains: search, mode: "insensitive" } } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

export async function listSales(filters: SaleFilters, tz: string): Promise<Paginated<SaleListItem>> {
  const { page, pageSize, skip, take } = pageArgs(filters);
  const where = buildSaleWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy: [{ saleDate: "desc" }, { number: "desc" }],
      skip,
      take,
      include: {
        customer: { select: { businessName: true, contactName: true } },
        paymentMethod: { select: { name: true } },
        items: { select: { quantity: true } },
      },
    }),
    prisma.sale.count({ where }),
  ]);
  const today = toLocalDateString(new Date(), tz);
  return paginated(
    rows.map((s) => toSaleListItem(s, today)),
    total,
    page,
    pageSize,
  );
}

type SaleWithListRelations = Sale & {
  customer: { businessName: string; contactName: string };
  paymentMethod: { name: string };
  items: { quantity: number }[];
};

function toSaleListItem(s: SaleWithListRelations, today: string): SaleListItem {
  const cancelled = s.status === "CANCELLED";
  const pending = cancelled ? 0 : num(dec(s.total).sub(dec(s.amountPaid)));
  const dueDate = s.dueDate ? dbDateToString(s.dueDate) : null;
  return {
    id: s.id,
    number: s.number,
    saleDate: s.saleDate.toISOString(),
    customerId: s.customerId,
    customerName: s.customer.businessName,
    contactName: s.customer.contactName,
    units: s.items.reduce((acc, i) => acc + i.quantity, 0),
    total: num(s.total),
    amountPaid: num(s.amountPaid),
    pending,
    refundDue: cancelled ? num(s.amountPaid) : 0,
    paymentMethod: s.paymentMethod.name,
    status: s.status,
    paymentStatus: s.paymentStatus,
    dueDate,
    overdue: !cancelled && pending > 0 && dueDate !== null && dueDate < today,
  };
}

export interface SaleDetail extends SaleListItem {
  customer: {
    id: string;
    businessName: string;
    contactName: string;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    googleReviewUrl: string | null;
    publicPlaceName: string | null;
  };
  paymentMethodId: string;
  subtotal: number;
  discount: number;
  shipping: number;
  amountRefunded: number;
  costOfGoods: number;
  costComplete: boolean;
  grossProfit: number | null;
  trackingCode: string | null;
  deliveryAddress: string | null;
  expectedDeliveryDate: string | null;
  deliveredAt: string | null;
  notes: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  createdBy: string | null;
  items: {
    id: string;
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    total: number;
    unitCost: number | null;
    totalCost: number | null;
    returnedQuantity: number;
  }[];
  payments: {
    id: string;
    number: number;
    kind: "RECEIPT" | "REFUND";
    amount: number;
    paymentMethod: string;
    paidAt: string;
    notes: string | null;
    reason: string | null;
    refundOfId: string | null;
    refundable: number;
    transactionNumber: number | null;
    createdBy: string | null;
  }[];
  history: {
    id: string;
    action: string;
    summary: string;
    reason: string | null;
    createdAt: string;
    user: string | null;
  }[];
  relatedExpenses: { id: string; number: number; description: string; amount: number; status: string }[];
}

export async function getSaleDetail(saleId: string, tz: string): Promise<SaleDetail | null> {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      customer: true,
      paymentMethod: { select: { name: true } },
      items: { include: { product: { select: { name: true, sku: true } } }, orderBy: { id: "asc" } },
      payments: {
        orderBy: [{ paidAt: "asc" }, { number: "asc" }],
        include: { paymentMethod: { select: { name: true } }, financialTransaction: { select: { number: true } } },
      },
      expenses: { select: { id: true, number: true, description: true, amount: true, status: true } },
    },
  });
  if (!sale) return null;
  const logs = await prisma.auditLog.findMany({
    where: { entityType: "sale", entityId: sale.id },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true } } },
  });
  const userIds = [...new Set([sale.createdById, ...sale.payments.map((p) => p.createdById)])];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const refundedByReceipt = new Map<string, Dec>();
  for (const p of sale.payments) {
    if (p.kind === "REFUND" && p.refundOfId) {
      refundedByReceipt.set(p.refundOfId, (refundedByReceipt.get(p.refundOfId) ?? dec(0)).add(dec(p.amount)));
    }
  }

  const today = toLocalDateString(new Date(), tz);
  const base = toSaleListItem(sale, today);
  const netRevenue = dec(sale.subtotal).sub(dec(sale.discount)).add(dec(sale.shipping));
  return {
    ...base,
    customer: {
      id: sale.customer.id,
      businessName: sale.customer.businessName,
      contactName: sale.customer.contactName,
      phone: sale.customer.phone,
      whatsapp: sale.customer.whatsapp,
      email: sale.customer.email,
      googleReviewUrl: sale.customer.googleReviewUrl,
      publicPlaceName: sale.customer.publicPlaceName,
    },
    paymentMethodId: sale.paymentMethodId,
    subtotal: num(sale.subtotal),
    discount: num(sale.discount),
    shipping: num(sale.shipping),
    amountRefunded: num(sale.amountRefunded),
    costOfGoods: num(sale.costOfGoods),
    costComplete: sale.costComplete,
    grossProfit: sale.costComplete && sale.status !== "CANCELLED" ? num(netRevenue.sub(dec(sale.costOfGoods))) : null,
    trackingCode: sale.trackingCode,
    deliveryAddress: sale.deliveryAddress,
    expectedDeliveryDate: sale.expectedDeliveryDate ? dbDateToString(sale.expectedDeliveryDate) : null,
    deliveredAt: sale.deliveredAt?.toISOString() ?? null,
    notes: sale.notes,
    cancelledAt: sale.cancelledAt?.toISOString() ?? null,
    cancellationReason: sale.cancellationReason,
    createdAt: sale.createdAt.toISOString(),
    createdBy: userName.get(sale.createdById) ?? null,
    items: sale.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.product.name,
      sku: i.product.sku,
      quantity: i.quantity,
      unitPrice: num(i.unitPrice),
      total: num(i.total),
      unitCost: numOrNull(i.unitCost),
      totalCost: numOrNull(i.totalCost),
      returnedQuantity: i.returnedQuantity,
    })),
    payments: sale.payments.map((p) => ({
      id: p.id,
      number: p.number,
      kind: p.kind,
      amount: num(p.amount),
      paymentMethod: p.paymentMethod.name,
      paidAt: p.paidAt.toISOString(),
      notes: p.notes,
      reason: p.reason,
      refundOfId: p.refundOfId,
      refundable: p.kind === "RECEIPT" ? num(dec(p.amount).sub(refundedByReceipt.get(p.id) ?? dec(0))) : 0,
      transactionNumber: p.financialTransaction?.number ?? null,
      createdBy: userName.get(p.createdById) ?? null,
    })),
    history: logs.map((l) => ({
      id: l.id,
      action: l.action,
      summary: l.summary,
      reason: l.reason,
      createdAt: l.createdAt.toISOString(),
      user: l.user?.name ?? null,
    })),
    relatedExpenses: sale.expenses.map((e) => ({
      id: e.id,
      number: e.number,
      description: e.description,
      amount: num(e.amount),
      status: e.status,
    })),
  };
}

// ───────────────────────── Contas a receber ─────────────────────────

export type ReceivableStatus = "overdue" | "due_today" | "upcoming" | "no_due_date";

export interface ReceivableItem {
  saleId: string;
  saleNumber: number;
  saleDate: string;
  customerId: string;
  customerName: string;
  contactName: string;
  phone: string | null;
  whatsapp: string | null;
  total: number;
  amountPaid: number;
  pending: number;
  dueDate: string | null;
  daysOverdue: number;
  status: ReceivableStatus;
  paymentStatus: SalePaymentStatus;
}

export interface ReceivableFilters extends PageParams {
  status?: ReceivableStatus;
  customerId?: string;
  search?: string;
  dueFrom?: string;
  dueTo?: string;
}

export async function listReceivables(filters: ReceivableFilters, tz: string) {
  const today = toLocalDateString(new Date(), tz);
  const and: Prisma.SaleWhereInput[] = [
    { status: { not: "CANCELLED" } },
    { paymentStatus: { in: ["PENDING", "PARTIAL"] } },
  ];
  if (filters.customerId) and.push({ customerId: filters.customerId });
  if (filters.search?.trim()) {
    const term = filters.search.trim();
    const numberMatch = /^(?:PED-?)?0*(\d+)$/i.exec(term);
    and.push({
      OR: [
        ...(numberMatch ? [{ number: Number(numberMatch[1]) }] : []),
        { customer: { businessName: { contains: term, mode: "insensitive" } } },
        { customer: { contactName: { contains: term, mode: "insensitive" } } },
      ],
    });
  }
  const todayDb = dateOnlyToDb(today);
  if (filters.status === "overdue") and.push({ dueDate: { lt: todayDb } });
  if (filters.status === "due_today") and.push({ dueDate: todayDb });
  if (filters.status === "upcoming") and.push({ dueDate: { gt: todayDb } });
  if (filters.status === "no_due_date") and.push({ dueDate: null });
  if (filters.dueFrom) and.push({ dueDate: { gte: dateOnlyToDb(filters.dueFrom) } });
  if (filters.dueTo) and.push({ dueDate: { lte: dateOnlyToDb(filters.dueTo) } });

  const where: Prisma.SaleWhereInput = { AND: and };
  const { page, pageSize, skip, take } = pageArgs(filters);
  const [rows, total, summaryRows] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { saleDate: "asc" }],
      skip,
      take,
      include: { customer: { select: { businessName: true, contactName: true, phone: true, whatsapp: true } } },
    }),
    prisma.sale.count({ where }),
    prisma.sale.findMany({
      where: { status: { not: "CANCELLED" }, paymentStatus: { in: ["PENDING", "PARTIAL"] } },
      select: { total: true, amountPaid: true, dueDate: true },
    }),
  ]);

  let totalPending = dec(0);
  let overdueAmount = dec(0);
  let overdueCount = 0;
  let dueTodayAmount = dec(0);
  for (const s of summaryRows) {
    const pending = dec(s.total).sub(dec(s.amountPaid));
    totalPending = totalPending.add(pending);
    const due = s.dueDate ? dbDateToString(s.dueDate) : null;
    if (due && due < today) {
      overdueAmount = overdueAmount.add(pending);
      overdueCount += 1;
    } else if (due === today) {
      dueTodayAmount = dueTodayAmount.add(pending);
    }
  }

  const items: ReceivableItem[] = rows.map((s) => {
    const dueDate = s.dueDate ? dbDateToString(s.dueDate) : null;
    const daysOverdue = dueDate && dueDate < today ? daysBetween(dueDate, today) : 0;
    const status: ReceivableStatus = !dueDate
      ? "no_due_date"
      : dueDate < today
        ? "overdue"
        : dueDate === today
          ? "due_today"
          : "upcoming";
    return {
      saleId: s.id,
      saleNumber: s.number,
      saleDate: s.saleDate.toISOString(),
      customerId: s.customerId,
      customerName: s.customer.businessName,
      contactName: s.customer.contactName,
      phone: s.customer.phone,
      whatsapp: s.customer.whatsapp,
      total: num(s.total),
      amountPaid: num(s.amountPaid),
      pending: num(dec(s.total).sub(dec(s.amountPaid))),
      dueDate,
      daysOverdue,
      status,
      paymentStatus: s.paymentStatus,
    };
  });

  return {
    ...paginated(items, total, page, pageSize),
    summary: {
      totalPending: num(totalPending),
      count: summaryRows.length,
      overdueAmount: num(overdueAmount),
      overdueCount,
      dueTodayAmount: num(dueTodayAmount),
    },
  };
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Dados para o formulário de venda. */
export async function getSaleFormOptions() {
  const [products, paymentMethods, settings] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.paymentMethod.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    getSettings(),
  ]);
  return {
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      salePriceCents: Math.round(num(p.salePrice) * 100),
      currentStock: p.currentStock,
    })),
    paymentMethods: paymentMethods.map((m) => ({ id: m.id, name: m.name, kind: m.kind })),
    defaultDueDays: settings.defaultDueDays,
    timezone: settings.timezone,
  };
}
