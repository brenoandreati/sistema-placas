"use server";

import { todayString } from "@/lib/dates";
import type {
  CancelFollowUpInput,
  CreateFollowUpInput,
  FollowUpResultInput,
  RescheduleFollowUpInput,
  UpdateFollowUpInput,
} from "@/lib/validation/follow-ups";
import { requireActor } from "@/server/auth/guard";
import {
  cancelFollowUp,
  createFollowUp,
  getFollowUpDetail,
  listFollowUpCustomerOptions,
  recordFollowUpResult,
  rescheduleFollowUp,
  updateFollowUp,
} from "@/server/services/follow-ups";
import { getTimezone } from "@/server/services/settings";
import { runAction } from "./run";

/** Clientes para o seletor e a data de hoje no fuso do negócio (atalhos "Hoje", "Amanhã"...). */
export async function getFollowUpFormOptionsAction() {
  await requireActor("followups.write");
  const [customers, tz] = await Promise.all([listFollowUpCustomerOptions(), getTimezone()]);
  return { customers, today: todayString(tz) };
}

export async function getFollowUpDetailAction(id: string) {
  await requireActor("sales.read");
  return getFollowUpDetail(id, await getTimezone());
}

export async function createFollowUpAction(input: CreateFollowUpInput) {
  return runAction(
    "followups.write",
    async (actor) => {
      const followUp = await createFollowUp(actor, input);
      return { id: followUp.id, customerId: followUp.customer?.id ?? null };
    },
    { message: "Retorno agendado." },
  );
}

export async function updateFollowUpAction(input: UpdateFollowUpInput) {
  return runAction(
    "followups.write",
    async (actor) => {
      await updateFollowUp(actor, input);
      return undefined;
    },
    { message: "Retorno atualizado." },
  );
}

export async function recordFollowUpResultAction(input: FollowUpResultInput) {
  return runAction("followups.write", async (actor) => {
    const { next } = await recordFollowUpResult(actor, input);
    return { nextDate: next?.date ?? null };
  });
}

export async function rescheduleFollowUpAction(input: RescheduleFollowUpInput) {
  return runAction(
    "followups.write",
    async (actor) => {
      const next = await rescheduleFollowUp(actor, input);
      return { id: next.id, date: next.date };
    },
    { message: "Retorno reagendado. O anterior ficou no histórico." },
  );
}

export async function cancelFollowUpAction(input: CancelFollowUpInput) {
  return runAction(
    "followups.write",
    async (actor) => {
      await cancelFollowUp(actor, input);
      return undefined;
    },
    { message: "Retorno cancelado." },
  );
}
