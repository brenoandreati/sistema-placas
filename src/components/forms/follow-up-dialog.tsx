"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { addDaysToDate } from "@/lib/dates";
import { FOLLOW_UP_REASONS, FOLLOW_UP_TYPE_LABELS, FOLLOW_UP_TYPES, type FollowUpType } from "@/lib/follow-ups";
import { formatPhone } from "@/lib/format";
import { createFollowUpAction, getFollowUpFormOptionsAction, updateFollowUpAction } from "@/server/actions/follow-ups";
import { CustomerCombobox } from "./customer-combobox";
import { firstError, useIdempotencyKey, useServerAction } from "./use-action";

type Options = Awaited<ReturnType<typeof getFollowUpFormOptionsAction>>;
type CustomerOption = Options["customers"][number];

/** Retorno existente sendo editado (campos do FollowUpView usados pelo formulário). */
export interface EditableFollowUp {
  id: string;
  customer: { id: string; businessName: string } | null;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  date: string;
  time: string | null;
  type: FollowUpType;
  reason: string;
  notes: string | null;
}

const OTHER_REASON = "__outro__";

interface Values {
  customerMode: "existing" | "new";
  customerId: string | null;
  businessName: string;
  contactName: string;
  phone: string;
  date: string;
  time: string;
  type: FollowUpType;
  reasonChoice: string;
  reasonText: string;
  notes: string;
}

function initialValues(followUp: EditableFollowUp | undefined, presetCustomerId: string | undefined): Values {
  if (!followUp) {
    return {
      customerMode: "existing",
      customerId: presetCustomerId ?? null,
      businessName: "",
      contactName: "",
      phone: "",
      date: "",
      time: "",
      type: "VISIT",
      reasonChoice: FOLLOW_UP_REASONS[0],
      reasonText: "",
      notes: "",
    };
  }
  const preset = (FOLLOW_UP_REASONS as readonly string[]).includes(followUp.reason);
  return {
    customerMode: "existing",
    customerId: followUp.customer?.id ?? null,
    businessName: followUp.businessName,
    contactName: followUp.contactName ?? "",
    phone: formatPhone(followUp.phone),
    date: followUp.date,
    time: followUp.time ?? "",
    type: followUp.type,
    reasonChoice: preset ? followUp.reason : OTHER_REASON,
    reasonText: preset ? "" : followUp.reason,
    notes: followUp.notes ?? "",
  };
}

/** Agendar ou editar um retorno. Abre em tela cheia no celular para cadastrar durante a visita. */
export function FollowUpDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followUp?: EditableFollowUp;
  presetCustomerId?: string;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <FollowUpDialogBody {...props} />}
    </Dialog>
  );
}

function FollowUpDialogBody({
  onOpenChange,
  followUp,
  presetCustomerId,
}: {
  onOpenChange: (open: boolean) => void;
  followUp?: EditableFollowUp;
  presetCustomerId?: string;
}) {
  const [values, setValues] = useState<Values>(() => initialValues(followUp, presetCustomerId));
  const [options, setOptions] = useState<Options | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [idempotencyKey] = useIdempotencyKey();
  const create = useServerAction(createFollowUpAction);
  const update = useServerAction(updateFollowUpAction);
  const action = followUp ? update : create;
  const errors = action.fieldErrors;

  useEffect(() => {
    let cancelled = false;
    getFollowUpFormOptionsAction()
      .then((data) => {
        if (cancelled) return;
        setOptions(data);
        // Novo retorno para um cliente específico: já traz o contato dele.
        if (!followUp && presetCustomerId) {
          const c = data.customers.find((x) => x.id === presetCustomerId);
          if (c) setValues((v) => ({ ...v, contactName: c.contactName, phone: formatPhone(c.whatsapp ?? c.phone) }));
        }
      })
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [followUp, presetCustomerId]);

  // Cliente vinculado mas desativado continua aparecendo como selecionado.
  const customers: CustomerOption[] = useMemo(() => {
    const list = options?.customers ?? [];
    const linked = followUp?.customer;
    if (!linked || list.some((c) => c.id === linked.id)) return list;
    return [
      {
        id: linked.id,
        businessName: linked.businessName,
        contactName: followUp.contactName ?? "",
        phone: followUp.phone,
        whatsapp: null,
      },
      ...list,
    ];
  }, [options, followUp]);

  const today = options?.today;
  const set =
    (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [key]: e.target.value }));

  function chooseCustomer(c: CustomerOption) {
    setValues((v) => ({
      ...v,
      customerId: c.id,
      contactName: c.contactName,
      phone: formatPhone(c.whatsapp ?? c.phone),
    }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      customerMode: values.customerMode,
      customerId: values.customerMode === "existing" ? values.customerId : null,
      businessName: values.customerMode === "new" ? values.businessName : null,
      contactName: values.contactName,
      phone: values.phone,
      date: values.date,
      time: values.time,
      type: values.type,
      reason: values.reasonChoice === OTHER_REASON ? values.reasonText : values.reasonChoice,
      notes: values.notes,
    };
    const done = { onSuccess: () => onOpenChange(false) };
    if (followUp) update.run({ ...payload, id: followUp.id }, done);
    else create.run({ ...payload, idempotencyKey }, done);
  }

  const quickDates = today
    ? [
        { label: "Hoje", value: today },
        { label: "Amanhã", value: addDaysToDate(today, 1) },
        { label: "Em 1 semana", value: addDaysToDate(today, 7) },
      ]
    : [];

  return (
    <DialogContent
      variant="sheet"
      size="lg"
      title={followUp ? "Editar retorno" : "Agendar retorno"}
      description={followUp ? followUp.businessName : "Quando voltar a falar com o cliente e por quê."}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="follow-up-form" loading={action.pending}>
            {followUp ? "Salvar alterações" : "Agendar retorno"}
          </Button>
        </>
      }
    >
      <form id="follow-up-form" onSubmit={submit} className="flex flex-col gap-6">
        {loadError && (
          <p className="rounded-lg bg-negative-soft px-3 py-2 text-sm text-negative">
            Não foi possível carregar os clientes. Feche e abra o formulário de novo.
          </p>
        )}

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-[13px] font-semibold text-ink">Cliente</legend>
          <Segmented
            name="customerMode"
            ariaLabel="Cliente"
            size="sm"
            value={values.customerMode}
            onChange={(mode) => setValues((v) => ({ ...v, customerMode: mode }))}
            options={[
              { value: "existing", label: "Cliente cadastrado" },
              { value: "new", label: "Novo potencial cliente" },
            ]}
          />
          {values.customerMode === "existing" ? (
            <Field label="Cliente ou estabelecimento" required error={firstError(errors, "customerId")}>
              {(p) => (
                <CustomerCombobox
                  id={p.id}
                  invalid={p["aria-invalid"]}
                  customers={customers}
                  value={values.customerId}
                  onChange={(c) => chooseCustomer(c as CustomerOption)}
                  // "Cadastrar novo" na busca: vira potencial cliente com o nome digitado.
                  onCreateNew={(name) =>
                    setValues((v) => ({ ...v, customerMode: "new", businessName: name, customerId: null }))
                  }
                />
              )}
            </Field>
          ) : (
            <Field
              label="Nome do estabelecimento"
              required
              error={firstError(errors, "businessName")}
              hint="Entra no cadastro de clientes como potencial cliente, sem precisar de venda."
            >
              {(p) => (
                <Input
                  {...p}
                  autoFocus
                  maxLength={150}
                  placeholder="Ex.: Padaria Pão Dourado"
                  value={values.businessName}
                  onChange={set("businessName")}
                />
              )}
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Nome do responsável"
              required={values.customerMode === "new"}
              error={firstError(errors, "contactName")}
            >
              {(p) => <Input {...p} maxLength={120} value={values.contactName} onChange={set("contactName")} />}
            </Field>
            <Field label="Telefone / WhatsApp" error={firstError(errors, "phone")}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(27) 99876-5432"
                  value={values.phone}
                  onChange={set("phone")}
                />
              )}
            </Field>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-[13px] font-semibold text-ink">Quando</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Data do retorno" required error={firstError(errors, "date")}>
              {(p) => <Input {...p} type="date" value={values.date} onChange={set("date")} />}
            </Field>
            <Field label="Horário" error={firstError(errors, "time")} hint="Opcional.">
              {(p) => <Input {...p} type="time" value={values.time} onChange={set("time")} />}
            </Field>
          </div>
          {quickDates.length > 0 && (
            <div className="-mt-1 flex flex-wrap gap-1.5">
              {quickDates.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => setValues((v) => ({ ...v, date: q.value }))}
                  className="h-8 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink-2 hover:bg-surface-2 aria-pressed:border-primary/40 aria-pressed:bg-primary-soft aria-pressed:text-primary-ink"
                  aria-pressed={values.date === q.value}
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-[13px] font-semibold text-ink">Retorno</legend>
          <Field label="Tipo de retorno" required error={firstError(errors, "type")}>
            {() => (
              <Segmented
                name="type"
                ariaLabel="Tipo de retorno"
                size="sm"
                value={values.type}
                onChange={(type) => setValues((v) => ({ ...v, type }))}
                options={FOLLOW_UP_TYPES.map((t) => ({ value: t, label: FOLLOW_UP_TYPE_LABELS[t] }))}
              />
            )}
          </Field>
          <Field label="Motivo do retorno" required error={firstError(errors, "reason")}>
            {(p) => (
              <Select {...p} value={values.reasonChoice} onChange={set("reasonChoice")}>
                {FOLLOW_UP_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                <option value={OTHER_REASON}>Outro motivo…</option>
              </Select>
            )}
          </Field>
          {values.reasonChoice === OTHER_REASON && (
            <Field label="Qual o motivo?" required error={firstError(errors, "reason")}>
              {(p) => (
                <Input
                  {...p}
                  autoFocus
                  maxLength={300}
                  placeholder="Ex.: levar a placa de amostra"
                  value={values.reasonText}
                  onChange={set("reasonText")}
                />
              )}
            </Field>
          )}
          <Field label="Observações" error={firstError(errors, "notes")}>
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                maxLength={2000}
                placeholder="Ex.: falar com o gerente; levar a placa de acrílico."
                value={values.notes}
                onChange={set("notes")}
              />
            )}
          </Field>
        </fieldset>
      </form>
    </DialogContent>
  );
}
