import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/server/context";
import { prisma, type Tx } from "@/server/db";
import { pageArgs, paginated } from "@/server/pagination";

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

export async function listAuditLogs(params: { page?: number; pageSize?: number; entityType?: string }) {
  const { page, pageSize, skip, take } = pageArgs(params, 30);
  const where = params.entityType ? { entityType: params.entityType } : {};
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { user: { select: { name: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return paginated(
    rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      summary: r.summary,
      reason: r.reason,
      before: r.before,
      after: r.after,
      user: r.user?.name ?? null,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
  );
}
