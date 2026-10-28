"use server";

import type {
  CreateProductInput,
  SetAverageCostInput,
  StockAdjustmentInput,
  StockEntryInput,
  UpdateProductInput,
} from "@/lib/validation/inventory";
import { requireActor } from "@/server/auth/guard";
import { listPaymentMethods } from "@/server/services/finance";
import {
  adjustStock,
  createProduct,
  listProducts,
  registerStockEntry,
  setAverageCost,
  updateProduct,
} from "@/server/services/inventory";
import { getSettings } from "@/server/services/settings";
import { runAction } from "./run";

export async function createProductAction(input: CreateProductInput) {
  return runAction(
    "inventory.write",
    async (actor) => {
      const product = await createProduct(actor, input);
      return { id: product.id };
    },
    { message: "Produto cadastrado." },
  );
}

export async function updateProductAction(input: UpdateProductInput) {
  return runAction(
    "inventory.write",
    async (actor) => {
      const product = await updateProduct(actor, input);
      return { id: product.id };
    },
    { message: "Produto atualizado." },
  );
}

export async function registerStockEntryAction(input: StockEntryInput) {
  return runAction(
    "inventory.write",
    async (actor) => {
      const entry = await registerStockEntry(actor, input);
      return { id: entry.id, number: entry.number };
    },
    { message: "Entrada registrada. Estoque atualizado." },
  );
}

export async function adjustStockAction(input: StockAdjustmentInput) {
  return runAction(
    "inventory.write",
    async (actor) => {
      const movement = await adjustStock(actor, input);
      return { id: movement.id };
    },
    { message: "Ajuste registrado." },
  );
}

export async function setAverageCostAction(input: SetAverageCostInput) {
  return runAction("inventory.cost", (actor) => setAverageCost(actor, input), { message: "Custo atualizado." });
}

export async function getStockFormOptionsAction() {
  await requireActor("inventory.write");
  const [products, paymentMethods, settings] = await Promise.all([listProducts(), listPaymentMethods(), getSettings()]);
  return {
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      currentStock: p.currentStock,
      averageCost: p.averageCost,
      lastPurchaseCost: p.lastPurchaseCost,
    })),
    paymentMethods,
    timezone: settings.timezone,
  };
}
