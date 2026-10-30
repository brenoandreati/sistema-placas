// Agenda de retornos: agendamento, potenciais clientes, resultados, reagendamento com histórico e indicadores.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { addDaysToDate, resolvePeriod, todayString } from "@/lib/dates";
import type { Actor } from "@/server/context";
import { disconnectDb, prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { deleteCustomer, listCustomers } from "@/server/services/customers";
import {
  cancelFollowUp,
  createFollowUp,
  getAgendaSummary,
  getCustomerFollowUps,
  getFollowUpDetail,
  getUpcomingFollowUps,
  listFollowUps,
  listFollowUpsInRange,
  listNeedsContact,
  recordFollowUpResult,
  rescheduleFollowUp,
  updateFollowUp,
} from "@/server/services/follow-ups";
import { createSale } from "@/server/services/sales";
import { TZ, key, makeCustomer, makeProduct, now, paymentMethodId, resetDatabase } from "./helpers";

let actor: Actor;

beforeEach(async () => {
  actor = await resetDatabase();
});

afterAll(async () => {
  await disconnectDb();
});

const today = () => todayString(TZ);
const inDays = (n: number) => addDaysToDate(today(), n);
const REASON = "Cliente demonstrou interesse, mas pediu para retornar depois";

async function scheduleFor(customerId: string, date: string, time?: string, extra: Record<string, unknown> = {}) {
  return createFollowUp(actor, {
    customerMode: "existing",
    customerId,
    date,
    time,
    type: "VISIT",
    reason: REASON,
    ...extra,
  });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.catch((e) => e);
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

describe("agendamento", () => {
  it("agenda para um cliente cadastrado usando o contato dele, no fuso do negócio", async () => {
    const customer = await makeCustomer(actor);
    await prisma.customer.update({ where: { id: customer.id }, data: { phone: "11987654321" } });
    const f = await scheduleFor(customer.id, inDays(3), "14:30", { notes: "Levar amostra" });

    expect(f).toMatchObject({
      customer: { id: customer.id, businessName: "Padaria Pão Dourado" },
      businessName: "Padaria Pão Dourado",
      contactName: "Maria Souza",
      phone: "11987654321",
      date: inDays(3),
      time: "14:30",
      status: "SCHEDULED",
      overdue: false,
    });
    // 14:30 em São Paulo (UTC-3) é 17:30 UTC.
    expect(f.scheduledAt.slice(11, 16)).toBe("17:30");
    const events = await prisma.followUpEvent.findMany({ where: { followUpId: f.id } });
    expect(events.map((e) => e.action)).toEqual(["created"]);
    expect(await prisma.auditLog.count({ where: { action: "follow_up.create" } })).toBe(1);
  });

  it("aceita retorno sem horário definido", async () => {
    const customer = await makeCustomer(actor);
    const f = await scheduleFor(customer.id, inDays(7));
    expect(f).toMatchObject({ date: inDays(7), time: null });
  });

  it("cadastra um potencial cliente pela agenda, sem venda e sem duplicar", async () => {
    const f = await createFollowUp(actor, {
      customerMode: "new",
      businessName: "Barbearia Navalha",
      contactName: "João",
      phone: "(27) 99876-5432",
      date: inDays(2),
      type: "CALL",
      reason: "Cliente quer analisar a proposta",
    });
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: f.customer!.id } });
    expect(customer).toMatchObject({ businessName: "Barbearia Navalha", contactName: "João", phone: "27998765432" });
    expect(await prisma.sale.count()).toBe(0);

    // Mesmo nome (sem diferenciar maiúsculas) ou mesmo telefone: aponta o cadastro existente.
    const again = createFollowUp(actor, {
      customerMode: "new",
      businessName: "barbearia navalha",
      contactName: "João",
      date: inDays(2),
      type: "CALL",
      reason: "Outro",
    });
    await expectCode(again, "DUPLICATE_CUSTOMER");
    const samePhone = createFollowUp(actor, {
      customerMode: "new",
      businessName: "Navalha Barbearia",
      contactName: "João",
      phone: "27998765432",
      date: inDays(2),
      type: "CALL",
      reason: "Outro",
    });
    await expectCode(samePhone, "DUPLICATE_CUSTOMER");
    expect(await prisma.customer.count()).toBe(1);

    // Novo retorno para o mesmo cliente: vincula ao cadastro, sem criar outro.
    await scheduleFor(customer.id, inDays(9));
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.followUp.count({ where: { customerId: customer.id } })).toBe(2);
  });

  it("valida cliente, data e motivo", async () => {
    await expect(
      createFollowUp(actor, { customerMode: "existing", date: inDays(1), type: "VISIT", reason: REASON }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      createFollowUp(actor, {
        customerMode: "new",
        businessName: "Loja",
        date: inDays(1),
        type: "VISIT",
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(ZodError);
    const customer = await makeCustomer(actor);
    await expect(scheduleFor(customer.id, "2026-02-30")).rejects.toBeInstanceOf(ZodError);
    await expect(scheduleFor(customer.id, inDays(1), "25:00")).rejects.toBeInstanceOf(ZodError);
    await expect(scheduleFor(customer.id, inDays(1), undefined, { reason: "" })).rejects.toBeInstanceOf(ZodError);
    await expectCode(scheduleFor(customer.id, inDays(365 * 4)), "INVALID_DATE");
  });

  it("não duplica com a mesma chave de idempotência", async () => {
    const customer = await makeCustomer(actor);
    const k = key();
    const [a, b] = await Promise.all([
      scheduleFor(customer.id, inDays(1), "09:00", { idempotencyKey: k }),
      scheduleFor(customer.id, inDays(1), "09:00", { idempotencyKey: k }),
    ]);
    expect(a.id).toBe(b.id);
    expect(await prisma.followUp.count()).toBe(1);
  });

  it("edita todos os campos registrando o que mudou", async () => {
    const customer = await makeCustomer(actor);
    const f = await scheduleFor(customer.id, inDays(1), "09:00");
    const edited = await updateFollowUp(actor, {
      id: f.id,
      customerMode: "existing",
      customerId: customer.id,
      contactName: "Carlos",
      phone: "11912345678",
      date: inDays(2),
      time: "16:00",
      type: "WHATSAPP",
      reason: "Cliente pediu mais informações",
      notes: "Mandar fotos das placas",
    });
    expect(edited).toMatchObject({ date: inDays(2), time: "16:00", type: "WHATSAPP", contactName: "Carlos" });
    const event = await prisma.followUpEvent.findFirstOrThrow({ where: { followUpId: f.id, action: "updated" } });
    expect(Object.keys(event.changes as object).sort()).toEqual(
      ["contactName", "notes", "phone", "reason", "scheduledAt", "type"].sort(),
    );
    expect(event.fromScheduledAt?.toISOString()).toBe(f.scheduledAt);
  });
});

describe("resultado, reagendamento e cancelamento", () => {
  it("registra o resultado, encerra o pendente e agenda o próximo contato", async () => {
    const customer = await makeCustomer(actor);
    const f = await scheduleFor(customer.id, today(), "10:00");
    const { followUp, next } = await recordFollowUpResult(actor, {
      id: f.id,
      status: "DONE",
      outcome: "Cliente gostou da placa, pediu para voltar na terça para fechar.",
      nextDate: inDays(4),
      nextTime: "11:00",
    });
    expect(followUp).toMatchObject({ status: "DONE", outcome: expect.stringContaining("terça") });
    expect(followUp.completedAt).not.toBeNull();
    expect(next).toMatchObject({ status: "SCHEDULED", date: inDays(4), time: "11:00", previousId: f.id });
    expect(next?.customer?.id).toBe(customer.id);

    const pending = await listFollowUps({ status: "pending" }, TZ);
    expect(pending.items.map((i) => i.id)).toEqual([next!.id]);
    // Retorno resolvido não pode voltar a ser cancelado nem reagendado como pendente.
    await expectCode(cancelFollowUp(actor, { id: f.id }), "NOT_SCHEDULED");
  });

  it("reagenda preservando o retorno anterior e o histórico", async () => {
    const customer = await makeCustomer(actor);
    const f = await scheduleFor(customer.id, inDays(1), "09:00");
    const next = await rescheduleFollowUp(actor, {
      id: f.id,
      date: inDays(8),
      time: "15:00",
      note: "Dono viajou",
    });
    expect(next).toMatchObject({ status: "SCHEDULED", date: inDays(8), time: "15:00", previousId: f.id });

    const old = await prisma.followUp.findUniqueOrThrow({ where: { id: f.id } });
    expect(old.status).toBe("RESCHEDULED");
    expect(old.scheduledAt.toISOString()).toBe(f.scheduledAt);
    await expectCode(rescheduleFollowUp(actor, { id: f.id, date: inDays(9) }), "RESCHEDULED");

    const detail = await getFollowUpDetail(f.id, TZ);
    expect(detail?.next.map((n) => n.id)).toEqual([next.id]);
    expect(detail?.events.map((e) => e.action)).toEqual(["created", "rescheduled"]);
    expect(detail?.events[1]).toMatchObject({ fromStatus: "SCHEDULED", toStatus: "RESCHEDULED", note: "Dono viajou" });
    const nextDetail = await getFollowUpDetail(next.id, TZ);
    expect(nextDetail?.previous?.id).toBe(f.id);

    const history = await getCustomerFollowUps(customer.id, TZ);
    expect(history.items.map((i) => i.status).sort()).toEqual(["RESCHEDULED", "SCHEDULED"]);
    expect(history.next?.id).toBe(next.id);
  });

  it("cancela só retornos pendentes", async () => {
    const customer = await makeCustomer(actor);
    const f = await scheduleFor(customer.id, inDays(1));
    const cancelled = await cancelFollowUp(actor, { id: f.id, reason: "Loja fechou" });
    expect(cancelled).toMatchObject({ status: "CANCELLED", outcome: "Loja fechou" });
    await expectCode(cancelFollowUp(actor, { id: f.id }), "NOT_SCHEDULED");
    await expectCode(recordFollowUpResult(actor, { id: f.id, status: "DONE" }), "CANCELLED");
  });

  it("venda realizada não cria venda automaticamente", async () => {
    const customer = await makeCustomer(actor);
    const f = await scheduleFor(customer.id, today());
    await recordFollowUpResult(actor, { id: f.id, status: "SOLD", outcome: "Fechou 2 placas" });
    expect(await prisma.sale.count()).toBe(0);
  });
});

describe("indicadores e consultas", () => {
  it("conta hoje, próximos, atrasados e concluídos a partir dos registros", async () => {
    const customer = await makeCustomer(actor);
    await scheduleFor(customer.id, inDays(-3), "10:00"); // atrasado
    await scheduleFor(customer.id, today(), "08:00");
    const doneToday = await scheduleFor(customer.id, today(), "09:00");
    await scheduleFor(customer.id, inDays(1));
    await scheduleFor(customer.id, inDays(10));
    const cancelled = await scheduleFor(customer.id, inDays(5));
    await recordFollowUpResult(actor, { id: doneToday.id, status: "DONE" });
    await cancelFollowUp(actor, { id: cancelled.id });

    const period = resolvePeriod("30d", TZ);
    expect(await getAgendaSummary(TZ, period)).toMatchObject({
      today: 1,
      todayTotal: 2,
      upcoming: 2,
      overdue: 1,
      completed: 1,
    });
    const overdue = await listFollowUps({ status: "overdue" }, TZ);
    expect(overdue.items).toHaveLength(1);
    expect(overdue.items[0].overdue).toBe(true);

    const upcoming = await getUpcomingFollowUps(TZ, 3);
    expect(upcoming).toMatchObject({ overdue: 1, today: 1 });
    expect(upcoming.items[0].overdue).toBe(true);

    const week = await listFollowUpsInRange(
      { start: new Date(`${inDays(-7)}T03:00:00Z`), end: new Date(`${inDays(7)}T03:00:00Z`) },
      TZ,
    );
    expect(week.map((w) => w.date)).toEqual([...week.map((w) => w.date)].sort());
  });

  it("filtra por status, tipo, cliente, texto e data", async () => {
    const a = await makeCustomer(actor, "Padaria Pão Dourado");
    const b = await makeCustomer(actor, "Café Grão Nobre");
    await scheduleFor(a.id, inDays(1), undefined, { type: "CALL" });
    await scheduleFor(b.id, inDays(3), undefined, { type: "VISIT" });
    await scheduleFor(b.id, inDays(20), undefined, { type: "VISIT" });

    expect((await listFollowUps({ type: "CALL" }, TZ)).total).toBe(1);
    expect((await listFollowUps({ customerId: b.id }, TZ)).total).toBe(2);
    expect((await listFollowUps({ search: "grão" }, TZ)).total).toBe(2);
    expect((await listFollowUps({ from: inDays(2), to: inDays(10) }, TZ)).total).toBe(1);
    expect((await listFollowUps({ status: "all" }, TZ)).total).toBe(3);
  });

  it("mostra na lista de clientes quem tem retorno agendado", async () => {
    const withFollowUp = await makeCustomer(actor, "Padaria Pão Dourado");
    await makeCustomer(actor, "Café Grão Nobre");
    const later = await scheduleFor(withFollowUp.id, inDays(5));
    const sooner = await scheduleFor(withFollowUp.id, inDays(2), "10:00");
    const cancelled = await scheduleFor(withFollowUp.id, inDays(1));
    await cancelFollowUp(actor, { id: cancelled.id });

    const all = await listCustomers({});
    const row = all.items.find((c) => c.id === withFollowUp.id);
    expect(row?.nextFollowUpAt).toBe(sooner.scheduledAt);
    expect(all.items.find((c) => c.id !== withFollowUp.id)?.nextFollowUpAt).toBeNull();
    expect((await listCustomers({ followUp: "scheduled" })).items.map((c) => c.id)).toEqual([withFollowUp.id]);
    expect((await listCustomers({ followUp: "none" })).items.map((c) => c.businessName)).toEqual(["Café Grão Nobre"]);

    // Reagendar o mais próximo move a próxima data para o mais próximo que restar.
    await rescheduleFollowUp(actor, { id: sooner.id, date: inDays(9) });
    expect((await listCustomers({})).items.find((c) => c.id === withFollowUp.id)?.nextFollowUpAt).toBe(
      later.scheduledAt,
    );
  });

  it("destaca clientes sem novo contato após conversa inconclusiva", async () => {
    const customer = await makeCustomer(actor);
    const f = await scheduleFor(customer.id, today());
    await recordFollowUpResult(actor, { id: f.id, status: "NO_CONTACT" });
    expect((await listNeedsContact(TZ)).map((n) => n.id)).toEqual([f.id]);
    expect((await getCustomerFollowUps(customer.id, TZ)).needsContact).toBe(true);

    // Agendar o próximo resolve o alerta.
    const next = await rescheduleFollowUp(actor, { id: f.id, date: inDays(2) });
    expect(await listNeedsContact(TZ)).toEqual([]);
    expect((await getCustomerFollowUps(customer.id, TZ)).needsContact).toBe(false);

    // Venda depois do contato também resolve.
    await recordFollowUpResult(actor, { id: next.id, status: "DONE" });
    expect(await listNeedsContact(TZ)).toHaveLength(1);
    const product = await makeProduct(actor, { stock: 5 });
    await createSale(actor, {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 1, unitPriceCents: 3000 }],
      saleDate: now(),
      paymentMethodId: await paymentMethodId(),
      paymentStatus: "PAID",
    });
    expect(await listNeedsContact(TZ)).toEqual([]);
    expect((await getAgendaSummary(TZ, resolvePeriod("30d", TZ))).needsContact).toBe(0);
  });
});

describe("integridade", () => {
  it("o banco não apaga retornos nem altera o histórico", async () => {
    const customer = await makeCustomer(actor);
    const f = await scheduleFor(customer.id, inDays(1));
    await expect(prisma.followUp.delete({ where: { id: f.id } })).rejects.toThrow();
    const event = await prisma.followUpEvent.findFirstOrThrow({ where: { followUpId: f.id } });
    await expect(prisma.followUpEvent.update({ where: { id: event.id }, data: { note: "x" } })).rejects.toThrow();
    // Pendente com data de conclusão (ou concluído sem ela) é barrado.
    await expect(prisma.followUp.update({ where: { id: f.id }, data: { completedAt: new Date() } })).rejects.toThrow();
    await expect(prisma.followUp.update({ where: { id: f.id }, data: { status: "DONE" } })).rejects.toThrow();
  });

  it("excluir um potencial cliente mantém o histórico de retornos", async () => {
    const customer = await makeCustomer(actor);
    const f = await scheduleFor(customer.id, inDays(1));
    await deleteCustomer(actor, customer.id);
    const kept = await prisma.followUp.findUniqueOrThrow({ where: { id: f.id } });
    expect(kept).toMatchObject({ customerId: null, businessName: "Padaria Pão Dourado" });
  });
});
