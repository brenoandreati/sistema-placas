"use client";

import { ArrowDownLeft, MessageCircle } from "lucide-react";
import { useState } from "react";
import { PaymentDialog } from "@/components/forms/sale-dialogs";
import { Button } from "@/components/ui/button";

export function ReceivableActions({
  sale,
  paymentMethods,
  timezone,
  whatsappHref,
}: {
  sale: { id: string; number: number; customerName: string; total: number; amountPaid: number };
  paymentMethods: { id: string; name: string }[];
  timezone: string;
  whatsappHref: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center justify-end gap-1.5">
      {whatsappHref && (
        <Button
          asChild
          size="icon"
          variant="ghost"
          className="text-positive"
          aria-label={`Cobrar ${sale.customerName} pelo WhatsApp`}
        >
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
            <MessageCircle />
          </a>
        </Button>
      )}
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <ArrowDownLeft /> Receber
      </Button>
      <PaymentDialog
        open={open}
        onOpenChange={setOpen}
        sale={sale}
        paymentMethods={paymentMethods}
        timezone={timezone}
      />
    </div>
  );
}
