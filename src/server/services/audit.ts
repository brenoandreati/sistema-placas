import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/server/context";
import type { Tx } from "@/server/db";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  reason?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
}

/** Registra uma operação no log de auditoria (sempre dentro da mesma transação da operação). */
export async function audit(tx: Tx, actor: Actor, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: actor.userId,
      ipAddress: actor.ipAddress ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      reason: entry.reason ?? null,
      before: entry.before,
      after: entry.after,
      metadata: entry.metadata,
    },
  });
}
