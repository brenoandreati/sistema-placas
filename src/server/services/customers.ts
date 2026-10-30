import "server-only";
import { Prisma, type Customer } from "@/generated/prisma/client";
import {
  customerSchema,
  quickCustomerSchema,
  updateCustomerSchema,
  type CustomerData,
  type CustomerInput,
  type QuickCustomerInput,
  type UpdateCustomerInput,
} from "@/lib/validation/customers";
import { formatCnpj, formatPhone } from "@/lib/format";
import type { Actor } from "@/server/context";
import { prisma, type Tx } from "@/server/db";
import { DomainError, NotFoundError } from "@/server/errors";
import { num } from "@/server/money";
import { pageArgs, paginated, type PageParams, type Paginated } from "@/server/pagination";
import { audit } from "./audit";

export interface CustomerView {
  id: string;
  businessName: string;
  contactName: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  segment: string | null;
  cnpj: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  notes: string | null;
  googleReviewUrl: string | null;
  publicPlaceName: string | null;
  plateCustomizationNotes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toCustomerView(c: Customer): CustomerView {
  return {
    id: c.id,
    businessName: c.businessName,
    contactName: c.contactName,
    legalName: c.legalName,
    email: c.email,
    phone: c.phone,
    whatsapp: c.whatsapp,
    segment: c.segment,
    cnpj: c.cnpj,
    address: c.address,
    city: c.city,
    state: c.state,
    zipCode: c.zipCode,
    notes: c.notes,
    googleReviewUrl: c.googleReviewUrl,
    publicPlaceName: c.publicPlaceName,
    plateCustomizationNotes: c.plateCustomizationNotes,
    active: c.active,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function toDbData(data: CustomerData) {
  return {
    businessName: data.businessName,
    contactName: data.contactName,
    legalName: data.legalName ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    whatsapp: data.whatsapp ?? null,
    segment: data.segment ?? null,
    cnpj: data.cnpj ?? null,
    address: data.address ?? null,
    city: data.city ?? null,
    state: data.state ?? null,
    zipCode: data.zipCode ?? null,
    notes: data.notes ?? null,
    googleReviewUrl: data.googleReviewUrl ?? null,
    publicPlaceName: data.publicPlaceName ?? null,
    plateCustomizationNotes: data.plateCustomizationNotes ?? null,
  };
}

/** Evita duplicidades evidentes: mesmo CNPJ, e-mail ou telefone de outro cliente. */
async function assertNoDuplicate(tx: Tx, data: Pick<CustomerData, "cnpj" | "email" | "phone">, exceptId?: string) {
  const checks: { field: "cnpj" | "email" | "phone"; label: string; value: string | undefined; display: string }[] = [
    { field: "cnpj", label: "CNPJ", value: data.cnpj, display: formatCnpj(data.cnpj) },
    { field: "email", label: "e-mail", value: data.email, display: data.email ?? "" },
    { field: "phone", label: "telefone", value: data.phone, display: formatPhone(data.phone) },
  ];
  for (const check of checks) {
    if (!check.value) continue;
    const existing = await tx.customer.findFirst({
      where: {
        [check.field]: check.field === "email" ? { equals: check.value, mode: "insensitive" } : check.value,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true, businessName: true },
    });
    if (existing) {
      throw new DomainError(
        `Já existe um cliente com o ${check.label} ${check.display}: ${existing.businessName}.`,
        "DUPLICATE_CUSTOMER",
        check.field,
      );
    }
  }
}

export async function createCustomer(actor: Actor, input: CustomerInput): Promise<CustomerView> {
  const data = customerSchema.parse(input);
  return prisma.$transaction(async (tx) => toCustomerView(await insertCustomer(tx, actor, data)));
}

/** Cadastra o cliente dentro de uma transação já aberta (também usado pela agenda de retornos). */
export async function insertCustomer(tx: Tx, actor: Actor, data: CustomerData): Promise<Customer> {
  await assertNoDuplicate(tx, data);
  const customer = await tx.customer.create({ data: toDbData(data) });
  await audit(tx, actor, {
    action: "customer.create",
    entityType: "customer",
    entityId: customer.id,
    summary: `Cliente ${customer.businessName} cadastrado`,
  });
  return customer;
}

/** Cadastro mínimo feito durante o registro de uma venda. */
export async function createQuickCustomer(actor: Actor, input: QuickCustomerInput): Promise<CustomerView> {
  const data = quickCustomerSchema.parse(input);
  return createCustomer(actor, data);
}

export async function updateCustomer(actor: Actor, input: UpdateCustomerInput): Promise<CustomerView> {
  const { customerId, ...rest } = updateCustomerSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.customer.findUnique({ where: { id: customerId } });
    if (!before) throw new NotFoundError("Cliente não encontrado.");
    await assertNoDuplicate(tx, rest, customerId);
    const updated = await tx.customer.update({ where: { id: customerId }, data: toDbData(rest) });
    const beforeView = toCustomerView(before);
    const afterView = toCustomerView(updated);
    const fields = Object.keys(toDbData(rest)) as (keyof CustomerView)[];
    const changed = fields.filter((f) => beforeView[f] !== afterView[f]);
    if (changed.length > 0) {
      await audit(tx, actor, {
        action: "customer.update",
        entityType: "customer",
        entityId: customerId,
        summary: `Cadastro de ${updated.businessName} atualizado`,
        before: Object.fromEntries(changed.map((f) => [f, beforeView[f]])),
        after: Object.fromEntries(changed.map((f) => [f, afterView[f]])),
      });
    }
    return afterView;
  });
}

export async function setCustomerActive(actor: Actor, customerId: string, active: boolean): Promise<CustomerView> {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundError("Cliente não encontrado.");
    const updated = await tx.customer.update({ where: { id: customerId }, data: { active } });
    await audit(tx, actor, {
      action: active ? "customer.reactivate" : "customer.deactivate",
      entityType: "customer",
      entityId: customerId,
      summary: `Cliente ${customer.businessName} ${active ? "reativado" : "desativado"}`,
    });
    return toCustomerView(updated);
  });
}

/** Exclusão definitiva só é permitida para clientes sem vendas; caso contrário, desative. */
export async function deleteCustomer(actor: Actor, customerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundError("Cliente não encontrado.");
    const sales = await tx.sale.count({ where: { customerId } });
    if (sales > 0) {
      throw new DomainError(
        `${customer.businessName} possui ${sales} venda(s) registrada(s). Desative o cadastro para preservar o histórico.`,
        "CUSTOMER_HAS_SALES",
      );
    }
    await tx.customer.delete({ where: { id: customerId } });
    await audit(tx, actor, {
      action: "customer.delete",
      entityType: "customer",
      entityId: customerId,
      summary: `Cliente ${customer.businessName} excluído (sem vendas)`,
      before: { ...toCustomerView(customer) },
    });
  });
}

// ───────────────────────── Consultas ─────────────────────────

export interface CustomerListItem {
  id: string;
  businessName: string;
  contactName: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  active: boolean;
  orders: number;
  units: number;
  totalPurchased: number;
  totalPaid: number;
  pending: number;
  lastPurchaseAt: string | null;
  /** Próximo retorno agendado (agenda de retornos), se houver. */
  nextFollowUpAt: string | null;
  createdAt: string;
}

export interface CustomerFilters extends PageParams {
  search?: string;
  purchase?: "all" | "with" | "without";
  lastPurchaseFrom?: Date;
  lastPurchaseTo?: Date;
  includeInactive?: boolean;
  /** Com ou sem retorno agendado na agenda de retornos. */
  followUp?: "scheduled" | "none";
  sort?: "name" | "recent" | "total" | "created";
}

interface CustomerRow {
  id: string;
  business_name: string;
  contact_name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  active: boolean;
  created_at: Date;
  orders: bigint | number;
  units: bigint | number | null;
  total_purchased: Prisma.Decimal | string | null;
  total_paid: Prisma.Decimal | string | null;
  last_purchase_at: Date | null;
  next_follow_up_at: Date | null;
  full_count: bigint | number;
}

export async function listCustomers(filters: CustomerFilters): Promise<Paginated<CustomerListItem>> {
  const { page, pageSize, skip, take } = pageArgs(filters);
  const conditions: Prisma.Sql[] = [];
  if (!filters.includeInactive) conditions.push(Prisma.sql`c.active = true`);
  const search = filters.search?.trim();
  if (search) {
    const like = `%${search}%`;
    const digits = search.replace(/\D/g, "");
    conditions.push(
      Prisma.sql`(c.business_name ILIKE ${like} OR c.contact_name ILIKE ${like} OR c.email ILIKE ${like} OR c.legal_name ILIKE ${like}${
        digits.length >= 3
          ? Prisma.sql` OR c.phone LIKE ${`%${digits}%`} OR c.whatsapp LIKE ${`%${digits}%`} OR c.cnpj LIKE ${`%${digits}%`}`
          : Prisma.empty
      })`,
    );
  }
  if (filters.purchase === "with") conditions.push(Prisma.sql`COALESCE(s.orders, 0) > 0`);
  if (filters.purchase === "without") conditions.push(Prisma.sql`COALESCE(s.orders, 0) = 0`);
  if (filters.lastPurchaseFrom) conditions.push(Prisma.sql`s.last_purchase_at >= ${filters.lastPurchaseFrom}`);
  if (filters.lastPurchaseTo) conditions.push(Prisma.sql`s.last_purchase_at < ${filters.lastPurchaseTo}`);
  const scheduledFollowUp = Prisma.sql`EXISTS (SELECT 1 FROM follow_ups f WHERE f.customer_id = c.id AND f.status = 'SCHEDULED')`;
  if (filters.followUp === "scheduled") conditions.push(scheduledFollowUp);
  if (filters.followUp === "none") conditions.push(Prisma.sql`NOT ${scheduledFollowUp}`);
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

  const orderBy = {
    name: Prisma.sql`lower(c.business_name) ASC`,
    recent: Prisma.sql`s.last_purchase_at DESC NULLS LAST, lower(c.business_name) ASC`,
    total: Prisma.sql`COALESCE(s.total_purchased, 0) DESC, lower(c.business_name) ASC`,
    created: Prisma.sql`c.created_at DESC`,
  }[filters.sort ?? "name"];

  const rows = await prisma.$queryRaw<CustomerRow[]>`
    WITH sale_stats AS (
      SELECT sa.customer_id,
             COUNT(*) AS orders,
             SUM(si.units) AS units,
             SUM(sa.total) AS total_purchased,
             SUM(sa.amount_paid) AS total_paid,
             MAX(sa.sale_date) AS last_purchase_at
        FROM sales sa
        LEFT JOIN (SELECT sale_id, SUM(quantity) AS units FROM sale_items GROUP BY sale_id) si ON si.sale_id = sa.id
       WHERE sa.status <> 'CANCELLED'
       GROUP BY sa.customer_id
    )
    SELECT c.id, c.business_name, c.contact_name, c.phone, c.whatsapp, c.email, c.city, c.state, c.active, c.created_at,
           COALESCE(s.orders, 0) AS orders, COALESCE(s.units, 0) AS units,
           COALESCE(s.total_purchased, 0) AS total_purchased, COALESCE(s.total_paid, 0) AS total_paid,
           s.last_purchase_at,
           (SELECT MIN(f.scheduled_at) FROM follow_ups f WHERE f.customer_id = c.id AND f.status = 'SCHEDULED')
             AS next_follow_up_at,
           COUNT(*) OVER() AS full_count
      FROM customers c
      LEFT JOIN sale_stats s ON s.customer_id = c.id
      ${where}
     ORDER BY ${orderBy}
     LIMIT ${take} OFFSET ${skip}`;

  const total = rows.length > 0 ? Number(rows[0].full_count) : await countCustomers(where);
  return paginated(
    rows.map((r) => {
      const totalPurchased = num(r.total_purchased);
      const totalPaid = num(r.total_paid);
      return {
        id: r.id,
        businessName: r.business_name,
        contactName: r.contact_name,
        phone: r.phone,
        whatsapp: r.whatsapp,
        email: r.email,
        city: r.city,
        state: r.state,
        active: r.active,
        orders: Number(r.orders),
        units: Number(r.units ?? 0),
        totalPurchased,
        totalPaid,
        pending: Math.max(0, Math.round((totalPurchased - totalPaid) * 100) / 100),
        lastPurchaseAt: r.last_purchase_at ? new Date(r.last_purchase_at).toISOString() : null,
        nextFollowUpAt: r.next_follow_up_at ? new Date(r.next_follow_up_at).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
      };
    }),
    total,
    page,
    pageSize,
  );
}

async function countCustomers(where: Prisma.Sql): Promise<number> {
  // Quando a página pedida está além do fim, ainda precisamos do total para a paginação.
  const result = await prisma.$queryRaw<{ count: bigint }[]>`
    WITH sale_stats AS (
      SELECT customer_id, COUNT(*) AS orders, MAX(sale_date) AS last_purchase_at
        FROM sales WHERE status <> 'CANCELLED' GROUP BY customer_id
    )
    SELECT COUNT(*) AS count FROM customers c LEFT JOIN sale_stats s ON s.customer_id = c.id ${where}`;
  return Number(result[0]?.count ?? 0);
}

/** Lista compacta para seletores (formulário de venda). */
export async function searchCustomerOptions(search?: string, limit = 50) {
  const term = search?.trim();
  const digits = term?.replace(/\D/g, "") ?? "";
  const customers = await prisma.customer.findMany({
    where: {
      active: true,
      ...(term
        ? {
            OR: [
              { businessName: { contains: term, mode: "insensitive" } },
              { contactName: { contains: term, mode: "insensitive" } },
              ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
            ],
          }
        : {}),
    },
    orderBy: { businessName: "asc" },
    take: limit,
    select: { id: true, businessName: true, contactName: true, phone: true, address: true, city: true, state: true },
  });
  return customers;
}

export async function getCustomer(customerId: string): Promise<CustomerView | null> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  return customer ? toCustomerView(customer) : null;
}

// ───────────────────────── Ficha do cliente ─────────────────────────

export interface CustomerDetail {
  customer: CustomerView;
  summary: {
    orders: number;
    units: number;
    totalPurchased: number;
    totalPaid: number;
    pending: number;
    refundDue: number;
    lastPurchaseAt: string | null;
    firstPurchaseAt: string | null;
    cancelledOrders: number;
  };
  sales: {
    id: string;
    number: number;
    saleDate: string;
    units: number;
    total: number;
    amountPaid: number;
    pending: number;
    status: string;
    paymentStatus: string;
    dueDate: string | null;
  }[];
  payments: {
    id: string;
    number: number;
    saleId: string;
    saleNumber: number;
    kind: "RECEIPT" | "REFUND";
    amount: number;
    paidAt: string;
    paymentMethod: string;
    reason: string | null;
  }[];
  history: { id: string; summary: string; createdAt: string; user: string | null }[];
}

export async function getCustomerDetail(customerId: string): Promise<CustomerDetail | null> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return null;
  const [sales, payments, logs] = await Promise.all([
    prisma.sale.findMany({
      where: { customerId },
      orderBy: [{ saleDate: "desc" }, { number: "desc" }],
      include: { items: { select: { quantity: true } } },
    }),
    prisma.payment.findMany({
      where: { sale: { customerId } },
      orderBy: [{ paidAt: "desc" }, { number: "desc" }],
      include: { sale: { select: { number: true } }, paymentMethod: { select: { name: true } } },
    }),
    prisma.auditLog.findMany({
      where: { entityType: "customer", entityId: customerId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const active = sales.filter((s) => s.status !== "CANCELLED");
  const sumDec = (values: Prisma.Decimal[]) => values.reduce((acc, v) => acc.add(v), new Prisma.Decimal(0));
  const totalPurchased = sumDec(active.map((s) => s.total));
  const totalPaid = sumDec(active.map((s) => s.amountPaid));
  const refundDue = sumDec(sales.filter((s) => s.status === "CANCELLED").map((s) => s.amountPaid));
  return {
    customer: toCustomerView(customer),
    summary: {
      orders: active.length,
      units: active.reduce((acc, s) => acc + s.items.reduce((a, i) => a + i.quantity, 0), 0),
      totalPurchased: num(totalPurchased),
      totalPaid: num(totalPaid),
      pending: num(totalPurchased.sub(totalPaid)),
      refundDue: num(refundDue),
      lastPurchaseAt: active[0]?.saleDate.toISOString() ?? null,
      firstPurchaseAt: active.at(-1)?.saleDate.toISOString() ?? null,
      cancelledOrders: sales.length - active.length,
    },
    sales: sales.map((s) => ({
      id: s.id,
      number: s.number,
      saleDate: s.saleDate.toISOString(),
      units: s.items.reduce((a, i) => a + i.quantity, 0),
      total: num(s.total),
      amountPaid: num(s.amountPaid),
      pending: s.status === "CANCELLED" ? 0 : num(s.total.sub(s.amountPaid)),
      status: s.status,
      paymentStatus: s.paymentStatus,
      dueDate: s.dueDate ? s.dueDate.toISOString().slice(0, 10) : null,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      number: p.number,
      saleId: p.saleId,
      saleNumber: p.sale.number,
      kind: p.kind,
      amount: num(p.amount),
      paidAt: p.paidAt.toISOString(),
      paymentMethod: p.paymentMethod.name,
      reason: p.reason,
    })),
    history: logs.map((l) => ({
      id: l.id,
      summary: l.summary,
      createdAt: l.createdAt.toISOString(),
      user: l.user?.name ?? null,
    })),
  };
}
