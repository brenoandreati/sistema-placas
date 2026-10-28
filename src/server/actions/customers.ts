"use server";

import type { CustomerInput, QuickCustomerInput, UpdateCustomerInput } from "@/lib/validation/customers";
import { requireActor } from "@/server/auth/guard";
import {
  createCustomer,
  createQuickCustomer,
  deleteCustomer,
  searchCustomerOptions,
  setCustomerActive,
  updateCustomer,
} from "@/server/services/customers";
import { runAction } from "./run";

export async function createCustomerAction(input: CustomerInput) {
  return runAction("customers.write", async (actor) => {
    const customer = await createCustomer(actor, input);
    return { id: customer.id };
  }, { message: "Cliente cadastrado." });
}

/** Cadastro rápido dentro do formulário de venda: devolve o cliente para seleção imediata. */
export async function quickCreateCustomerAction(input: QuickCustomerInput) {
  return runAction(
    "customers.write",
    async (actor) => {
      const c = await createQuickCustomer(actor, input);
      return { id: c.id, businessName: c.businessName, contactName: c.contactName, phone: c.phone, address: c.address, city: c.city, state: c.state };
    },
    { revalidate: false, message: "Cliente cadastrado." },
  );
}

export async function updateCustomerAction(input: UpdateCustomerInput) {
  return runAction("customers.write", async (actor) => {
    const customer = await updateCustomer(actor, input);
    return { id: customer.id };
  }, { message: "Cadastro atualizado." });
}

export async function setCustomerActiveAction(customerId: string, active: boolean) {
  return runAction("customers.write", async (actor) => {
    await setCustomerActive(actor, customerId, active);
    return { active };
  }, { message: active ? "Cliente reativado." : "Cliente desativado." });
}

export async function deleteCustomerAction(customerId: string) {
  return runAction("customers.delete", async (actor) => {
    await deleteCustomer(actor, customerId);
    return undefined;
  }, { message: "Cliente excluído." });
}

export async function searchCustomersAction(search: string) {
  await requireActor("sales.read");
  return searchCustomerOptions(search, 30);
}
