"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { formatCnpj, formatPhone } from "@/lib/format";
import { BRAZILIAN_STATES } from "@/lib/validation/common";
import { createCustomerAction, updateCustomerAction } from "@/server/actions/customers";
import { firstError, useServerAction } from "./use-action";

export interface CustomerFormValues {
  businessName: string;
  contactName: string;
  legalName: string;
  email: string;
  phone: string;
  whatsapp: string;
  segment: string;
  cnpj: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  notes: string;
  googleReviewUrl: string;
  publicPlaceName: string;
  plateCustomizationNotes: string;
}

const empty: CustomerFormValues = {
  businessName: "",
  contactName: "",
  legalName: "",
  email: "",
  phone: "",
  whatsapp: "",
  segment: "",
  cnpj: "",
  address: "",
  city: "",
  state: "",
  zipCode: "",
  notes: "",
  googleReviewUrl: "",
  publicPlaceName: "",
  plateCustomizationNotes: "",
};

export const SEGMENT_SUGGESTIONS = [
  "Restaurante",
  "Bar",
  "Cafeteria",
  "Padaria",
  "Salão de beleza",
  "Barbearia",
  "Clínica",
  "Consultório odontológico",
  "Academia",
  "Pet shop",
  "Hotel / Pousada",
  "Loja de varejo",
  "Oficina mecânica",
  "Imobiliária",
];

type CustomerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Quando informado, edita o cliente existente. */
  customer?: { id: string } & Partial<Record<keyof CustomerFormValues, string | null>>;
};

export function CustomerDialog(props: CustomerDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <CustomerDialogBody {...props} />}
    </Dialog>
  );
}

function initialValues(customer: CustomerDialogProps["customer"]): CustomerFormValues {
  if (!customer) return empty;
  const fields = Object.keys(empty) as (keyof CustomerFormValues)[];
  return {
    ...Object.fromEntries(fields.map((k) => [k, customer[k] ?? ""])),
    phone: formatPhone(customer.phone ?? ""),
    whatsapp: formatPhone(customer.whatsapp ?? ""),
    cnpj: formatCnpj(customer.cnpj ?? ""),
  } as CustomerFormValues;
}

function CustomerDialogBody({ onOpenChange, customer }: CustomerDialogProps) {
  const router = useRouter();
  const [values, setValues] = useState<CustomerFormValues>(() => initialValues(customer));
  const create = useServerAction(createCustomerAction);
  const update = useServerAction(updateCustomerAction);
  const action = customer ? update : create;
  const errors = action.fieldErrors;

  const set =
    (key: keyof CustomerFormValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [key]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (customer) {
      update.run({ ...values, customerId: customer.id }, { onSuccess: () => onOpenChange(false) });
    } else {
      create.run(values, {
        onSuccess: (data) => {
          onOpenChange(false);
          router.push(`/clientes/${data.id}`);
        },
      });
    }
  }

  return (
    <DialogContent
      variant="sheet"
      size="lg"
      title={customer ? "Editar cliente" : "Novo cliente"}
      description="Só nome do negócio e responsável são obrigatórios."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="customer-form" loading={action.pending}>
            {customer ? "Salvar alterações" : "Cadastrar cliente"}
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={submit} className="flex flex-col gap-6">
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-[13px] font-semibold text-ink">Contato</legend>
          <Field label="Nome fantasia do negócio" required error={firstError(errors, "businessName")}>
            {(p) => <Input {...p} autoFocus value={values.businessName} onChange={set("businessName")} />}
          </Field>
          <Field label="Nome do responsável" required error={firstError(errors, "contactName")}>
            {(p) => <Input {...p} value={values.contactName} onChange={set("contactName")} />}
          </Field>
          <Field label="Telefone" error={firstError(errors, "phone")}>
            {(p) => (
              <Input {...p} inputMode="tel" placeholder="(11) 3456-7890" value={values.phone} onChange={set("phone")} />
            )}
          </Field>
          <Field label="WhatsApp" error={firstError(errors, "whatsapp")}>
            {(p) => (
              <Input
                {...p}
                inputMode="tel"
                placeholder="(11) 98765-4321"
                value={values.whatsapp}
                onChange={set("whatsapp")}
              />
            )}
          </Field>
          <Field label="E-mail" className="sm:col-span-2" error={firstError(errors, "email")}>
            {(p) => <Input {...p} type="email" inputMode="email" value={values.email} onChange={set("email")} />}
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-[13px] font-semibold text-ink">Avaliações do Google</legend>
          <Field
            label="URL da página de avaliações"
            className="sm:col-span-2"
            error={firstError(errors, "googleReviewUrl")}
            hint="Destino gravado na placa NFC. Cole o link completo fornecido pelo cliente."
          >
            {(p) => (
              <Input
                {...p}
                type="url"
                inputMode="url"
                placeholder="https://g.page/r/..."
                value={values.googleReviewUrl}
                onChange={set("googleReviewUrl")}
              />
            )}
          </Field>
          <Field label="Nome público do estabelecimento" error={firstError(errors, "publicPlaceName")}>
            {(p) => <Input {...p} value={values.publicPlaceName} onChange={set("publicPlaceName")} />}
          </Field>
          <Field label="Personalização da placa" error={firstError(errors, "plateCustomizationNotes")}>
            {(p) => (
              <Input
                {...p}
                placeholder="Cores, logo, texto…"
                value={values.plateCustomizationNotes}
                onChange={set("plateCustomizationNotes")}
              />
            )}
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-[13px] font-semibold text-ink">Dados do negócio</legend>
          <Field label="Segmento" error={firstError(errors, "segment")}>
            {(p) => (
              <>
                <Input {...p} list="segment-suggestions" value={values.segment} onChange={set("segment")} />
                <datalist id="segment-suggestions">
                  {SEGMENT_SUGGESTIONS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="CNPJ" error={firstError(errors, "cnpj")}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                value={values.cnpj}
                onChange={set("cnpj")}
              />
            )}
          </Field>
          <Field label="Razão social" className="sm:col-span-2" error={firstError(errors, "legalName")}>
            {(p) => <Input {...p} value={values.legalName} onChange={set("legalName")} />}
          </Field>
          <Field label="Endereço" className="sm:col-span-2" error={firstError(errors, "address")}>
            {(p) => (
              <Input
                {...p}
                placeholder="Rua, número, complemento, bairro"
                value={values.address}
                onChange={set("address")}
              />
            )}
          </Field>
          <Field label="Cidade" error={firstError(errors, "city")}>
            {(p) => <Input {...p} value={values.city} onChange={set("city")} />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="UF" error={firstError(errors, "state")}>
              {(p) => (
                <Select {...p} value={values.state} onChange={set("state")}>
                  <option value="">—</option>
                  {BRAZILIAN_STATES.map((uf) => (
                    <option key={uf} value={uf}>
                      {uf}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="CEP" error={firstError(errors, "zipCode")}>
              {(p) => <Input {...p} inputMode="numeric" value={values.zipCode} onChange={set("zipCode")} />}
            </Field>
          </div>
        </fieldset>

        <Field
          label="Observações internas"
          error={firstError(errors, "notes")}
          hint="Preferências, combinados e informações comerciais."
        >
          {(p) => <Textarea {...p} rows={4} value={values.notes} onChange={set("notes")} />}
        </Field>
      </form>
    </DialogContent>
  );
}
