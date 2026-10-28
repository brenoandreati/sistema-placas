"use server";

import type {
  CancelSaleInput,
  CreateSaleInput,
  RefundPaymentInput,
  RegisterPaymentInput,
  SettleRefundInput,
  UpdateSaleInput,
} from "@/lib/validation/sales";
import { requireActor } from "@/server/auth/guard";
import { searchCustomerOptions } from "@/server/services/customers";
import {
  cancelSale,
  createSale,
  getSaleFormOptions,
  refundPayment,
  registerPayment,
  settlePendingRefund,
  updateSale,
  updateSaleStatus,
} from "@/server/services/sales";
import { runAction } from "./run";

export async function getSaleFormOptionsAction() {
  await requireActor("sales.write");
  const [options, customers] = await Promise.all([getSaleFormOptions(), searchCustomerOptions(undefined, 200)]);
  return { ...options, customers };
}

export async function createSaleAction(input: CreateSaleInput) {
  return runAction("sales.write", async (actor) => {
    const sale = await createSale(actor, input);
    return { id: sale.id, number: sale.number };
  });
}

export async function updateSaleAction(input: UpdateSaleInput) {
  return runAction("sales.write", async (actor) => {
    await updateSale(actor, input);
    return undefined;
  }, { message: "Venda atualizada." });
}

export async function updateSaleStatusAction(saleId: string, status: string) {
  return runAction("sales.write", async (actor) => {
    await updateSaleStatus(actor, { saleId, status });
    return undefined;
  }, { message: "Status atualizado." });
}

export async function registerPaymentAction(input: RegisterPaymentInput) {
  return runAction("sales.write", async (actor) => {
    const payment = await registerPayment(actor, input);
    return { id: payment.id };
  }, { message: "Pagamento registrado." });
}

export async function refundPaymentAction(input: RefundPaymentInput) {
  return runAction("sales.cancel", async (actor) => {
    const refund = await refundPayment(actor, input);
    return { id: refund.id };
  }, { message: "Estorno registrado." });
}

export async function cancelSaleAction(input: CancelSaleInput) {
  return runAction("sales.cancel", async (actor) => {
    await cancelSale(actor, input);
    return undefined;
  }, { message: "Venda cancelada." });
}

export async function settleRefundAction(input: SettleRefundInput) {
  return runAction("sales.cancel", async (actor) => {
    await settlePendingRefund(actor, input);
    return undefined;
  }, { message: "Devolução registrada." });
}
