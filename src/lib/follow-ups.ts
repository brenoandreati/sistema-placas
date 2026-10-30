// Agenda de retornos: tipos, status e motivos (compartilhados entre telas e servidor).
import type { BadgeTone } from "@/components/ui/badge";

export const FOLLOW_UP_TYPES = ["VISIT", "CALL", "WHATSAPP", "PROPOSAL", "AWAITING_REPLY", "OTHER"] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

export const FOLLOW_UP_TYPE_LABELS: Record<FollowUpType, string> = {
  VISIT: "Visita presencial",
  CALL: "Ligação",
  WHATSAPP: "WhatsApp",
  PROPOSAL: "Enviar proposta",
  AWAITING_REPLY: "Aguardando resposta",
  OTHER: "Outro",
};

export const FOLLOW_UP_STATUSES = [
  "SCHEDULED",
  "DONE",
  "RESCHEDULED",
  "NO_CONTACT",
  "NOT_INTERESTED",
  "SOLD",
  "CANCELLED",
] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const FOLLOW_UP_STATUS: Record<FollowUpStatus, { label: string; tone: BadgeTone }> = {
  SCHEDULED: { label: "Agendado", tone: "primary" },
  DONE: { label: "Realizado", tone: "positive" },
  RESCHEDULED: { label: "Reagendado", tone: "neutral" },
  NO_CONTACT: { label: "Não conseguiu contato", tone: "warning" },
  NOT_INTERESTED: { label: "Sem interesse", tone: "neutral" },
  SOLD: { label: "Venda realizada", tone: "positive" },
  CANCELLED: { label: "Cancelado", tone: "outline" },
};

/** Resultados que encerram um retorno depois do contato (registrados em "Registrar resultado"). */
export const FOLLOW_UP_RESULT_STATUSES = ["DONE", "NO_CONTACT", "NOT_INTERESTED", "SOLD"] as const;
export type FollowUpResultStatus = (typeof FOLLOW_UP_RESULT_STATUSES)[number];

export const FOLLOW_UP_RESULT_LABELS: Record<FollowUpResultStatus, string> = {
  DONE: "Realizado",
  NO_CONTACT: "Não conseguiu contato",
  NOT_INTERESTED: "Cliente não demonstrou interesse",
  SOLD: "Venda realizada",
};

/** Conversa sem desfecho: pede um novo contato agendado. */
export const INCONCLUSIVE_STATUSES: readonly FollowUpStatus[] = ["DONE", "NO_CONTACT"];

export const FOLLOW_UP_REASONS = [
  "Cliente demonstrou interesse, mas pediu para retornar depois",
  "Cliente quer analisar a proposta",
  "Cliente precisa conversar com sócio ou responsável",
  "Cliente pediu mais informações",
  "Cliente solicitou um prazo para decidir",
  "Cliente pediu para entrar em contato novamente",
] as const;

export const FOLLOW_UP_EVENT_LABELS: Record<string, string> = {
  created: "Retorno agendado",
  updated: "Dados editados",
  result: "Resultado registrado",
  rescheduled: "Reagendado",
  next_scheduled: "Próximo retorno agendado",
  cancelled: "Cancelado",
};
