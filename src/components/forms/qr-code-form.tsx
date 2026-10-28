"use client";

import { ExternalLink, Star, Unlink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { getQrFormCustomersAction, updateQrCodeAction } from "@/server/actions/qr-codes";
import { CustomerCombobox } from "./customer-combobox";
import { firstError, useServerAction } from "./use-action";

type CustomerOption = Awaited<ReturnType<typeof getQrFormCustomersAction>>[number];

export interface EditableQrCode {
  code: string;
  destinationUrl: string | null;
  customer: { id: string; businessName: string } | null;
  label: string | null;
}

interface Values {
  destinationUrl: string;
  customerId: string | null;
  label: string;
}

/** "g.page/r/..." vira "https://g.page/r/...": o QR só redireciona para endereços web completos. */
function withScheme(value: string): string {
  const v = value.trim();
  return v && !/^[a-z][a-z0-9+.-]*:/i.test(v) ? `https://${v}` : v;
}

/** Estado e envio do formulário de link, compartilhado entre o diálogo do painel e a página de ativação. */
function useQrCodeEditor(qr: EditableQrCode, onSaved?: () => void) {
  const [values, setValues] = useState<Values>({
    destinationUrl: qr.destinationUrl ?? "",
    customerId: qr.customer?.id ?? null,
    label: qr.label ?? "",
  });
  const [loaded, setLoaded] = useState<CustomerOption[] | null>(null);
  const action = useServerAction(updateQrCodeAction);

  useEffect(() => {
    let cancelled = false;
    getQrFormCustomersAction()
      .then((list) => !cancelled && setLoaded(list))
      .catch(() => !cancelled && setLoaded([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // Cliente já vinculado, mas desativado, continua aparecendo como selecionado.
  const customers = useMemo(() => {
    const list = loaded ?? [];
    if (!qr.customer || list.some((c) => c.id === qr.customer!.id)) return list;
    return [
      {
        id: qr.customer.id,
        businessName: qr.customer.businessName,
        contactName: "",
        phone: null,
        googleReviewUrl: null,
      },
      ...list,
    ];
  }, [loaded, qr.customer]);

  function save(destinationUrl = values.destinationUrl) {
    const url = withScheme(destinationUrl);
    action.run(
      { code: qr.code, destinationUrl: url, customerId: values.customerId, label: values.label },
      {
        successMessage: !url
          ? "Link removido. O QR code ficou desativado."
          : qr.destinationUrl
            ? "Link salvo."
            : `QR code ${qr.code} ativado.`,
        onSuccess: () => onSaved?.(),
      },
    );
  }

  return { values, setValues, customers, customersLoaded: loaded !== null, save, action };
}

type Editor = ReturnType<typeof useQrCodeEditor>;

function QrCodeFields({ editor, autoFocus }: { editor: Editor; autoFocus?: boolean }) {
  const { values, setValues, customers, customersLoaded, action } = editor;
  const errors = action.fieldErrors;
  const selected = customers.find((c) => c.id === values.customerId) ?? null;
  const reviewUrl = selected?.googleReviewUrl ?? null;
  const testable = /^https?:\/\/\S+\.\S+/i.test(withScheme(values.destinationUrl));

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Link de destino"
        error={firstError(errors, "destinationUrl")}
        hint="Para onde vai quem escanear a placa. Deixe em branco para desativar o QR code."
      >
        {(p) => (
          <div className="flex gap-2">
            <Input
              {...p}
              autoFocus={autoFocus}
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://g.page/r/.../review"
              value={values.destinationUrl}
              onChange={(e) => setValues((v) => ({ ...v, destinationUrl: e.target.value }))}
              onBlur={() => setValues((v) => ({ ...v, destinationUrl: withScheme(v.destinationUrl) }))}
            />
            {testable && (
              <Button asChild variant="secondary" size="icon" className="h-10 w-10">
                <a
                  href={withScheme(values.destinationUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Abrir o link em outra aba"
                  title="Abrir o link em outra aba"
                >
                  <ExternalLink />
                </a>
              </Button>
            )}
          </div>
        )}
      </Field>
      {reviewUrl && reviewUrl !== values.destinationUrl && (
        <button
          type="button"
          onClick={() => setValues((v) => ({ ...v, destinationUrl: reviewUrl }))}
          className="-mt-2 inline-flex w-fit items-center gap-1.5 text-left text-[13px] font-medium text-primary hover:underline"
        >
          <Star className="size-3.5 shrink-0" /> Usar o link de avaliações de {selected!.businessName}
        </button>
      )}

      <Field
        label="Cliente (opcional)"
        error={firstError(errors, "customerId")}
        hint="Com cliente vinculado, o QR code aparece na ficha dele."
      >
        {(p) => (
          <div className="flex flex-col gap-1.5">
            <CustomerCombobox
              id={p.id}
              customers={customers}
              value={values.customerId}
              invalid={p["aria-invalid"]}
              onChange={(c) =>
                setValues((v) => ({
                  ...v,
                  customerId: c.id,
                  // Destino vazio: já sugere o link de avaliações do cliente.
                  destinationUrl: v.destinationUrl || (c as CustomerOption).googleReviewUrl || "",
                }))
              }
            />
            {!customersLoaded && <span className="text-xs text-muted">Carregando clientes…</span>}
            {values.customerId && (
              <button
                type="button"
                onClick={() => setValues((v) => ({ ...v, customerId: null }))}
                className="w-fit text-xs font-medium text-muted hover:text-ink"
              >
                Remover cliente
              </button>
            )}
          </div>
        )}
      </Field>

      <Field
        label="Identificação (opcional)"
        error={firstError(errors, "label")}
        hint="Ajuda a diferenciar várias placas do mesmo cliente."
      >
        {(p) => (
          <Input
            {...p}
            maxLength={120}
            placeholder="Ex.: Balcão, Mesa 3"
            value={values.label}
            onChange={(e) => setValues((v) => ({ ...v, label: e.target.value }))}
          />
        )}
      </Field>
    </div>
  );
}

/** Diálogo do painel para cadastrar, trocar ou remover o link de um QR code. */
export function QrCodeDialog({
  open,
  onOpenChange,
  qr,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  qr: EditableQrCode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <QrCodeDialogBody qr={qr} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function QrCodeDialogBody({ qr, onClose }: { qr: EditableQrCode; onClose: () => void }) {
  const editor = useQrCodeEditor(qr, onClose);
  const formId = `qr-form-${qr.code}`;
  return (
    <DialogContent
      title={
        <>
          QR code <span className="font-mono">{qr.code}</span>
        </>
      }
      description="O código impresso na placa não muda: cadastre ou troque o link quando quiser."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          {qr.destinationUrl && (
            <Button
              type="button"
              variant="danger-outline"
              disabled={editor.action.pending}
              onClick={() => editor.save("")}
            >
              <Unlink /> Remover link
            </Button>
          )}
          <Button type="submit" form={formId} loading={editor.action.pending}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          editor.save();
        }}
      >
        <QrCodeFields editor={editor} autoFocus />
      </form>
    </DialogContent>
  );
}

/** Formulário da página aberta ao escanear um QR code (dono logado no celular). */
export function QrActivationForm({ qr }: { qr: EditableQrCode }) {
  const editor = useQrCodeEditor(qr);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        editor.save();
      }}
      className="flex flex-col gap-5"
    >
      <QrCodeFields editor={editor} />
      <Button type="submit" size="lg" loading={editor.action.pending}>
        {qr.destinationUrl ? "Salvar link" : "Ativar QR code"}
      </Button>
    </form>
  );
}
