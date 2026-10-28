// Dados de referência necessários para o sistema funcionar (sem dados fictícios de negócio).
// Executado pelo seed e pelos testes; é idempotente.
import type { PrismaClient } from "@/generated/prisma/client";
import type {
  FinancialCategoryGroup,
  PaymentMethodKind,
  TransactionDirection,
  WithdrawalKind,
} from "@/generated/prisma/enums";

type Db = Pick<PrismaClient, "settings" | "cashAccount" | "paymentMethod" | "financialCategory">;

export const SYSTEM_CATEGORY = {
  saleReceipt: "sale_receipt",
  saleRefund: "sale_refund",
  stockPurchase: "stock_purchase",
} as const;

const PAYMENT_METHODS: { name: string; kind: PaymentMethodKind }[] = [
  { name: "PIX", kind: "PIX" },
  { name: "Dinheiro", kind: "CASH" },
  { name: "Cartão", kind: "CARD" },
  { name: "Transferência bancária", kind: "BANK_TRANSFER" },
  { name: "Outro", kind: "OTHER" },
];

interface CategorySeed {
  name: string;
  group: FinancialCategoryGroup;
  direction: TransactionDirection;
  systemKey?: string;
  isDirectCost?: boolean;
  withdrawalKind?: WithdrawalKind;
}

const CATEGORIES: CategorySeed[] = [
  { name: "Recebimento de venda", group: "SALES_RECEIPT", direction: "IN", systemKey: SYSTEM_CATEGORY.saleReceipt },
  { name: "Estorno de pagamento", group: "SALES_REFUND", direction: "OUT", systemKey: SYSTEM_CATEGORY.saleRefund },
  { name: "Compra de estoque", group: "STOCK_PURCHASE", direction: "OUT", systemKey: SYSTEM_CATEGORY.stockPurchase },
  { name: "Frete", group: "EXPENSE", direction: "OUT", isDirectCost: true },
  { name: "Embalagens", group: "EXPENSE", direction: "OUT", isDirectCost: true },
  { name: "Taxas de pagamento", group: "EXPENSE", direction: "OUT", isDirectCost: true },
  { name: "Publicidade", group: "EXPENSE", direction: "OUT" },
  { name: "Outras despesas", group: "EXPENSE", direction: "OUT" },
  { name: "Retirada pessoal do proprietário", group: "WITHDRAWAL", direction: "OUT", withdrawalKind: "OWNER_DRAW" },
  { name: "Distribuição de lucros", group: "WITHDRAWAL", direction: "OUT", withdrawalKind: "PROFIT_DISTRIBUTION" },
  { name: "Reembolso", group: "WITHDRAWAL", direction: "OUT", withdrawalKind: "REIMBURSEMENT" },
  { name: "Outra retirada", group: "WITHDRAWAL", direction: "OUT", withdrawalKind: "OTHER" },
  { name: "Aporte de capital", group: "CAPITAL_CONTRIBUTION", direction: "IN" },
  { name: "Outras entradas", group: "OTHER_INCOME", direction: "IN" },
];

export async function ensureReferenceData(db: Db): Promise<void> {
  await db.settings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });

  const defaultAccount = await db.cashAccount.findFirst({ where: { isDefault: true } });
  if (!defaultAccount) {
    await db.cashAccount.upsert({
      where: { name: "Caixa principal" },
      create: { name: "Caixa principal", type: "CASH", isDefault: true },
      update: { isDefault: true },
    });
  }

  for (const [index, method] of PAYMENT_METHODS.entries()) {
    await db.paymentMethod.upsert({
      where: { name: method.name },
      create: { ...method, sortOrder: index },
      update: {},
    });
  }

  for (const [index, category] of CATEGORIES.entries()) {
    const where = category.systemKey
      ? { systemKey: category.systemKey }
      : { group_name: { group: category.group, name: category.name } };
    await db.financialCategory.upsert({
      where,
      create: { ...category, sortOrder: index },
      update: {},
    });
  }
}
