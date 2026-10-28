"use client";

import { Eye, Undo2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { firstError, useServerAction } from "@/components/forms/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { formatDateTime } from "@/lib/dates";
import { formatBRL, formatRecordNumber } from "@/lib/format";
import { reverseWithdrawalAction } from "@/server/actions/finance";
import type { WithdrawalView } from "@/server/services/withdrawals";

export function WithdrawalDetails({
  withdrawal,
  timezone,
  canReverse,
  autoOpen = false,
}: {
  withdrawal: WithdrawalView;
  timezone: string;
  canReverse: boolean;
  /** Abre automaticamente quando a URL aponta para esta retirada (?id=). */
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(autoOpen && searchParams.get("id") === withdrawal.id);
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState("");
  const { run, pending, fieldErrors } = useServerAction(reverseWithdrawalAction);

  function onOpenChange(next: boolean) {
    setOpen(next);
    setReversing(false);
    if (!next && searchParams.get("id")) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("id");
      router.replace(params.toString() ? `/retiradas?${params}` : "/retiradas", { scroll: false });
    }
  }

  const rows: [string, React.ReactNode][] = [
    [
      "Valor",
      <span key="v" className="tabular font-semibold text-negative">
        − {formatBRL(withdrawal.amount)}
      </span>,
    ],
    ["Data", formatDateTime(withdrawal.withdrawnAt, timezone)],
    ["Categoria", withdrawal.category],
    ["Forma de retirada", withdrawal.paymentMethod],
    ["Conta de caixa", withdrawal.cashAccount],
    ["Saldo antes", formatBRL(withdrawal.balanceBefore)],
    ["Saldo após", formatBRL(withdrawal.balanceAfter)],
    ["Descrição", withdrawal.description],
    ["Observações", withdrawal.notes ?? "—"],
    [
      "Registrada",
      `${formatDateTime(withdrawal.createdAt, timezone)}${withdrawal.createdBy ? ` por ${withdrawal.createdBy}` : ""}`,
    ],
  ];
  if (withdrawal.negativeBalanceJustification)
    rows.push(["Justificativa (saldo negativo)", withdrawal.negativeBalanceJustification]);
  if (withdrawal.status === "REVERSED") {
    rows.push([
      "Estornada",
      `${withdrawal.reversedAt ? formatDateTime(withdrawal.reversedAt, timezone) : ""}${withdrawal.reversedBy ? ` por ${withdrawal.reversedBy}` : ""}`,
    ]);
    rows.push(["Motivo do estorno", withdrawal.reversalReason ?? "—"]);
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={`Detalhes da retirada ${withdrawal.number}`}
      >
        <Eye /> <span className="hidden sm:inline">Detalhes</span>
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          title={`Retirada ${formatRecordNumber("RET", withdrawal.number)}`}
          description={withdrawal.status === "REVERSED" ? "Estornada — não afeta mais o saldo." : "Ativa"}
          footer={
            canReverse && withdrawal.status === "ACTIVE" ? (
              reversing ? (
                <>
                  <Button variant="secondary" onClick={() => setReversing(false)}>
                    Voltar
                  </Button>
                  <Button
                    variant="danger"
                    loading={pending}
                    disabled={reason.trim().length < 5}
                    onClick={() =>
                      run({ withdrawalId: withdrawal.id, reason }, { onSuccess: () => onOpenChange(false) })
                    }
                  >
                    Confirmar estorno
                  </Button>
                </>
              ) : (
                <Button variant="danger-outline" onClick={() => setReversing(true)}>
                  <Undo2 /> Estornar retirada
                </Button>
              )
            ) : undefined
          }
        >
          {reversing ? (
            <div className="grid gap-4">
              <p className="text-sm text-ink-2">
                O estorno devolve {formatBRL(withdrawal.amount)} ao saldo por meio de um lançamento compensatório. A
                retirada continua no histórico, marcada como estornada.
              </p>
              <Field label="Motivo do estorno" required error={firstError(fieldErrors, "reason")}>
                {(p) => (
                  <Textarea {...p} rows={2} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
                )}
              </Field>
            </div>
          ) : (
            <dl className="divide-y divide-line rounded-xl border border-line">
              {rows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                  <dt className="shrink-0 text-muted">{label}</dt>
                  <dd className="text-right text-ink">{value}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                <dt className="text-muted">Status</dt>
                <dd>
                  {withdrawal.status === "ACTIVE" ? (
                    <Badge tone="neutral">Ativa</Badge>
                  ) : (
                    <Badge tone="outline">Estornada</Badge>
                  )}
                </dd>
              </div>
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
