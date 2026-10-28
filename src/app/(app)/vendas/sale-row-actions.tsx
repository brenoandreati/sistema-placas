"use client";

import { ArrowDownLeft, Ellipsis, Eye } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PaymentDialog } from "@/components/forms/sale-dialogs";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";

export function SaleRowActions({
  sale,
  paymentMethods,
  timezone,
}: {
  sale: {
    id: string;
    number: number;
    customerName: string;
    total: number;
    amountPaid: number;
    pending: number;
    status: string;
  };
  paymentMethods: { id: string; name: string }[];
  timezone: string;
}) {
  const [payOpen, setPayOpen] = useState(false);
  return (
    <>
      <Dropdown>
        <DropdownTrigger asChild>
          <button
            type="button"
            className="rounded-lg p-1.5 text-muted hover:bg-ink/5 hover:text-ink"
            aria-label={`Ações da venda ${sale.number}`}
          >
            <Ellipsis className="size-4" />
          </button>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownItem asChild>
            <Link href={`/vendas/${sale.id}`}>
              <Eye /> Ver detalhes
            </Link>
          </DropdownItem>
          {sale.pending > 0 && sale.status !== "CANCELLED" && (
            <DropdownItem onSelect={() => setPayOpen(true)}>
              <ArrowDownLeft /> Registrar pagamento
            </DropdownItem>
          )}
        </DropdownContent>
      </Dropdown>
      {sale.pending > 0 && (
        <PaymentDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          sale={sale}
          paymentMethods={paymentMethods}
          timezone={timezone}
        />
      )}
    </>
  );
}
