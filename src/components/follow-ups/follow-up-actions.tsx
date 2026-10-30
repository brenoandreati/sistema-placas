"use client";

import {
  CalendarClock,
  CircleCheck,
  Eye,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { FollowUpDialog } from "@/components/forms/follow-up-dialog";
import { QuickActionButton } from "@/components/quick-actions";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import type { FollowUpResultStatus } from "@/lib/follow-ups";
import { whatsappLink } from "@/lib/format";
import type { FollowUpView } from "@/server/services/follow-ups";
import {
  CancelDialogBody,
  ContactLinks,
  DetailsDialogBody,
  RescheduleDialogBody,
  ResultDialogBody,
} from "./follow-up-dialogs";

type DialogKind = "details" | "edit" | "result" | "reschedule" | "cancel";

/** Botão "Agendar retorno" (opcionalmente já com o cliente escolhido). */
export function NewFollowUpButton({ customerId, ...props }: { customerId?: string } & Omit<ButtonProps, "onClick">) {
  return (
    <QuickActionButton action={{ type: "follow-up", customerId }} {...props}>
      {props.children ?? (
        <>
          <Plus /> Agendar retorno
        </>
      )}
    </QuickActionButton>
  );
}

/**
 * Ações de um retorno: detalhes, editar, reagendar, registrar resultado, cancelar e contato (WhatsApp/ligação).
 * `layout="menu"` para linhas de tabela; `layout="card"` mostra os botões principais à vista (tela Hoje).
 */
export function FollowUpActions({
  followUp,
  canWrite,
  today,
  tz,
  layout = "menu",
}: {
  followUp: FollowUpView;
  canWrite: boolean;
  today: string;
  tz: string;
  layout?: "menu" | "card";
}) {
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [resultStatus, setResultStatus] = useState<FollowUpResultStatus>("DONE");
  const pending = followUp.status === "SCHEDULED";
  const closed = followUp.status === "RESCHEDULED" || followUp.status === "CANCELLED";
  const wa = whatsappLink(followUp.phone);
  const close = () => setDialog(null);
  const openResult = (status: FollowUpResultStatus) => {
    setResultStatus(status);
    setDialog("result");
  };

  const menu = (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Ações do retorno com ${followUp.businessName}`}>
          <MoreHorizontal />
        </Button>
      </DropdownTrigger>
      <DropdownContent>
        <DropdownItem onSelect={() => setDialog("details")}>
          <Eye /> Ver detalhes e histórico
        </DropdownItem>
        {canWrite && (
          <>
            <DropdownItem onSelect={() => setDialog("edit")}>
              <Pencil /> Editar
            </DropdownItem>
            {pending && (
              <>
                <DropdownItem onSelect={() => openResult("DONE")}>
                  <CircleCheck /> Marcar como realizado
                </DropdownItem>
                <DropdownItem onSelect={() => openResult("NO_CONTACT")}>
                  <CalendarClock /> Registrar resultado
                </DropdownItem>
              </>
            )}
            {!pending && !closed && (
              <DropdownItem onSelect={() => setDialog("result")}>
                <CalendarClock /> Corrigir resultado
              </DropdownItem>
            )}
            {followUp.status !== "RESCHEDULED" && (
              <DropdownItem onSelect={() => setDialog("reschedule")}>
                <RotateCcw /> {pending ? "Reagendar retorno" : "Agendar próximo retorno"}
              </DropdownItem>
            )}
          </>
        )}
        {followUp.phone && <DropdownSeparator />}
        {wa && (
          <DropdownItem asChild>
            <a href={wa} target="_blank" rel="noopener noreferrer">
              <MessageCircle /> Abrir no WhatsApp
            </a>
          </DropdownItem>
        )}
        {followUp.phone && (
          <DropdownItem asChild>
            <a href={`tel:${followUp.phone}`}>
              <Phone /> Ligar
            </a>
          </DropdownItem>
        )}
        {canWrite && pending && (
          <>
            <DropdownSeparator />
            <DropdownItem tone="danger" onSelect={() => setDialog("cancel")}>
              <XCircle /> Cancelar retorno
            </DropdownItem>
          </>
        )}
      </DropdownContent>
    </Dropdown>
  );

  return (
    <>
      {layout === "card" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <ContactLinks phone={followUp.phone} />
          {canWrite && pending && (
            <>
              <Button size="sm" onClick={() => openResult("DONE")}>
                <CircleCheck /> Registrar resultado
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDialog("reschedule")}>
                <RotateCcw /> Reagendar
              </Button>
            </>
          )}
          {menu}
        </div>
      ) : (
        <div className="flex items-center justify-end">{menu}</div>
      )}

      <Dialog open={dialog !== null && dialog !== "edit"} onOpenChange={(open) => !open && close()}>
        {dialog === "details" && (
          <DetailsDialogBody
            followUp={followUp}
            tz={tz}
            canWrite={canWrite}
            onClose={close}
            onAction={(next) => (next === "result" ? openResult("DONE") : setDialog(next))}
          />
        )}
        {dialog === "result" && (
          <ResultDialogBody followUp={followUp} today={today} initialStatus={resultStatus} onClose={close} />
        )}
        {dialog === "reschedule" && <RescheduleDialogBody followUp={followUp} today={today} onClose={close} />}
        {dialog === "cancel" && <CancelDialogBody followUp={followUp} onClose={close} />}
      </Dialog>
      {canWrite && (
        <FollowUpDialog open={dialog === "edit"} onOpenChange={(open) => !open && close()} followUp={followUp} />
      )}
    </>
  );
}
