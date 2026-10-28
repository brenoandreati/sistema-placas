import "server-only";
import { todayString } from "@/lib/dates";
import { setupSchema, type SetupInput } from "@/lib/validation/finance";
import type { Actor } from "@/server/context";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { fromCents } from "@/server/money";
import { audit } from "./audit";
import { getDefaultCashAccount } from "./cash";
import { setOpeningBalance } from "./finance";
import { createProduct } from "./inventory";
import { getSettings } from "./settings";

/**
 * Configuração inicial (primeiro uso): nome do negócio, saldo inicial do caixa e produto principal
 * com o estoque inicial. O estoque inicial não gera saída de caixa (já foi pago antes da implantação).
 */
export async function completeInitialSetup(actor: Actor, input: SetupInput) {
  const data = setupSchema.parse(input);
  const settings = await getSettings();
  if (settings.setupCompletedAt) {
    throw new DomainError("A configuração inicial já foi concluída. Use Configurações para ajustes.", "SETUP_DONE");
  }

  await prisma.settings.update({
    where: { id: 1 },
    data: { businessName: data.businessName, displayName: data.displayName, defaultMinStock: data.minStock },
  });

  const account = await getDefaultCashAccount();
  await setOpeningBalance(
    actor,
    {
      cashAccountId: account.id,
      amountCents: data.openingBalanceCents,
      date: todayString(settings.timezone),
      reason: "Configuração inicial",
    },
    { initialSetup: true },
  );

  const existing = await prisma.product.findUnique({ where: { sku: data.productSku } });
  if (!existing) {
    await createProduct(actor, {
      name: data.productName,
      sku: data.productSku,
      salePriceCents: data.salePriceCents,
      minStock: data.minStock,
      active: true,
      category: "Placas NFC",
      initialQuantity: data.initialQuantity,
      initialUnitCostCents: data.unitCostCents ?? null,
      initialPaidNow: false,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.settings.update({
      where: { id: 1 },
      data: {
        setupCompletedAt: new Date(),
        defaultSalePrice: fromCents(data.salePriceCents).toFixed(2),
      },
    });
    await audit(tx, actor, {
      action: "settings.setup_complete",
      entityType: "settings",
      entityId: "1",
      summary: `Configuração inicial concluída para ${data.businessName}`,
    });
  });
}

/** Marca a configuração inicial como concluída sem alterar dados (usuário prefere configurar depois). */
export async function skipInitialSetup(actor: Actor) {
  await prisma.$transaction(async (tx) => {
    await tx.settings.update({ where: { id: 1 }, data: { setupCompletedAt: new Date() } });
    await audit(tx, actor, {
      action: "settings.setup_skipped",
      entityType: "settings",
      entityId: "1",
      summary: "Configuração inicial dispensada",
    });
  });
}
