"use client";

import { Undo2 } from "lucide-react";
import { useState } from "react";
import { useServerAction, firstError } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { formatBRL } from "@/lib/format";
import { reverseTransactionAction } from "@/server/actions/finance";

export function ReverseTransactionButton({
  transaction,
}: {
  transaction: { id: string; number: number; description: string; amount: number; direction: "IN" | "OUT" };
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, pending, fieldErrors } = useServerAction(reverseTransactionAction);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={`Estornar lançamento ${transaction.number}`}
      >
        <Undo2 /> <span className="hidden xl:inline">Estornar</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          size="sm"
          title="Estornar lançamento"
          description={`MOV-${String(transaction.number).padStart(5, "0")} · ${transaction.description}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                loading={pending}
                disabled={reason.trim().length < 5}
                onClick={() => run({ transactionId: transaction.id, reason }, { onSuccess: () => setOpen(false) })}
              >
                Estornar {formatBRL(transaction.amount)}
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            <p className="text-sm text-ink-2">
              Será criado um lançamento compensatório de {transaction.direction === "IN" ? "saída" : "entrada"} no mesmo
              valor. O lançamento original permanece no livro-caixa.
            </p>
            <Field label="Motivo" required error={firstError(fieldErrors, "reason")}>
              {(p) => <Textarea {...p} rows={2} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
