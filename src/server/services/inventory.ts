import "server-only";
import type { Product, StockMovementType } from "@/generated/prisma/client";
import {
  createProductSchema,
  setAverageCostSchema,
  stockAdjustmentSchema,
  stockEntrySchema,
  updateProductSchema,
  type CreateProductInput,
  type SetAverageCostInput,
  type StockAdjustmentInput,
  type StockEntryInput,
  type UpdateProductInput,
} from "@/lib/validation/inventory";
import { toLocalDateTimeInput } from "@/lib/dates";
import { SYSTEM_CATEGORY } from "@/server/reference-data";
import type { Actor } from "@/server/context";
import { prisma, type Tx } from "@/server/db";
import { DomainError, NotFoundError, isUniqueViolation } from "@/server/errors";
import { parseBusinessDateTime, runIdempotent } from "@/server/guards";
import { dec, fromCents, num, numOrNull, round2, round4, type Dec } from "@/server/money";
import { pageArgs, paginated, type PageParams, type Paginated } from "@/server/pagination";
import { audit } from "./audit";
import { getActivePaymentMethod, getSystemCategory, resolveCashAccount } from "./cash";
import { getTimezone } from "./settings";

// ───────────────────────── Regras de custo ─────────────────────────

/**
 * Custo médio ponderado após uma entrada.
 * - Entrada com custo conhecido: média ponderada entre o saldo atual e a entrada. Se o saldo
 *   atual não tiver custo conhecido (ou for zero), o custo da entrada passa a valer para todo o saldo.
 * - Entrada sem custo: mantém o custo médio vigente se houver saldo; com saldo zero o custo fica
 *   desconhecido (o lucro dessas unidades não pode ser calculado com precisão).
 */
export function weightedAverageCost(
  currentStock: number,
  currentAverage: Dec | null,
  quantityIn: number,
  unitCost: Dec | null,
): Dec | null {
  if (unitCost === null) return currentStock > 0 ? currentAverage : null;
  if (currentStock <= 0 || currentAverage === null) return round4(unitCost);
  const totalValue = currentAverage.mul(currentStock).add(unitCost.mul(quantityIn));
  return round4(totalValue.div(currentStock + quantityIn));
}

// ───────────────────────── Primitivas de estoque (usadas dentro de transações) ─────────────────────────

interface StockMoveArgs {
  productId: string;
  quantity: number;
  occurredAt: Date;
  reason?: string | null;
  notes?: string | null;
  saleId?: string | null;
  saleItemId?: string | null;
  stockEntryId?: string | null;
}

/** Entrada de unidades: bloqueia o produto, recalcula o custo médio e grava a movimentação. */
export async function addStockTx(
  tx: Tx,
  actor: Actor,
  args: StockMoveArgs & {
    type: Extract<StockMovementType, "ENTRY" | "SALE_RETURN" | "ADJUSTMENT_IN">;
    unitCost: Dec | null;
  },
) {
  if (!Number.isInteger(args.quantity) || args.quantity <= 0) throw new DomainError("Quantidade inválida.");
  await tx.$queryRaw`SELECT id FROM products WHERE id = ${args.productId}::uuid FOR UPDATE`;
  const product = await tx.product.findUnique({ where: { id: args.productId } });
  if (!product) throw new NotFoundError("Produto não encontrado.");

  const currentAverage = product.averageCost === null ? null : dec(product.averageCost);
  // Ajustes de entrada não alteram o custo médio (unidades valorizadas ao custo vigente).
  const newAverage =
    args.type === "ADJUSTMENT_IN"
      ? currentAverage
      : weightedAverageCost(product.currentStock, currentAverage, args.quantity, args.unitCost);

  const updated = await tx.product.update({
    where: { id: product.id },
    data: {
      currentStock: { increment: args.quantity },
      averageCost: newAverage === null ? null : newAverage.toFixed(4),
      ...(args.type === "ENTRY" && args.unitCost !== null ? { lastPurchaseCost: args.unitCost.toFixed(4) } : {}),
    },
  });

  const movement = await tx.stockMovement.create({
    data: {
      productId: product.id,
      type: args.type,
      quantity: args.quantity,
      balanceAfter: updated.currentStock,
      unitCost: args.type === "ADJUSTMENT_IN" ? product.averageCost : (args.unitCost?.toFixed(4) ?? null),
      averageCostAfter: updated.averageCost,
      reason: args.reason ?? null,
      notes: args.notes ?? null,
      saleId: args.saleId ?? null,
      saleItemId: args.saleItemId ?? null,
      stockEntryId: args.stockEntryId ?? null,
      occurredAt: args.occurredAt,
      createdById: actor.userId,
    },
  });
  return { product: updated, movement };
}

/**
 * Saída de unidades. O decremento é condicional (estoque >= quantidade) e atômico,
 * o que impede estoque negativo mesmo com vendas simultâneas.
 */
export async function removeStockTx(
  tx: Tx,
  actor: Actor,
  args: StockMoveArgs & { type: Extract<StockMovementType, "SALE" | "ADJUSTMENT_OUT"> },
) {
  if (!Number.isInteger(args.quantity) || args.quantity <= 0) throw new DomainError("Quantidade inválida.");
  const result = await tx.product.updateMany({
    where: { id: args.productId, currentStock: { gte: args.quantity } },
    data: { currentStock: { decrement: args.quantity } },
  });
  if (result.count === 0) {
    const product = await tx.product.findUnique({ where: { id: args.productId } });
    if (!product) throw new NotFoundError("Produto não encontrado.");
    throw new DomainError(
      `Estoque insuficiente de ${product.name}: ${product.currentStock} disponível(is), ${args.quantity} solicitada(s).`,
      "INSUFFICIENT_STOCK",
    );
  }
  const product = await tx.product.findUniqueOrThrow({ where: { id: args.productId } });
  const movement = await tx.stockMovement.create({
    data: {
      productId: product.id,
      type: args.type,
      quantity: -args.quantity,
      balanceAfter: product.currentStock,
      unitCost: product.averageCost,
      averageCostAfter: product.averageCost,
      reason: args.reason ?? null,
      notes: args.notes ?? null,
      saleId: args.saleId ?? null,
      saleItemId: args.saleItemId ?? null,
      occurredAt: args.occurredAt,
      createdById: actor.userId,
    },
  });
  return { product, movement };
}

// ───────────────────────── Produtos ─────────────────────────

export interface ProductView {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  category: string | null;
  salePrice: number;
  averageCost: number | null;
  lastPurchaseCost: number | null;
  currentStock: number;
  minStock: number;
  active: boolean;
  stockValue: number | null;
  stockStatus: "ok" | "low" | "out";
  createdAt: string;
}

export function stockStatus(product: Pick<Product, "currentStock" | "minStock">): ProductView["stockStatus"] {
  if (product.currentStock <= 0) return "out";
  if (product.currentStock <= product.minStock) return "low";
  return "ok";
}

export function toProductView(p: Product): ProductView {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    description: p.description,
    category: p.category,
    salePrice: num(p.salePrice),
    averageCost: numOrNull(p.averageCost),
    lastPurchaseCost: numOrNull(p.lastPurchaseCost),
    currentStock: p.currentStock,
    minStock: p.minStock,
    active: p.active,
    stockValue: p.averageCost === null ? null : num(dec(p.averageCost).mul(p.currentStock)),
    stockStatus: stockStatus(p),
    createdAt: p.createdAt.toISOString(),
  };
}

export async function listProducts(options: { includeInactive?: boolean } = {}): Promise<ProductView[]> {
  const products = await prisma.product.findMany({
    where: options.includeInactive ? {} : { active: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return products.map(toProductView);
}

export async function getProduct(productId: string): Promise<ProductView | null> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  return product ? toProductView(product) : null;
}

async function assertSkuAvailable(tx: Tx, sku: string, exceptId?: string) {
  const existing = await tx.product.findUnique({ where: { sku } });
  if (existing && existing.id !== exceptId) {
    throw new DomainError(`Já existe um produto com o SKU ${sku}.`, "DUPLICATE_SKU", "sku");
  }
}

export async function createProduct(actor: Actor, input: CreateProductInput): Promise<ProductView> {
  const data = createProductSchema.parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      await assertSkuAvailable(tx, data.sku);
      const product = await tx.product.create({
        data: {
          name: data.name,
          sku: data.sku,
          description: data.description ?? null,
          category: data.category ?? null,
          salePrice: fromCents(data.salePriceCents).toFixed(2),
          minStock: data.minStock,
          active: data.active,
        },
      });
      await audit(tx, actor, {
        action: "product.create",
        entityType: "product",
        entityId: product.id,
        summary: `Produto ${product.name} (${product.sku}) cadastrado`,
        after: { name: product.name, sku: product.sku, salePrice: num(product.salePrice), minStock: product.minStock },
      });

      if (data.initialQuantity > 0) {
        const tz = await getTimezone(tx);
        await registerStockEntryTx(tx, actor, {
          productId: product.id,
          quantity: data.initialQuantity,
          unitCostCents: data.initialUnitCostCents ?? null,
          entryDate: toLocalDateTimeInput(new Date(), tz),
          notes: "Estoque inicial",
          paidNow: data.initialPaidNow,
          paymentMethodId: data.initialPaymentMethodId ?? null,
        });
      }
      return toProductView(await tx.product.findUniqueOrThrow({ where: { id: product.id } }));
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new DomainError(`Já existe um produto com o SKU ${data.sku}.`, "DUPLICATE_SKU", "sku");
    throw error;
  }
}

export async function updateProduct(actor: Actor, input: UpdateProductInput): Promise<ProductView> {
  const data = updateProductSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id: data.productId } });
    if (!before) throw new NotFoundError("Produto não encontrado.");
    await assertSkuAvailable(tx, data.sku, before.id);
    const updated = await tx.product.update({
      where: { id: before.id },
      data: {
        name: data.name,
        sku: data.sku,
        description: data.description ?? null,
        category: data.category ?? null,
        salePrice: fromCents(data.salePriceCents).toFixed(2),
        minStock: data.minStock,
        active: data.active,
      },
    });
    const fields = ["name", "sku", "description", "category", "salePrice", "minStock", "active"] as const;
    const beforeView = toProductView(before);
    const afterView = toProductView(updated);
    const changed = fields.filter((f) => beforeView[f] !== afterView[f]);
    if (changed.length > 0) {
      const priceChanged = changed.includes("salePrice");
      await audit(tx, actor, {
        action: priceChanged ? "product.price_change" : "product.update",
        entityType: "product",
        entityId: updated.id,
        summary: priceChanged
          ? `Preço de ${updated.name} alterado de ${beforeView.salePrice.toFixed(2)} para ${afterView.salePrice.toFixed(2)}`
          : `Produto ${updated.name} atualizado`,
        before: Object.fromEntries(changed.map((f) => [f, beforeView[f]])),
        after: Object.fromEntries(changed.map((f) => [f, afterView[f]])),
      });
    }
    return afterView;
  });
}

// ───────────────────────── Entradas de estoque ─────────────────────────

type StockEntryData = ReturnType<typeof stockEntrySchema.parse>;

async function registerStockEntryTx(
  tx: Tx,
  actor: Actor,
  input: Omit<StockEntryInput, "idempotencyKey"> & { idempotencyKey?: string },
) {
  const data: StockEntryData = stockEntrySchema.parse(input);
  const tz = await getTimezone(tx);
  const entryDate = parseBusinessDateTime(data.entryDate, tz, "a data da entrada", "entryDate");

  const product = await tx.product.findUnique({ where: { id: data.productId } });
  if (!product) throw new NotFoundError("Produto não encontrado.");
  if (!product.active)
    throw new DomainError("Produto inativo. Reative-o antes de registrar entradas.", "INACTIVE_PRODUCT");

  const unitCost =
    data.unitCostCents === null || data.unitCostCents === undefined ? null : fromCents(data.unitCostCents);
  const totalCost = unitCost === null ? null : round2(unitCost.mul(data.quantity));

  let cashAccountId: string | null = null;
  let paymentMethodId: string | null = null;
  if (data.paidNow && totalCost && totalCost.greaterThan(0)) {
    cashAccountId = (await resolveCashAccount(tx, data.cashAccountId)).id;
    paymentMethodId = (await getActivePaymentMethod(tx, data.paymentMethodId!)).id;
  }

  const entry = await tx.stockEntry.create({
    data: {
      productId: product.id,
      quantity: data.quantity,
      unitCost: unitCost?.toFixed(4) ?? null,
      totalCost: totalCost?.toFixed(2) ?? null,
      entryDate,
      supplier: data.supplier ?? null,
      documentNumber: data.documentNumber ?? null,
      notes: data.notes ?? null,
      paidNow: cashAccountId !== null,
      cashAccountId,
      paymentMethodId,
      idempotencyKey: data.idempotencyKey ?? null,
      createdById: actor.userId,
    },
  });

  const { product: updated } = await addStockTx(tx, actor, {
    productId: product.id,
    quantity: data.quantity,
    unitCost,
    type: "ENTRY",
    occurredAt: entryDate,
    reason: "Entrada de estoque",
    notes: data.notes ?? null,
    stockEntryId: entry.id,
  });

  if (cashAccountId && totalCost) {
    const category = await getSystemCategory(tx, SYSTEM_CATEGORY.stockPurchase);
    await tx.financialTransaction.create({
      data: {
        cashAccountId,
        direction: "OUT",
        amount: totalCost.toFixed(2),
        categoryId: category.id,
        origin: "STOCK_PURCHASE",
        description: `Compra de ${data.quantity} un. de ${product.name}${data.supplier ? ` (${data.supplier})` : ""}`,
        paymentMethodId,
        occurredAt: entryDate,
        stockEntryId: entry.id,
        createdById: actor.userId,
      },
    });
  }

  await audit(tx, actor, {
    action: "stock.entry",
    entityType: "stock_entry",
    entityId: entry.id,
    summary: `Entrada de ${data.quantity} un. de ${product.name}`,
    after: {
      quantity: data.quantity,
      unitCost: unitCost ? unitCost.toNumber() : null,
      totalCost: totalCost ? totalCost.toNumber() : null,
      paidNow: cashAccountId !== null,
      stockAfter: updated.currentStock,
      averageCostAfter: numOrNull(updated.averageCost),
    },
    metadata: { quantity: data.quantity, amount: totalCost ? totalCost.toNumber() : null, productId: product.id },
  });
  return entry;
}

export async function registerStockEntry(actor: Actor, input: StockEntryInput) {
  const data = stockEntrySchema.parse(input);
  const findExisting = () =>
    data.idempotencyKey
      ? prisma.stockEntry.findUnique({ where: { idempotencyKey: data.idempotencyKey } })
      : Promise.resolve(null);
  return runIdempotent(
    data.idempotencyKey,
    () =>
      prisma.$transaction(async (tx) => {
        if (data.idempotencyKey) {
          const existing = await tx.stockEntry.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
          if (existing) return existing;
        }
        return registerStockEntryTx(tx, actor, input);
      }),
    findExisting,
  );
}

// ───────────────────────── Ajustes e custo ─────────────────────────

export async function adjustStock(actor: Actor, input: StockAdjustmentInput) {
  const data = stockAdjustmentSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const tz = await getTimezone(tx);
    const occurredAt = parseBusinessDateTime(data.occurredAt, tz, "a data do ajuste", "occurredAt");
    const product = await tx.product.findUnique({ where: { id: data.productId } });
    if (!product) throw new NotFoundError("Produto não encontrado.");

    const result =
      data.direction === "IN"
        ? await addStockTx(tx, actor, {
            productId: product.id,
            quantity: data.quantity,
            unitCost: null,
            type: "ADJUSTMENT_IN",
            occurredAt,
            reason: data.reason,
            notes: data.notes ?? null,
          })
        : await removeStockTx(tx, actor, {
            productId: product.id,
            quantity: data.quantity,
            type: "ADJUSTMENT_OUT",
            occurredAt,
            reason: data.reason,
            notes: data.notes ?? null,
          });

    await audit(tx, actor, {
      action: "stock.adjust",
      entityType: "product",
      entityId: product.id,
      summary: `Ajuste de estoque de ${product.name}: ${data.direction === "IN" ? "+" : "−"}${data.quantity} un.`,
      reason: data.reason,
      before: { currentStock: product.currentStock },
      after: { currentStock: result.product.currentStock },
      metadata: { quantity: data.direction === "IN" ? data.quantity : -data.quantity, productId: product.id },
    });
    return result.movement;
  });
}

/** Define manualmente o custo médio (ex.: custo não informado na entrada). Auditado. */
export async function setAverageCost(actor: Actor, input: SetAverageCostInput) {
  const data = setAverageCostSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${data.productId}::uuid FOR UPDATE`;
    const product = await tx.product.findUnique({ where: { id: data.productId } });
    if (!product) throw new NotFoundError("Produto não encontrado.");
    const cost = fromCents(data.unitCostCents);
    await tx.product.update({ where: { id: product.id }, data: { averageCost: cost.toFixed(4) } });

    let updatedSales = 0;
    if (data.applyToUnknownSales) {
      const items = await tx.saleItem.findMany({ where: { productId: product.id, unitCost: null } });
      for (const item of items) {
        await tx.saleItem.update({
          where: { id: item.id },
          data: { unitCost: cost.toFixed(4), totalCost: round2(cost.mul(item.quantity)).toFixed(2) },
        });
      }
      const saleIds = [...new Set(items.map((i) => i.saleId))];
      for (const saleId of saleIds) await recalculateSaleCostTx(tx, saleId);
      updatedSales = saleIds.length;
    }

    await audit(tx, actor, {
      action: "product.cost_change",
      entityType: "product",
      entityId: product.id,
      summary: `Custo médio de ${product.name} definido em ${cost.toFixed(2)}${updatedSales ? ` (aplicado a ${updatedSales} venda(s) sem custo)` : ""}`,
      reason: data.reason,
      before: { averageCost: numOrNull(product.averageCost) },
      after: { averageCost: cost.toNumber(), appliedToSales: updatedSales },
    });
    return { updatedSales };
  });
}

/** Recalcula o custo das mercadorias de uma venda a partir dos itens. */
export async function recalculateSaleCostTx(tx: Tx, saleId: string) {
  const items = await tx.saleItem.findMany({ where: { saleId } });
  const costComplete = items.every((i) => i.totalCost !== null);
  const costOfGoods = items.reduce((acc, i) => acc.add(dec(i.totalCost)), dec(0));
  await tx.sale.update({ where: { id: saleId }, data: { costOfGoods: costOfGoods.toFixed(2), costComplete } });
}

// ───────────────────────── Consultas ─────────────────────────

export const MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  ENTRY: "Entrada",
  SALE: "Venda",
  SALE_RETURN: "Devolução (cancelamento)",
  ADJUSTMENT_IN: "Ajuste (entrada)",
  ADJUSTMENT_OUT: "Ajuste (saída)",
};

export interface StockMovementView {
  id: string;
  number: number;
  occurredAt: string;
  productId: string;
  productName: string;
  type: StockMovementType;
  quantity: number;
  balanceAfter: number;
  unitCost: number | null;
  reason: string | null;
  notes: string | null;
  saleId: string | null;
  saleNumber: number | null;
  stockEntryId: string | null;
  stockEntryNumber: number | null;
  createdBy: string | null;
}

export async function listStockMovements(
  filters: { productId?: string; type?: StockMovementType; from?: Date; to?: Date } & PageParams,
): Promise<Paginated<StockMovementView>> {
  const { page, pageSize, skip, take } = pageArgs(filters);
  const where = {
    ...(filters.productId ? { productId: filters.productId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.from || filters.to
      ? { occurredAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lt: filters.to } : {}) } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { number: "desc" }],
      skip,
      take,
      include: {
        product: { select: { name: true } },
        sale: { select: { number: true } },
        stockEntry: { select: { number: true } },
      },
    }),
    prisma.stockMovement.count({ where }),
  ]);
  const userIds = [...new Set(rows.map((r) => r.createdById))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const userName = new Map(users.map((u) => [u.id, u.name]));
  return paginated(
    rows.map((m) => ({
      id: m.id,
      number: m.number,
      occurredAt: m.occurredAt.toISOString(),
      productId: m.productId,
      productName: m.product.name,
      type: m.type,
      quantity: m.quantity,
      balanceAfter: m.balanceAfter,
      unitCost: numOrNull(m.unitCost),
      reason: m.reason,
      notes: m.notes,
      saleId: m.saleId,
      saleNumber: m.sale?.number ?? null,
      stockEntryId: m.stockEntryId,
      stockEntryNumber: m.stockEntry?.number ?? null,
      createdBy: userName.get(m.createdById) ?? null,
    })),
    total,
    page,
    pageSize,
  );
}

export interface StockEntryView {
  id: string;
  number: number;
  productName: string;
  quantity: number;
  unitCost: number | null;
  totalCost: number | null;
  entryDate: string;
  supplier: string | null;
  documentNumber: string | null;
  notes: string | null;
  paidNow: boolean;
  paymentMethod: string | null;
}

export async function listStockEntries(
  filters: { productId?: string } & PageParams,
): Promise<Paginated<StockEntryView>> {
  const { page, pageSize, skip, take } = pageArgs(filters);
  const where = filters.productId ? { productId: filters.productId } : {};
  const [rows, total] = await Promise.all([
    prisma.stockEntry.findMany({
      where,
      orderBy: [{ entryDate: "desc" }, { number: "desc" }],
      skip,
      take,
      include: { product: { select: { name: true } }, paymentMethod: { select: { name: true } } },
    }),
    prisma.stockEntry.count({ where }),
  ]);
  return paginated(
    rows.map((e) => ({
      id: e.id,
      number: e.number,
      productName: e.product.name,
      quantity: e.quantity,
      unitCost: numOrNull(e.unitCost),
      totalCost: numOrNull(e.totalCost),
      entryDate: e.entryDate.toISOString(),
      supplier: e.supplier,
      documentNumber: e.documentNumber,
      notes: e.notes,
      paidNow: e.paidNow,
      paymentMethod: e.paymentMethod?.name ?? null,
    })),
    total,
    page,
    pageSize,
  );
}

export interface InventoryOverview {
  availableUnits: number;
  activeProducts: number;
  stockValue: number;
  stockValueComplete: boolean;
  lowStock: number;
  outOfStock: number;
  missingCost: number;
  minStockTotal: number;
}

export async function getInventoryOverview(db: Tx = prisma): Promise<InventoryOverview> {
  const products = await db.product.findMany({ where: { active: true } });
  let stockValue = dec(0);
  let complete = true;
  for (const p of products) {
    if (p.currentStock === 0) continue;
    if (p.averageCost === null) complete = false;
    else stockValue = stockValue.add(dec(p.averageCost).mul(p.currentStock));
  }
  return {
    availableUnits: products.reduce((acc, p) => acc + p.currentStock, 0),
    activeProducts: products.length,
    stockValue: num(stockValue),
    stockValueComplete: complete,
    lowStock: products.filter((p) => stockStatus(p) === "low").length,
    outOfStock: products.filter((p) => stockStatus(p) === "out").length,
    missingCost: products.filter((p) => p.averageCost === null).length,
    minStockTotal: products.reduce((acc, p) => acc + p.minStock, 0),
  };
}
