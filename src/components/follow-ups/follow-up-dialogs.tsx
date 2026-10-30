"use client";

import { ExternalLink, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { firstError, useServerAction } from "@/components/forms/use-action";
import { useQuickActions } from "@/components/quick-actions";
import { FollowUpStatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { DialogContent } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { addDaysToDate, formatDateString, formatDateTime } from "@/lib/dates";
import {
  FOLLOW_UP_EVENT_LABELS,
  FOLLOW_UP_RESULT_LABELS,
  FOLLOW_UP_RESULT_STATUSES,
  FOLLOW_UP_STATUS,
  FOLLOW_UP_TYPE_LABELS,
  type FollowUpResultStatus,
} from "@/lib/follow-ups";
import { formatPhone, whatsappLink } from "@/lib/format";
import {
  cancelFollowUpAction,
  getFollowUpDetailAction,
  recordFollowUpResultAction,
  rescheduleFollowUpAction,
} from "@/server/actions/follow-ups";
import type { FollowUpDetail, FollowUpView } from "@/server/services/follow-ups";

export function whenText(f: Pick<FollowUpView, "date" | "time">): string {
  return f.time ? `${formatDateString(f.date)} às ${f.time}` : `${formatDateString(f.date)} (sem horário)`;
}

/** Botões de contato: WhatsApp (número com código do país) e ligação. Sem telefone, nada é inventado. */
export function ContactLinks({ phone, size = "sm" }: { phone: string | null; size?: "sm" | "icon" }) {
  const wa = whatsappLink(phone);
  if (!phone) return null;
  return (
    <>
      {wa && (
        <Button asChild variant="secondary" size={size} className="text-positive">
          <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${formatPhone(phone)}`}>
            <MessageCircle /> {size === "sm" && <span className="max-sm:sr-only">WhatsApp</span>}
          </a>
        </Button>
      )}
      <Button asChild variant="secondary" size={size}>
        <a href={`tel:${phone}`} aria-label={`Ligar para ${formatPhone(phone)}`}>
          <Phone /> {size === "sm" && <span className="max-sm:sr-only">Ligar</span>}
        </a>
      </Button>
    </>
  );
}

function QuickDates({ today, value, onPick }: { today: string; value: string; onPick: (date: string) => void }) {
  const options = [
    { label: "Amanhã", value: addDaysToDate(today, 1) },
    { label: "Em 3 dias", value: addDaysToDate(today, 3) },
    { label: "Em 1 semana", value: addDaysToDate(today, 7) },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onPick(o.value)}
          className="h-8 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink-2 hover:bg-surface-2 aria-pressed:border-primary/40 aria-pressed:bg-primary-soft aria-pressed:text-primary-ink"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Registrar resultado / marcar como realizado, com a opção de já agendar o próximo contato. */
export function ResultDialogBody({
  followUp,
  today,
  initialStatus = "DONE",
  onClose,
}: {
  followUp: FollowUpView;
  today: string;
  initialStatus?: FollowUpResultStatus;
  onClose: () => void;
}) {
  const quick = useQuickActions();
  const editing = followUp.status !== "SCHEDULED";
  const [status, setStatus] = useState<FollowUpResultStatus>(
    editing && (FOLLOW_UP_RESULT_STATUSES as readonly string[]).includes(followUp.status)
      ? (followUp.status as FollowUpResultStatus)
      : initialStatus,
  );
  const [outcome, setOutcome] = useState(followUp.outcome ?? "");
  const [scheduleNext, setScheduleNext] = useState(false);
  const [nextDate, setNextDate] = useState("");
  const [nextTime, setNextTime] = useState("");
  const { run, pending, fieldErrors } = useServerAction(recordFollowUpResultAction);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      {
        id: followUp.id,
        status,
        outcome,
        nextDate: scheduleNext ? nextDate : null,
        nextTime: scheduleNext ? nextTime : null,
      },
      {
        successMessage: null,
        onSuccess: (data) => {
          const customerId = followUp.customer?.id;
          toast.success(
            data.nextDate
              ? `Resultado registrado. Próximo retorno em ${formatDateString(data.nextDate)}.`
              : "Resultado registrado.",
            status === "SOLD" && customerId
              ? // Não vira venda sozinho: oferece abrir o formulário de venda.
                { action: { label: "Registrar venda", onClick: () => quick.open({ type: "sale", customerId }) } }
              : undefined,
          );
          onClose();
        },
      },
    );
  }

  return (
    <DialogContent
      title={editing ? "Corrigir resultado" : "Registrar resultado"}
      description={`${followUp.businessName} · ${whenText(followUp)}`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="follow-up-result" loading={pending}>
            Salvar resultado
          </Button>
        </>
      }
    >
      <form id="follow-up-result" onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Como foi?" required error={firstError(fieldErrors, "status")}>
          {() => (
            <Segmented
              name="result"
              ariaLabel="Resultado"
              size="sm"
              value={status}
              onChange={setStatus}
              options={FOLLOW_UP_RESULT_STATUSES.map((s) => ({
                value: s,
                label: FOLLOW_UP_RESULT_LABELS[s],
                tone: s === "SOLD" || s === "DONE" ? ("positive" as const) : ("warning" as const),
              }))}
            />
          )}
        </Field>
        <Field label="Resumo da conversa" error={firstError(fieldErrors, "outcome")}>
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              maxLength={2000}
              placeholder="Ex.: Cliente gostou da placa, mas pediu para retornar na próxima terça-feira para finalizar a compra."
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            />
          )}
        </Field>
        {status === "SOLD" && (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
            O retorno não cria a venda sozinho. Depois de salvar, use “Registrar venda” para lançar a venda.
          </p>
        )}
        <div className="flex flex-col gap-3 rounded-xl border border-line px-4 py-3">
          <Checkbox
            label="Agendar o próximo retorno"
            description="Ex.: o cliente pediu para voltar outro dia."
            checked={scheduleNext}
            onChange={(e) => setScheduleNext(e.target.checked)}
          />
          {scheduleNext && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Data" required error={firstError(fieldErrors, "nextDate")}>
                  {(p) => <Input {...p} type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />}
                </Field>
                <Field label="Horário" error={firstError(fieldErrors, "nextTime")}>
                  {(p) => <Input {...p} type="time" value={nextTime} onChange={(e) => setNextTime(e.target.value)} />}
                </Field>
              </div>
              <QuickDates today={today} value={nextDate} onPick={setNextDate} />
            </>
          )}
        </div>
      </form>
    </DialogContent>
  );
}

export function RescheduleDialogBody({
  followUp,
  today,
  onClose,
}: {
  followUp: FollowUpView;
  today: string;
  onClose: () => void;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState(followUp.time ?? "");
  const [note, setNote] = useState("");
  const { run, pending, fieldErrors } = useServerAction(rescheduleFollowUpAction);
  const pendingNow = followUp.status === "SCHEDULED";

  return (
    <DialogContent
      size="sm"
      title={pendingNow ? "Reagendar retorno" : "Agendar próximo retorno"}
      description={
        pendingNow
          ? `O retorno de ${whenText(followUp)} fica no histórico como reagendado.`
          : `Novo contato com ${followUp.businessName}.`
      }
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="follow-up-reschedule" loading={pending}>
            {pendingNow ? "Reagendar" : "Agendar"}
          </Button>
        </>
      }
    >
      <form
        id="follow-up-reschedule"
        onSubmit={(e) => {
          e.preventDefault();
          run({ id: followUp.id, date, time, note }, { onSuccess: onClose });
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nova data" required error={firstError(fieldErrors, "date")}>
            {(p) => <Input {...p} autoFocus type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Field label="Horário" error={firstError(fieldErrors, "time")} hint="Opcional.">
            {(p) => <Input {...p} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
          </Field>
        </div>
        <QuickDates today={today} value={date} onPick={setDate} />
        <Field label="Motivo (opcional)" error={firstError(fieldErrors, "note")}>
          {(p) => (
            <Input
              {...p}
              maxLength={1000}
              placeholder="Ex.: o dono pediu para voltar na terça"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </form>
    </DialogContent>
  );
}

export function CancelDialogBody({ followUp, onClose }: { followUp: FollowUpView; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const { run, pending } = useServerAction(cancelFollowUpAction);
  return (
    <DialogContent
      size="sm"
      title="Cancelar retorno?"
      description={`${followUp.businessName} · ${whenText(followUp)}`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Manter
          </Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={() => run({ id: followUp.id, reason }, { onSuccess: onClose })}
          >
            Cancelar retorno
          </Button>
        </>
      }
    >
      <Field label="Motivo (opcional)">
        {(p) => (
          <Input
            {...p}
            maxLength={500}
            placeholder="Ex.: a loja fechou"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      <p className="mt-3 text-xs text-muted">O retorno continua no histórico do cliente como cancelado.</p>
    </DialogContent>
  );
}

function describeEvent(e: FollowUpDetail["events"][number], tz: string): string | null {
  if (e.action === "rescheduled" || e.action === "next_scheduled") {
    return e.toScheduledAt ? `Nova data: ${formatDateTime(e.toScheduledAt, tz)}` : null;
  }
  if (e.action === "result" && e.toStatus) {
    const to = FOLLOW_UP_STATUS[e.toStatus].label;
    return e.fromStatus && e.fromStatus !== "SCHEDULED" ? `${FOLLOW_UP_STATUS[e.fromStatus].label} → ${to}` : to;
  }
  if (e.action === "updated" && e.changes) {
    const names: Record<string, string> = {
      customerId: "cliente",
      businessName: "estabelecimento",
      contactName: "responsável",
      phone: "telefone",
      type: "tipo",
      reason: "motivo",
      notes: "observações",
      scheduledAt: "data/horário",
    };
    const fields = Object.keys(e.changes).map((k) => names[k] ?? k);
    const date = e.changes.scheduledAt ? ` (${e.changes.scheduledAt[0]} → ${e.changes.scheduledAt[1]})` : "";
    return `Alterou ${fields.join(", ")}${date}`;
  }
  return null;
}

/** Detalhes do retorno com o histórico completo (edições, resultados, reagendamentos). */
export function DetailsDialogBody({
  followUp,
  tz,
  canWrite,
  onAction,
  onClose,
}: {
  followUp: FollowUpView;
  tz: string;
  canWrite: boolean;
  onAction: (action: "edit" | "result" | "reschedule" | "cancel") => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<FollowUpDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getFollowUpDetailAction(followUp.id)
      .then((d) => !cancelled && (d ? setDetail(d) : setFailed(true)))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [followUp.id]);

  const f = detail?.followUp ?? followUp;
  const pending = f.status === "SCHEDULED";
  const rows: [string, React.ReactNode][] = [
    [
      "Cliente",
      f.customer ? (
        <Link
          href={`/clientes/${f.customer.id}?aba=contatos`}
          className="text-primary hover:underline"
          onClick={onClose}
        >
          {f.customer.businessName}
        </Link>
      ) : (
        f.businessName
      ),
    ],
    ["Responsável", f.contactName],
    ["Telefone", f.phone ? formatPhone(f.phone) : null],
    ["Quando", whenText(f)],
    ["Tipo", FOLLOW_UP_TYPE_LABELS[f.type]],
    ["Motivo", f.reason],
    ["Observações", f.notes],
    ["Resultado", f.outcome],
    ["Concluído em", f.completedAt ? formatDateTime(f.completedAt, tz) : null],
  ];

  return (
    <DialogContent
      variant="sheet"
      title={f.businessName}
      description={
        <span className="inline-flex items-center gap-2">
          <FollowUpStatusBadge status={f.status} overdue={f.overdue} /> {whenText(f)}
        </span>
      }
      footer={
        canWrite ? (
          <>
            {pending && (
              <Button variant="danger-outline" onClick={() => onAction("cancel")}>
                Cancelar retorno
              </Button>
            )}
            <Button variant="secondary" onClick={() => onAction("edit")}>
              Editar
            </Button>
            {f.status !== "RESCHEDULED" && (
              <Button variant="secondary" onClick={() => onAction("reschedule")}>
                {pending ? "Reagendar" : "Agendar próximo"}
              </Button>
            )}
            {f.status !== "RESCHEDULED" && f.status !== "CANCELLED" && (
              <Button onClick={() => onAction("result")}>
                {pending ? "Registrar resultado" : "Corrigir resultado"}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          <ContactLinks phone={f.phone} />
        </div>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[140px_1fr]">
          {rows
            .filter(([, v]) => v)
            .map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd className="[overflow-wrap:anywhere] whitespace-pre-line text-ink">{value}</dd>
              </div>
            ))}
        </dl>

        {(detail?.previous || (detail?.next.length ?? 0) > 0) && (
          <div className="flex flex-col gap-1.5 rounded-xl bg-surface-2 px-4 py-3 text-[13px] text-ink-2">
            {detail?.previous && (
              <p>
                Veio de um retorno de {whenText(detail.previous)} ({FOLLOW_UP_STATUS[detail.previous.status].label}).
              </p>
            )}
            {detail?.next.map((n) => (
              <p key={n.id}>
                Próximo retorno: {whenText(n)} ({FOLLOW_UP_STATUS[n.status].label}).
              </p>
            ))}
          </div>
        )}

        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">Histórico</h3>
          {failed && <p className="text-sm text-negative">Não foi possível carregar o histórico.</p>}
          {!detail && !failed && <p className="text-sm text-muted">Carregando…</p>}
          {detail && (
            <ol className="flex flex-col gap-3 border-l border-line pl-4">
              {detail.events.map((e) => {
                const extra = describeEvent(e, tz);
                return (
                  <li key={e.id} className="relative text-sm">
                    <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-line-strong" aria-hidden />
                    <p className="font-medium text-ink">{FOLLOW_UP_EVENT_LABELS[e.action] ?? e.action}</p>
                    <p className="text-xs text-muted">
                      {formatDateTime(e.createdAt, tz)}
                      {e.user ? ` · ${e.user}` : ""}
                    </p>
                    {extra && <p className="mt-0.5 text-[13px] text-ink-2">{extra}</p>}
                    {e.note && <p className="mt-0.5 text-[13px] whitespace-pre-line text-ink-2">“{e.note}”</p>}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        {f.customer && (
          <Link
            href={`/clientes/${f.customer.id}?aba=contatos`}
            onClick={onClose}
            className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
          >
            Ver histórico de contatos do cliente <ExternalLink className="size-3.5" />
          </Link>
        )}
      </div>
    </DialogContent>
  );
}
