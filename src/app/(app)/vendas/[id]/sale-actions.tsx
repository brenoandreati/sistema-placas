"use client";

import { ArrowDownLeft, Ban, ChevronDown, CircleMinus, Pencil, Undo2 } from "lucide-react";
import { useState } from "react";
import {
  CancelSaleDialog,
  EditSaleDialog,
  PaymentDialog,
  RefundDialog,
  SettleRefundDialog,
  type EditableSale,
} from "@/components/forms/sale-dialogs";
import { useServerAction } from "@/components/forms/use-action";
import { useQuickActions } from "@/components/quick-actions";
import { Button } from "@/components/ui/button";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { updateSaleStatusAction } from "@/server/actions/sales";

type Option = { id: string; name: string };

export interface SaleActionsProps {
  sale: EditableSale & {
    customerName: string;
    total: number;
    pending: number;
    refundDue: number;
    items: { id: string; productName: string; quantity: number }[];
  };
  paymentMethods: Option[];
  customers: Option[];
  timezone: string;
  canCancel: boolean;
}

const NEXT_STATUS: Record<string, { value: string; label: string }[]> = {
  REGISTERED: [
    { value: "PREPARING", label: "Em preparação" },
    { value: "SHIPPED", label: "Enviada" },
    { value: "DELIVERED", label: "Entregue" },
  ],
  PREPARING: [
    { value: "SHIPPED", label: "Enviada" },
    { value: "DELIVERED", label: "Entregue" },
    { value: "REGISTERED", label: "Registrada" },
  ],
  SHIPPED: [
    { value: "DELIVERED", label: "Entregue" },
    { value: "PREPARING", label: "Em preparação" },
  ],
  DELIVERED: [{ value: "SHIPPED", label: "Enviada" }],
};

export function SaleActions({ sale, paymentMethods, customers, timezone, canCancel }: SaleActionsProps) {
  const [dialog, setDialog] = useState<null | "pay" | "edit" | "cancel" | "settle">(null);
  const { open } = useQuickActions();
  const statusAction = useServerAction(({ status }: { status: string }) => updateSaleStatusAction(sale.id, status));
  const cancelled = sale.status === "CANCELLED";
  const close = (o: boolean) => !o && setDialog(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {!cancelled && sale.pending > 0 && (
          <Button onClick={() => setDialog("pay")}>
            <ArrowDownLeft /> Registrar pagamento
          </Button>
        )}
        {cancelled && sale.refundDue > 0 && (
          <Button onClick={() => setDialog("settle")}>
            <Undo2 /> Devolver valor ao cliente
          </Button>
        )}
        {!cancelled && (
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="secondary" loading={statusAction.pending}>
                Status <ChevronDown />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownLabel>Mudar para</DropdownLabel>
              {(NEXT_STATUS[sale.status] ?? []).map((s) => (
                <DropdownItem key={s.value} onSelect={() => statusAction.run({ status: s.value })}>
                  {s.label}
                </DropdownItem>
              ))}
            </DropdownContent>
          </Dropdown>
        )}
        {!cancelled && (
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="secondary">
                Mais <ChevronDown />
              </Button>
            </DropdownTrigger>
            <DropdownContent className="w-64">
              <DropdownItem onSelect={() => setDialog("edit")}>
                <Pencil /> Editar dados da venda
              </DropdownItem>
              <DropdownItem onSelect={() => open({ type: "expense", saleId: sale.id })}>
                <CircleMinus /> Lançar custo desta venda
              </DropdownItem>
              {canCancel && (
                <>
                  <DropdownSeparator />
                  <DropdownItem tone="danger" onSelect={() => setDialog("cancel")}>
                    <Ban /> Cancelar venda
                  </DropdownItem>
                </>
              )}
            </DropdownContent>
          </Dropdown>
        )}
      </div>

      {!cancelled && sale.pending > 0 && (
        <PaymentDialog
          open={dialog === "pay"}
          onOpenChange={close}
          sale={{
            id: sale.id,
            number: sale.number,
            customerName: sale.customerName,
            total: sale.total,
            amountPaid: sale.amountPaid,
            paymentMethodId: sale.paymentMethodId,
          }}
          paymentMethods={paymentMethods}
          timezone={timezone}
        />
      )}
      {!cancelled && (
        <EditSaleDialog
          open={dialog === "edit"}
          onOpenChange={close}
          sale={sale}
          paymentMethods={paymentMethods}
          customers={customers}
          timezone={timezone}
        />
      )}
      {!cancelled && canCancel && (
        <CancelSaleDialog
          open={dialog === "cancel"}
          onOpenChange={close}
          sale={{ id: sale.id, number: sale.number, amountPaid: sale.amountPaid, items: sale.items }}
          timezone={timezone}
        />
      )}
      {cancelled && sale.refundDue > 0 && (
        <SettleRefundDialog
          open={dialog === "settle"}
          onOpenChange={close}
          sale={{ id: sale.id, number: sale.number, refundDue: sale.refundDue }}
          timezone={timezone}
        />
      )}
    </>
  );
}

export function RefundButton({
  payment,
  timezone,
}: {
  payment: { id: string; number: number; amount: number; refundable: number; paymentMethod: string };
  timezone: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-negative hover:bg-negative-soft hover:text-negative"
      >
        <Undo2 /> Estornar
      </Button>
      <RefundDialog open={open} onOpenChange={setOpen} payment={payment} timezone={timezone} />
    </>
  );
}
