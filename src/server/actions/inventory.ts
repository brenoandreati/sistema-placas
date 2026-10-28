"use server";

import type {
  CreateProductInput,
  SetAverageCostInput,
  StockAdjustmentInput,
  StockEntryInput,
  UpdateProductInput,
} from "@/lib/validation/inventory";
import {
  adjustStock,
  createProduct,
  registerStockEntry,
  setAverageCost,
  updateProduct,
} from "@/server/services/inventory";
import { runAction } from "./run";

export async function createProductAction(input: CreateProductInput) {
  return runAction("inventory.write", async (actor) => {
    const product = await createProduct(actor, input);
    return { id: product.id };
  }, { message: "Produto cadastrado." });
}

export async function updateProductAction(input: UpdateProductInput) {
  return runAction("inventory.write", async (actor) => {
    const product = await updateProduct(actor, input);
    return { id: product.id };
  }, { message: "Produto atualizado." });
}

export async function registerStockEntryAction(input: StockEntryInput) {
  return runAction("inventory.write", async (actor) => {
    const entry = await registerStockEntry(actor, input);
    return { id: entry.id, number: entry.number };
  }, { message: "Entrada registrada. Estoque atualizado." });
}

export async function adjustStockAction(input: StockAdjustmentInput) {
  return runAction("inventory.write", async (actor) => {
    const movement = await adjustStock(actor, input);
    return { id: movement.id };
  }, { message: "Ajuste registrado." });
}

export async function setAverageCostAction(input: SetAverageCostInput) {
  return runAction("inventory.cost", (actor) => setAverageCost(actor, input), { message: "Custo atualizado." });
}
