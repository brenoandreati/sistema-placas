import "server-only";
import type { Settings } from "@/generated/prisma/client";
import { DEFAULT_TIMEZONE, isPeriodPreset, type PeriodPreset } from "@/lib/dates";
import { settingsSchema, type SettingsInput } from "@/lib/validation/finance";
import { qrBaseUrlSchema, type QrBaseUrlInput } from "@/lib/validation/qr-codes";
import type { Actor } from "@/server/context";
import { prisma, type Tx } from "@/server/db";
import { fromCents, numOrNull } from "@/server/money";
import { audit } from "./audit";

export async function getSettings(db: Tx = prisma): Promise<Settings> {
  const settings = await db.settings.findUnique({ where: { id: 1 } });
  if (settings) return settings;
  return db.settings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export interface SettingsView {
  businessName: string;
  displayName: string;
  currency: string;
  timezone: string;
  defaultSalePrice: number | null;
  defaultMinStock: number;
  defaultDueDays: number;
  recentWithdrawalDays: number;
  dashboardDefaultPeriod: PeriodPreset;
  pageSize: number;
  allowNegativeBalance: boolean;
  qrBaseUrl: string | null;
  setupCompleted: boolean;
}

export function toSettingsView(s: Settings): SettingsView {
  return {
    businessName: s.businessName,
    displayName: s.displayName,
    currency: s.currency,
    timezone: s.timezone || DEFAULT_TIMEZONE,
    defaultSalePrice: numOrNull(s.defaultSalePrice),
    defaultMinStock: s.defaultMinStock,
    defaultDueDays: s.defaultDueDays,
    recentWithdrawalDays: s.recentWithdrawalDays,
    dashboardDefaultPeriod: isPeriodPreset(s.dashboardDefaultPeriod) ? s.dashboardDefaultPeriod : "30d",
    pageSize: s.pageSize,
    allowNegativeBalance: s.allowNegativeBalance,
    qrBaseUrl: s.qrBaseUrl,
    setupCompleted: s.setupCompletedAt !== null,
  };
}

export async function getSettingsView(): Promise<SettingsView> {
  return toSettingsView(await getSettings());
}

export async function getTimezone(db: Tx = prisma): Promise<string> {
  const s = await getSettings(db);
  return s.timezone || DEFAULT_TIMEZONE;
}

export async function updateSettings(actor: Actor, input: SettingsInput): Promise<SettingsView> {
  const data = settingsSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await getSettings(tx);
    const updated = await tx.settings.update({
      where: { id: 1 },
      data: {
        businessName: data.businessName,
        displayName: data.displayName,
        timezone: data.timezone,
        defaultSalePrice:
          data.defaultSalePriceCents === null || data.defaultSalePriceCents === undefined
            ? null
            : fromCents(data.defaultSalePriceCents).toFixed(2),
        defaultMinStock: data.defaultMinStock,
        defaultDueDays: data.defaultDueDays,
        recentWithdrawalDays: data.recentWithdrawalDays,
        dashboardDefaultPeriod: data.dashboardDefaultPeriod,
        pageSize: data.pageSize,
        allowNegativeBalance: data.allowNegativeBalance,
      },
    });
    const beforeView = toSettingsView(before);
    const afterView = toSettingsView(updated);
    const changed = (Object.keys(afterView) as (keyof SettingsView)[]).filter(
      (key) => JSON.stringify(beforeView[key]) !== JSON.stringify(afterView[key]),
    );
    if (changed.length > 0) {
      await audit(tx, actor, {
        action: "settings.update",
        entityType: "settings",
        entityId: "1",
        summary: `Configurações atualizadas (${changed.join(", ")})`,
        before: Object.fromEntries(changed.map((k) => [k, beforeView[k]])),
        after: Object.fromEntries(changed.map((k) => [k, afterView[k]])),
      });
    }
    return afterView;
  });
}

/** Domínio gravado nos QR codes. Trocar depois de imprimir faz as placas antigas pararem de funcionar. */
export async function updateQrBaseUrl(actor: Actor, input: QrBaseUrlInput): Promise<SettingsView> {
  const { qrBaseUrl } = qrBaseUrlSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await getSettings(tx);
    const updated = await tx.settings.update({ where: { id: 1 }, data: { qrBaseUrl: qrBaseUrl ?? null } });
    if (before.qrBaseUrl !== updated.qrBaseUrl) {
      await audit(tx, actor, {
        action: "settings.update",
        entityType: "settings",
        entityId: "1",
        summary: updated.qrBaseUrl
          ? `Endereço dos QR codes definido como ${updated.qrBaseUrl}`
          : "Endereço dos QR codes removido",
        before: { qrBaseUrl: before.qrBaseUrl },
        after: { qrBaseUrl: updated.qrBaseUrl },
      });
    }
    return toSettingsView(updated);
  });
}
