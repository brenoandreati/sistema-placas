import { randomUUID } from "node:crypto";
import { toLocalDateTimeInput } from "@/lib/dates";
import type { Actor } from "@/server/context";
import { prisma } from "@/server/db";
import { ensureReferenceData } from "@/server/reference-data";
import { getDefaultCashAccount } from "@/server/services/cash";
import { createCustomer } from "@/server/services/customers";
import { setOpeningBalance } from "@/server/services/finance";
import { createProduct } from "@/server/services/inventory";

export const TZ = "America/Sao_Paulo";

const TABLES = [
  "audit_logs",
  "qr_codes",
  "qr_code_batches",
  "financial_transactions",
  "payments",
  "stock_movements",
  "sale_items",
  "expenses",
  "withdrawals",
  "sales",
  "stock_entries",
  "customers",
  "products",
  "financial_categories",
  "payment_methods",
  "cash_accounts",
  "settings",
  "sessions",
  "login_attempts",
  "users",
];

/** Limpa o banco de testes (TRUNCATE não dispara os triggers de imutabilidade) e recria a base. */
export async function resetDatabase(): Promise<Actor> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await ensureReferenceData(prisma);
  const user = await prisma.user.create({
    data: { name: "Teste", email: `teste-${randomUUID()}@example.com`, passwordHash: "x", role: "ADMIN" },
  });
  return { userId: user.id };
}

export function now(): string {
  return toLocalDateTimeInput(new Date(), TZ);
}

export function key(): string {
  return randomUUID();
}

export async function paymentMethodId(name = "PIX"): Promise<string> {
  const method = await prisma.paymentMethod.findUniqueOrThrow({ where: { name } });
  return method.id;
}

export async function categoryId(name: string): Promise<string> {
  const category = await prisma.financialCategory.findFirstOrThrow({ where: { name } });
  return category.id;
}

export async function makeProduct(
  actor: Actor,
  options: { stock?: number; unitCostCents?: number | null; priceCents?: number; sku?: string; minStock?: number } = {},
) {
  return createProduct(actor, {
    name: "Placa NFC Avaliações Google",
    sku: options.sku ?? `NFC-${Math.floor(Math.random() * 1e6)}`,
    salePriceCents: options.priceCents ?? 3000,
    minStock: options.minStock ?? 10,
    active: true,
    initialQuantity: options.stock ?? 0,
    initialUnitCostCents: options.unitCostCents === undefined ? null : options.unitCostCents,
    initialPaidNow: false,
  });
}

export async function makeCustomer(actor: Actor, businessName = "Padaria Pão Dourado") {
  return createCustomer(actor, { businessName, contactName: "Maria Souza" });
}

export async function setBalance(actor: Actor, amountCents: number) {
  const account = await getDefaultCashAccount();
  await setOpeningBalance(actor, { cashAccountId: account.id, amountCents, date: now().slice(0, 10), reason: "Teste" });
}
