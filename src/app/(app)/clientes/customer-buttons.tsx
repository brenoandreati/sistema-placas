"use client";

import { Pencil, Plus, Power, Trash } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CustomerDialog } from "@/components/forms/customer-dialog";
import { useServerAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { deleteCustomerAction, setCustomerActiveAction } from "@/server/actions/customers";

export function NewCustomerButton({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus /> Novo cliente
      </Button>
      <CustomerDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

type EditableCustomer = Parameters<typeof CustomerDialog>[0]["customer"];

export function EditCustomerButton({ customer }: { customer: NonNullable<EditableCustomer> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Pencil /> Editar
      </Button>
      <CustomerDialog open={open} onOpenChange={setOpen} customer={customer} />
    </>
  );
}

export function CustomerStatusButtons({
  customerId,
  businessName,
  active,
  hasSales,
  canDelete,
}: {
  customerId: string;
  businessName: string;
  active: boolean;
  hasSales: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toggle = useServerAction(({ value }: { value: boolean }) => setCustomerActiveAction(customerId, value));
  const remove = useServerAction(() => deleteCustomerAction(customerId));
  return (
    <>
      <Button variant="secondary" loading={toggle.pending} onClick={() => toggle.run({ value: !active })}>
        <Power /> {active ? "Desativar" : "Reativar"}
      </Button>
      {canDelete && !hasSales && (
        <Button variant="danger-outline" onClick={() => setConfirmDelete(true)}>
          <Trash /> Excluir
        </Button>
      )}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent
          size="sm"
          title="Excluir cliente?"
          description={`${businessName} não tem vendas e será removido definitivamente.`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                Manter cliente
              </Button>
              <Button
                variant="danger"
                loading={remove.pending}
                onClick={() => remove.run(undefined, { onSuccess: () => router.push("/clientes") })}
              >
                Excluir definitivamente
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-2">
            A exclusão fica registrada na auditoria. Clientes com vendas só podem ser desativados.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
