import "server-only";
import { Prisma, type FollowUp } from "@/generated/prisma/client";
import {
  addDaysToDate,
  formatDateString,
  parseLocalDateTime,
  startOfLocalDay,
  todayString,
  toLocalDateString,
  toLocalDateTimeInput,
  type DateRange,
} from "@/lib/dates";
import {
  FOLLOW_UP_RESULT_LABELS,
  FOLLOW_UP_RESULT_STATUSES,
  INCONCLUSIVE_STATUSES,
  type FollowUpStatus,
  type FollowUpType,
} from "@/lib/follow-ups";
import { onlyDigits } from "@/lib/format";
import { customerSchema } from "@/lib/validation/customers";
import {
  cancelFollowUpSchema,
  createFollowUpSchema,
  followUpResultSchema,
  rescheduleFollowUpSchema,
  updateFollowUpSchema,
  type CancelFollowUpInput,
  type CreateFollowUpInput,
  type FollowUpResultInput,
  type RescheduleFollowUpInput,
  type UpdateFollowUpInput,
} from "@/lib/validation/follow-ups";
import type { Actor } from "@/server/context";
import { prisma, type Tx } from "@/server/db";
import { DomainError, NotFoundError } from "@/server/errors";
import { runIdempotent } from "@/server/guards";
import { pageArgs, paginated, type PageParams, type Paginated } from "@/server/pagination";
import { audit } from "./audit";
import { insertCustomer } from "./customers";
import { getTimezone } from "./settings";

// Agenda de retornos comerciais. Regras:
// - SCHEDULED é o único status pendente; registrar resultado, reagendar ou cancelar encerram o retorno
//   (completed_at preenchido; o banco garante a coerência por CHECK).
// - Nada é apagado: reagendar encerra o retorno atual como RESCHEDULED e cria o próximo ligado por previous_id;
//   cada mudança vira uma linha imutável em follow_up_events.
// - Datas e horários são informados no fuso do negócio (padrão America/Sao_Paulo) e gravados em UTC.
// - Um retorno nunca vira venda automaticamente.

const MIN_DATE = "2000-01-01";
const MAX_YEARS_AHEAD = 3;

function schedule(date: string, time: string | undefined, tz: string, field = "date") {
  const today = todayString(tz);
  if (date < MIN_DATE || date > addDaysToDate(today, 365 * MAX_YEARS_AHEAD)) {
    throw new DomainError("Informe uma data de retorno válida.", "INVALID_DATE", field);
  }
  const scheduledAt = time ? parseLocalDateTime(`${date}T${time}`, tz) : startOfLocalDay(date, tz);
  if (!scheduledAt) throw new DomainError("Informe a data e o horário corretamente.", "INVALID_DATE", field);
  return { scheduledAt, hasTime: Boolean(time) };
}

export interface FollowUpView {
  id: string;
  customer: { id: string; businessName: string } | null;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  scheduledAt: string;
  /** Data (yyyy-MM-dd) e horário (HH:mm, nulo se não definido) no fuso do negócio. */
  date: string;
  time: string | null;
  type: FollowUpType;
  reason: string;
  notes: string | null;
  status: FollowUpStatus;
  outcome: string | null;
  completedAt: string | null;
  previousId: string | null;
  /** Pendente com data anterior a hoje. */
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
}

const viewInclude = { customer: { select: { id: true, businessName: true } } } satisfies Prisma.FollowUpInclude;
type FollowUpWithCustomer = Prisma.FollowUpGetPayload<{ include: typeof viewInclude }>;

function toView(f: FollowUpWithCustomer, tz: string): FollowUpView {
  const date = toLocalDateString(f.scheduledAt, tz);
  return {
    id: f.id,
    customer: f.customer,
    businessName: f.businessName,
    contactName: f.contactName,
    phone: f.phone,
    scheduledAt: f.scheduledAt.toISOString(),
    date,
    time: f.hasTime ? toLocalDateTimeInput(f.scheduledAt, tz).slice(11, 16) : null,
    type: f.type,
    reason: f.reason,
    notes: f.notes,
    status: f.status,
    outcome: f.outcome,
    completedAt: f.completedAt?.toISOString() ?? null,
    previousId: f.previousId,
    overdue: f.status === "SCHEDULED" && date < todayString(tz),
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

function whenLabel(f: Pick<FollowUp, "scheduledAt" | "hasTime">, tz: string): string {
  const local = toLocalDateTimeInput(f.scheduledAt, tz);
  return f.hasTime
    ? `${formatDateString(local.slice(0, 10))} ${local.slice(11, 16)}`
    : formatDateString(local.slice(0, 10));
}

/** Cliente do retorno: um já cadastrado (dados de contato pré-preenchidos) ou um potencial cliente novo. */
async function resolveContact(
  tx: Tx,
  actor: Actor,
  data: {
    customerMode: "existing" | "new";
    customerId?: string;
    businessName?: string;
    contactName?: string;
    phone?: string;
  },
) {
  if (data.customerMode === "existing") {
    const customer = await tx.customer.findUnique({ where: { id: data.customerId! } });
    if (!customer) throw new NotFoundError("Cliente não encontrado.");
    return {
      customerId: customer.id,
      businessName: customer.businessName,
      contactName: data.contactName ?? customer.contactName,
      phone: data.phone ?? customer.whatsapp ?? customer.phone,
    };
  }
  // Potencial cliente: entra no cadastro de clientes (sem venda), sem duplicar quem já existe.
  const name = data.businessName!;
  const sameName = await tx.customer.findFirst({
    where: { businessName: { equals: name, mode: "insensitive" } },
    select: { businessName: true },
  });
  if (sameName) {
    throw new DomainError(
      `Já existe um cliente chamado ${sameName.businessName}. Selecione-o em “Cliente cadastrado”.`,
      "DUPLICATE_CUSTOMER",
      "businessName",
    );
  }
  const customer = await insertCustomer(
    tx,
    actor,
    customerSchema.parse({ businessName: name, contactName: data.contactName, phone: data.phone }),
  );
  return {
    customerId: customer.id,
    businessName: customer.businessName,
    contactName: customer.contactName,
    phone: customer.phone,
  };
}

async function findOrThrow(tx: Tx, id: string) {
  const followUp = await tx.followUp.findUnique({ where: { id }, include: viewInclude });
  if (!followUp) throw new NotFoundError("Retorno não encontrado.");
  return followUp;
}

/** Encerra um retorno pendente; falha se outra pessoa já o encerrou (evita processar duas vezes). */
async function closePending(
  tx: Tx,
  id: string,
  data: { status: FollowUpStatus; outcome?: string | null },
): Promise<void> {
  const { count } = await tx.followUp.updateMany({
    where: { id, status: "SCHEDULED" },
    data: { ...data, completedAt: new Date() },
  });
  if (count === 0) {
    throw new DomainError("Este retorno acabou de ser atualizado. Recarregue a página.", "FOLLOW_UP_CHANGED");
  }
}

export async function createFollowUp(actor: Actor, input: CreateFollowUpInput): Promise<FollowUpView> {
  const data = createFollowUpSchema.parse(input);
  const findExisting = async () => {
    const existing = await prisma.followUp.findUnique({
      where: { idempotencyKey: data.idempotencyKey! },
      include: viewInclude,
    });
    return existing ? toView(existing, await getTimezone()) : null;
  };
  return runIdempotent(
    data.idempotencyKey,
    () =>
      prisma.$transaction(async (tx) => {
        const tz = await getTimezone(tx);
        const when = schedule(data.date, data.time, tz);
        const contact = await resolveContact(tx, actor, data);
        const followUp = await tx.followUp.create({
          data: {
            ...contact,
            ...when,
            type: data.type,
            reason: data.reason,
            notes: data.notes ?? null,
            idempotencyKey: data.idempotencyKey ?? null,
            createdById: actor.userId,
          },
          include: viewInclude,
        });
        await tx.followUpEvent.create({
          data: {
            followUpId: followUp.id,
            action: "created",
            toStatus: "SCHEDULED",
            toScheduledAt: followUp.scheduledAt,
            userId: actor.userId,
          },
        });
        await audit(tx, actor, {
          action: "follow_up.create",
          entityType: "follow_up",
          entityId: followUp.id,
          summary: `Retorno com ${followUp.businessName} agendado para ${whenLabel(followUp, tz)}`,
          metadata: { customerId: followUp.customerId },
        });
        return toView(followUp, tz);
      }),
    findExisting,
  );
}

const EDITABLE = ["customerId", "businessName", "contactName", "phone", "type", "reason", "notes"] as const;

export async function updateFollowUp(actor: Actor, input: UpdateFollowUpInput): Promise<FollowUpView> {
  const { id, ...data } = updateFollowUpSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await findOrThrow(tx, id);
    const tz = await getTimezone(tx);
    const when = schedule(data.date, data.time, tz);
    const contact =
      data.customerMode === "existing" && data.customerId === before.customerId
        ? {
            customerId: before.customerId,
            businessName: before.businessName,
            contactName: data.contactName ?? null,
            phone: data.phone ?? null,
          }
        : await resolveContact(tx, actor, data);
    const next = { ...contact, type: data.type, reason: data.reason, notes: data.notes ?? null };
    const changes: Record<string, [unknown, unknown]> = {};
    for (const field of EDITABLE) {
      if ((before[field] ?? null) !== (next[field] ?? null)) changes[field] = [before[field], next[field]];
    }
    const dateChanged = before.scheduledAt.getTime() !== when.scheduledAt.getTime() || before.hasTime !== when.hasTime;
    if (dateChanged) changes.scheduledAt = [whenLabel(before, tz), whenLabel(when, tz)];
    if (Object.keys(changes).length === 0) return toView(before, tz);

    const updated = await tx.followUp.update({ where: { id }, data: { ...next, ...when }, include: viewInclude });
    await tx.followUpEvent.create({
      data: {
        followUpId: id,
        action: "updated",
        ...(dateChanged ? { fromScheduledAt: before.scheduledAt, toScheduledAt: updated.scheduledAt } : {}),
        changes: changes as Prisma.InputJsonValue,
        userId: actor.userId,
      },
    });
    await audit(tx, actor, {
      action: "follow_up.update",
      entityType: "follow_up",
      entityId: id,
      summary: `Retorno com ${updated.businessName} editado`,
      metadata: { fields: Object.keys(changes) },
    });
    return toView(updated, tz);
  });
}

/** Cria o próximo retorno a partir de um anterior (mesmo cliente e contato). */
async function createNext(
  tx: Tx,
  actor: Actor,
  from: FollowUp,
  when: { scheduledAt: Date; hasTime: boolean },
  overrides: { type?: FollowUpType; reason?: string },
  note: string,
) {
  const next = await tx.followUp.create({
    data: {
      customerId: from.customerId,
      businessName: from.businessName,
      contactName: from.contactName,
      phone: from.phone,
      ...when,
      type: overrides.type ?? from.type,
      reason: overrides.reason ?? from.reason,
      notes: from.notes,
      previousId: from.id,
      createdById: actor.userId,
    },
    include: viewInclude,
  });
  await tx.followUpEvent.create({
    data: {
      followUpId: next.id,
      action: "created",
      toStatus: "SCHEDULED",
      toScheduledAt: next.scheduledAt,
      note,
      userId: actor.userId,
    },
  });
  return next;
}

/** Registra o resultado do contato (realizado, sem contato, sem interesse, venda) e, se pedido, o próximo retorno. */
export async function recordFollowUpResult(
  actor: Actor,
  input: FollowUpResultInput,
): Promise<{ followUp: FollowUpView; next: FollowUpView | null }> {
  const data = followUpResultSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await findOrThrow(tx, data.id);
    const tz = await getTimezone(tx);
    if (before.status === "RESCHEDULED") {
      throw new DomainError(
        "Este retorno foi reagendado. Registre o resultado no retorno mais recente.",
        "RESCHEDULED",
      );
    }
    if (before.status === "CANCELLED") throw new DomainError("Este retorno foi cancelado.", "CANCELLED");
    const nextWhen = data.nextDate ? schedule(data.nextDate, data.nextTime, tz, "nextDate") : null;

    if (before.status === "SCHEDULED") {
      await closePending(tx, before.id, { status: data.status, outcome: data.outcome ?? null });
    } else {
      // Já tinha resultado: corrige o resultado mantendo a data de conclusão original.
      await tx.followUp.update({
        where: { id: before.id },
        data: { status: data.status, outcome: data.outcome ?? null },
      });
    }
    await tx.followUpEvent.create({
      data: {
        followUpId: before.id,
        action: "result",
        fromStatus: before.status,
        toStatus: data.status,
        note: data.outcome ?? null,
        userId: actor.userId,
      },
    });

    let next: FollowUpWithCustomer | null = null;
    if (nextWhen) {
      next = await createNext(
        tx,
        actor,
        before,
        nextWhen,
        { type: data.nextType, reason: data.nextReason },
        `Próximo contato após: ${FOLLOW_UP_RESULT_LABELS[data.status]}`,
      );
      await tx.followUpEvent.create({
        data: {
          followUpId: before.id,
          action: "next_scheduled",
          toScheduledAt: next.scheduledAt,
          userId: actor.userId,
        },
      });
    }
    await audit(tx, actor, {
      action: "follow_up.result",
      entityType: "follow_up",
      entityId: before.id,
      summary:
        `Retorno com ${before.businessName}: ${FOLLOW_UP_RESULT_LABELS[data.status]}` +
        (next ? ` · próximo em ${whenLabel(next, tz)}` : ""),
      metadata: { status: data.status, nextId: next?.id ?? null },
    });
    const after = await findOrThrow(tx, before.id);
    return { followUp: toView(after, tz), next: next ? toView(next, tz) : null };
  });
}

/**
 * Reagenda: o retorno pendente é encerrado como "Reagendado" (com a data antiga preservada) e um novo retorno é
 * criado na nova data. Em um retorno já encerrado (ex.: realizado), apenas agenda o próximo contato.
 */
export async function rescheduleFollowUp(actor: Actor, input: RescheduleFollowUpInput): Promise<FollowUpView> {
  const data = rescheduleFollowUpSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await findOrThrow(tx, data.id);
    if (before.status === "RESCHEDULED") {
      throw new DomainError("Este retorno já foi reagendado. Use o retorno mais recente.", "RESCHEDULED");
    }
    const tz = await getTimezone(tx);
    const when = schedule(data.date, data.time, tz);
    if (before.status === "SCHEDULED") {
      await closePending(tx, before.id, { status: "RESCHEDULED", outcome: data.note ?? before.outcome });
      await tx.followUpEvent.create({
        data: {
          followUpId: before.id,
          action: "rescheduled",
          fromStatus: "SCHEDULED",
          toStatus: "RESCHEDULED",
          fromScheduledAt: before.scheduledAt,
          toScheduledAt: when.scheduledAt,
          note: data.note ?? null,
          userId: actor.userId,
        },
      });
    } else {
      await tx.followUpEvent.create({
        data: {
          followUpId: before.id,
          action: "next_scheduled",
          toScheduledAt: when.scheduledAt,
          note: data.note ?? null,
          userId: actor.userId,
        },
      });
    }
    const next = await createNext(tx, actor, before, when, {}, `Reagendado de ${whenLabel(before, tz)}`);
    await audit(tx, actor, {
      action: "follow_up.reschedule",
      entityType: "follow_up",
      entityId: before.id,
      summary: `Retorno com ${before.businessName} reagendado de ${whenLabel(before, tz)} para ${whenLabel(next, tz)}`,
      reason: data.note ?? null,
      metadata: { nextId: next.id },
    });
    return toView(next, tz);
  });
}

export async function cancelFollowUp(actor: Actor, input: CancelFollowUpInput): Promise<FollowUpView> {
  const data = cancelFollowUpSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await findOrThrow(tx, data.id);
    if (before.status !== "SCHEDULED") {
      throw new DomainError("Só retornos agendados podem ser cancelados.", "NOT_SCHEDULED");
    }
    const tz = await getTimezone(tx);
    await closePending(tx, before.id, { status: "CANCELLED", outcome: data.reason ?? before.outcome });
    await tx.followUpEvent.create({
      data: {
        followUpId: before.id,
        action: "cancelled",
        fromStatus: "SCHEDULED",
        toStatus: "CANCELLED",
        note: data.reason ?? null,
        userId: actor.userId,
      },
    });
    await audit(tx, actor, {
      action: "follow_up.cancel",
      entityType: "follow_up",
      entityId: before.id,
      summary: `Retorno com ${before.businessName} (${whenLabel(before, tz)}) cancelado`,
      reason: data.reason ?? null,
    });
    return toView(await findOrThrow(tx, before.id), tz);
  });
}

// ───────────────────────── Consultas ─────────────────────────

function todayRange(tz: string): DateRange {
  const today = todayString(tz);
  return { start: startOfLocalDay(today, tz), end: startOfLocalDay(addDaysToDate(today, 1), tz) };
}

export interface AgendaSummary {
  /** Pendentes para hoje (e o total do dia, incluindo os já resolvidos). */
  today: number;
  todayTotal: number;
  upcoming: number;
  overdue: number;
  /** Resolvidos (realizado, sem contato, sem interesse, venda) no período. */
  completed: number;
  needsContact: number;
}

export async function getAgendaSummary(tz: string, period: DateRange): Promise<AgendaSummary> {
  const { start, end } = todayRange(tz);
  const [today, todayTotal, upcoming, overdue, completed, needsContact] = await Promise.all([
    prisma.followUp.count({ where: { status: "SCHEDULED", scheduledAt: { gte: start, lt: end } } }),
    prisma.followUp.count({ where: { status: { not: "CANCELLED" }, scheduledAt: { gte: start, lt: end } } }),
    prisma.followUp.count({ where: { status: "SCHEDULED", scheduledAt: { gte: end } } }),
    prisma.followUp.count({ where: { status: "SCHEDULED", scheduledAt: { lt: start } } }),
    prisma.followUp.count({
      where: {
        status: { in: [...FOLLOW_UP_RESULT_STATUSES] },
        completedAt: { gte: period.start, lt: period.end },
      },
    }),
    countNeedsContact(),
  ]);
  return { today, todayTotal, upcoming, overdue, completed, needsContact };
}

export type FollowUpStatusFilter = "pending" | "overdue" | "today" | "upcoming" | "all" | FollowUpStatus;

export interface FollowUpFilters extends PageParams {
  status?: FollowUpStatusFilter;
  type?: FollowUpType;
  search?: string;
  /** Datas yyyy-MM-dd (inclusive) no fuso do negócio. */
  from?: string;
  to?: string;
  customerId?: string;
}

export async function listFollowUps(filters: FollowUpFilters, tz: string): Promise<Paginated<FollowUpView>> {
  const { page, pageSize, skip, take } = pageArgs(filters);
  const { start, end } = todayRange(tz);
  const status = filters.status ?? "pending";
  const and: Prisma.FollowUpWhereInput[] = [];
  if (status === "pending") and.push({ status: "SCHEDULED" });
  else if (status === "overdue") and.push({ status: "SCHEDULED", scheduledAt: { lt: start } });
  else if (status === "today") and.push({ status: "SCHEDULED", scheduledAt: { gte: start, lt: end } });
  else if (status === "upcoming") and.push({ status: "SCHEDULED", scheduledAt: { gte: end } });
  else if (status !== "all") and.push({ status });
  if (filters.type) and.push({ type: filters.type });
  if (filters.customerId) and.push({ customerId: filters.customerId });
  if (filters.from) and.push({ scheduledAt: { gte: startOfLocalDay(filters.from, tz) } });
  if (filters.to) and.push({ scheduledAt: { lt: startOfLocalDay(addDaysToDate(filters.to, 1), tz) } });
  const search = filters.search?.trim();
  if (search) {
    const digits = onlyDigits(search);
    and.push({
      OR: [
        { businessName: { contains: search, mode: "insensitive" } },
        { contactName: { contains: search, mode: "insensitive" } },
        { reason: { contains: search, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
    });
  }
  const where: Prisma.FollowUpWhereInput = and.length ? { AND: and } : {};
  // Pendentes: do mais antigo (atrasados primeiro) ao mais distante. Histórico: do mais recente ao mais antigo.
  const ascending = ["pending", "overdue", "today", "upcoming", "SCHEDULED"].includes(status);
  const [rows, total] = await Promise.all([
    prisma.followUp.findMany({
      where,
      include: viewInclude,
      orderBy: [{ scheduledAt: ascending ? "asc" : "desc" }, { createdAt: "asc" }],
      skip,
      take,
    }),
    prisma.followUp.count({ where }),
  ]);
  return paginated(
    rows.map((r) => toView(r, tz)),
    total,
    page,
    pageSize,
  );
}

/** Todos os retornos de um intervalo (calendário e dia), em ordem cronológica. */
export async function listFollowUpsInRange(range: DateRange, tz: string): Promise<FollowUpView[]> {
  const rows = await prisma.followUp.findMany({
    where: { scheduledAt: { gte: range.start, lt: range.end } },
    include: viewInclude,
    orderBy: [{ scheduledAt: "asc" }, { hasTime: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => toView(r, tz));
}

export async function listOverdueFollowUps(tz: string, limit = 50): Promise<FollowUpView[]> {
  const rows = await prisma.followUp.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lt: todayRange(tz).start } },
    include: viewInclude,
    orderBy: { scheduledAt: "asc" },
    take: limit,
  });
  return rows.map((r) => toView(r, tz));
}

export interface FollowUpEventView {
  id: string;
  action: string;
  fromStatus: FollowUpStatus | null;
  toStatus: FollowUpStatus | null;
  fromScheduledAt: string | null;
  toScheduledAt: string | null;
  note: string | null;
  changes: Record<string, [unknown, unknown]> | null;
  user: string | null;
  createdAt: string;
}

export interface FollowUpDetail {
  followUp: FollowUpView;
  events: FollowUpEventView[];
  previous: FollowUpView | null;
  next: FollowUpView[];
}

export async function getFollowUpDetail(id: string, tz: string): Promise<FollowUpDetail | null> {
  const followUp = await prisma.followUp.findUnique({
    where: { id },
    include: {
      ...viewInclude,
      previous: { include: viewInclude },
      next: { include: viewInclude, orderBy: { scheduledAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!followUp) return null;
  const userIds = [...new Set(followUp.events.map((e) => e.userId))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    followUp: toView(followUp, tz),
    previous: followUp.previous ? toView(followUp.previous, tz) : null,
    next: followUp.next.map((n) => toView(n, tz)),
    events: followUp.events.map((e) => ({
      id: e.id,
      action: e.action,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      fromScheduledAt: e.fromScheduledAt?.toISOString() ?? null,
      toScheduledAt: e.toScheduledAt?.toISOString() ?? null,
      note: e.note,
      changes: (e.changes as Record<string, [unknown, unknown]> | null) ?? null,
      user: names.get(e.userId) ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

export interface CustomerFollowUpHistory {
  items: FollowUpView[];
  /** Próximo retorno pendente (o mais próximo, inclusive atrasado). */
  next: FollowUpView | null;
  /** Último contato resolvido sem desfecho e sem novo retorno agendado. */
  needsContact: boolean;
}

export async function getCustomerFollowUps(customerId: string, tz: string): Promise<CustomerFollowUpHistory> {
  const rows = await prisma.followUp.findMany({
    where: { customerId },
    include: viewInclude,
    orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
  });
  const items = rows.map((r) => toView(r, tz));
  const pending = items
    .filter((i) => i.status === "SCHEDULED")
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const latest = items.find((i) => i.status !== "CANCELLED");
  return {
    items,
    next: pending[0] ?? null,
    needsContact: !pending.length && !!latest && INCONCLUSIVE_STATUSES.includes(latest.status),
  };
}

/** Resumo para o dashboard: atrasados, hoje e os próximos pendentes (atrasados primeiro). */
export async function getUpcomingFollowUps(tz: string, limit = 5) {
  const { start, end } = todayRange(tz);
  const [overdue, today, rows] = await Promise.all([
    prisma.followUp.count({ where: { status: "SCHEDULED", scheduledAt: { lt: start } } }),
    prisma.followUp.count({ where: { status: "SCHEDULED", scheduledAt: { gte: start, lt: end } } }),
    prisma.followUp.findMany({
      where: { status: "SCHEDULED" },
      include: viewInclude,
      orderBy: { scheduledAt: "asc" },
      take: limit,
    }),
  ]);
  return { overdue, today, todayDate: todayString(tz), items: rows.map((r) => toView(r, tz)) };
}

// Clientes cujo último contato terminou sem desfecho (realizado sem venda/recusa, ou sem contato), sem retorno
// pendente e sem venda depois desse contato.
const NEEDS_CONTACT_SQL = Prisma.sql`
  WITH latest AS (
    SELECT DISTINCT ON (customer_id) id, customer_id, status, completed_at
      FROM follow_ups
     WHERE customer_id IS NOT NULL AND status <> 'CANCELLED'
     ORDER BY customer_id, scheduled_at DESC, created_at DESC
  )
  SELECT l.id
    FROM latest l
   WHERE l.status IN ('DONE', 'NO_CONTACT')
     AND NOT EXISTS (SELECT 1 FROM follow_ups s WHERE s.customer_id = l.customer_id AND s.status = 'SCHEDULED')
     AND NOT EXISTS (
       SELECT 1 FROM sales sa
        WHERE sa.customer_id = l.customer_id AND sa.status <> 'CANCELLED'
          -- A data da venda tem precisão de minutos: vale também a hora em que ela foi registrada.
          AND (sa.sale_date >= l.completed_at OR sa.created_at >= l.completed_at)
     )
   ORDER BY l.completed_at DESC`;

async function countNeedsContact(): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM (${NEEDS_CONTACT_SQL}) t`;
  return Number(rows[0]?.count ?? 0);
}

export async function listNeedsContact(tz: string, limit = 20): Promise<FollowUpView[]> {
  const ids = await prisma.$queryRaw<{ id: string }[]>`${NEEDS_CONTACT_SQL} LIMIT ${limit}`;
  if (ids.length === 0) return [];
  const rows = await prisma.followUp.findMany({
    where: { id: { in: ids.map((r) => r.id) } },
    include: viewInclude,
    orderBy: { completedAt: "desc" },
  });
  return rows.map((r) => toView(r, tz));
}

/** Clientes para o seletor do formulário (com telefone/WhatsApp para pré-preencher o contato). */
export async function listFollowUpCustomerOptions() {
  return prisma.customer.findMany({
    where: { active: true },
    orderBy: { businessName: "asc" },
    take: 1000,
    select: { id: true, businessName: true, contactName: true, phone: true, whatsapp: true },
  });
}
