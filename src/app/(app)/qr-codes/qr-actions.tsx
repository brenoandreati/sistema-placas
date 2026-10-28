"use client";

import {
  Copy,
  Download,
  Globe,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  SquareArrowOutUpRight,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { QrCodeDialog, type EditableQrCode } from "@/components/forms/qr-code-form";
import { firstError, useServerAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Field, Input } from "@/components/ui/form";
import { MAX_QR_BATCH } from "@/lib/qr";
import { createQrBatchAction, updateQrBaseUrlAction } from "@/server/actions/qr-codes";

export function GenerateQrBatchButton({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus /> Gerar QR codes
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && <GenerateQrBatchBody onClose={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function GenerateQrBatchBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [quantity, setQuantity] = useState("50");
  const [notes, setNotes] = useState("");
  const { run, pending, fieldErrors } = useServerAction(createQrBatchAction);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      { quantity, notes },
      {
        successMessage: null,
        onSuccess: (batch) => {
          toast.success(`${batch.quantity} QR code(s) gerado(s) no lote ${batch.number}.`);
          onClose();
          router.push(`/qr-codes?lote=${batch.number}`);
        },
      },
    );
  }

  return (
    <DialogContent
      size="sm"
      title="Gerar QR codes"
      description="Cada QR code recebe um código próprio, ainda sem link. Imprima e cadastre o link de cada um depois."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="qr-batch-form" loading={pending}>
            Gerar
          </Button>
        </>
      }
    >
      <form id="qr-batch-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Quantidade"
          required
          error={firstError(fieldErrors, "quantity")}
          hint={`Até ${MAX_QR_BATCH} por lote.`}
        >
          {(p) => (
            <Input
              {...p}
              autoFocus
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_QR_BATCH}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          )}
        </Field>
        <Field label="Observação (opcional)" error={firstError(fieldErrors, "notes")}>
          {(p) => (
            <Input
              {...p}
              maxLength={200}
              placeholder="Ex.: adesivos para placas de acrílico"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </Field>
      </form>
    </DialogContent>
  );
}

export function QrBaseUrlButton({ current, origin }: { current: string | null; origin: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Globe /> Endereço dos QR codes
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && <QrBaseUrlBody current={current} origin={origin} onClose={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function QrBaseUrlBody({ current, origin, onClose }: { current: string | null; origin: string; onClose: () => void }) {
  const [value, setValue] = useState(current ?? "");
  const { run, pending, fieldErrors } = useServerAction(updateQrBaseUrlAction);
  const preview = (value.trim() || origin).replace(/\/+$/, "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run({ qrBaseUrl: value }, { onSuccess: onClose });
  }

  return (
    <DialogContent
      title="Endereço dos QR codes"
      description="O domínio que fica gravado em cada QR code impresso."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="qr-base-form" loading={pending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="qr-base-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Domínio"
          error={firstError(fieldErrors, "qrBaseUrl")}
          hint={`Em branco, usa o endereço atual do painel (${origin}).`}
        >
          {(p) => (
            <Input
              {...p}
              autoFocus
              type="url"
              inputMode="url"
              placeholder="https://suaplaca.com.br"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
          Os QR codes vão abrir <span className="font-mono [overflow-wrap:anywhere]">{preview}/q/XXXXXX</span>
        </p>
        <div className="rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-ink-2">
          <p className="font-medium text-warning">Defina antes de imprimir.</p>
          <p className="mt-0.5">
            O domínio precisa estar ligado a este sistema (na Cloudflare: Worker → Domínios). Se trocar depois de
            imprimir, as placas antigas só continuam funcionando enquanto o domínio antigo também apontar para cá.
          </p>
        </div>
      </form>
    </DialogContent>
  );
}

export function QrRowActions({
  qr,
  publicUrl,
  canWrite,
}: {
  qr: EditableQrCode;
  publicUrl: string;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Endereço do QR code copiado.");
    } catch {
      toast.error("Não foi possível copiar. Endereço: " + publicUrl);
    }
  }

  // Gerado no navegador (o desenho do QR pesa no limite de CPU do Worker); a biblioteca só carrega no clique.
  async function download() {
    try {
      const { qrSvgFile } = await import("@/lib/qr-svg");
      const url = URL.createObjectURL(new Blob([qrSvgFile(publicUrl)], { type: "image/svg+xml" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `qr-${qr.code}.svg`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error("Não foi possível gerar a imagem. Tente novamente.");
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {canWrite && (
        <Button
          variant={qr.destinationUrl ? "ghost" : "secondary"}
          size="sm"
          onClick={() => setEditing(true)}
          aria-label={`${qr.destinationUrl ? "Editar link do" : "Cadastrar link no"} QR code ${qr.code}`}
        >
          {qr.destinationUrl ? <Pencil /> : <Link2 />}
          <span className="max-sm:sr-only">{qr.destinationUrl ? "Editar" : "Cadastrar link"}</span>
        </Button>
      )}
      <Dropdown>
        <DropdownTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Mais ações do QR code ${qr.code}`}>
            <MoreHorizontal />
          </Button>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownItem asChild>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer">
              <SquareArrowOutUpRight /> {qr.destinationUrl ? "Testar (abrir como cliente)" : "Abrir página de ativação"}
            </a>
          </DropdownItem>
          <DropdownItem onSelect={copy}>
            <Copy /> Copiar endereço (para gravar no NFC)
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem asChild>
            <Link href={`/imprimir/qr-codes?codigo=${qr.code}`}>
              <Printer /> Imprimir este QR code
            </Link>
          </DropdownItem>
          <DropdownItem onSelect={download}>
            <Download /> Baixar imagem (SVG)
          </DropdownItem>
        </DropdownContent>
      </Dropdown>
      {canWrite && <QrCodeDialog open={editing} onOpenChange={setEditing} qr={qr} />}
    </div>
  );
}
