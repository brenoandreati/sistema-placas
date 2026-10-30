import { Clock } from "lucide-react";
import Link from "next/link";
import { FollowUpActions } from "@/components/follow-ups/follow-up-actions";
import { FollowUpStatusBadge } from "@/components/status";
import { cn } from "@/lib/cn";
import { formatDateString } from "@/lib/dates";
import { FOLLOW_UP_TYPE_LABELS } from "@/lib/follow-ups";
import { formatPhone } from "@/lib/format";
import type { FollowUpView } from "@/server/services/follow-ups";

/** Cartão de um retorno (tela Hoje e dia selecionado no calendário): horário em destaque e ações à vista. */
export function FollowUpCard({
  followUp: f,
  canWrite,
  today,
  tz,
  showDate,
}: {
  followUp: FollowUpView;
  canWrite: boolean;
  today: string;
  tz: string;
  showDate?: boolean;
}) {
  const closed = f.status !== "SCHEDULED";
  return (
    <li className={cn("flex gap-4 px-4 py-4 sm:px-5", closed && "opacity-70")}>
      <div className="w-14 shrink-0 text-center">
        <span
          className={cn(
            "block font-display text-lg font-semibold tabular-nums",
            f.overdue ? "text-negative" : "text-ink",
          )}
        >
          {f.time ?? <Clock className="mx-auto mt-1 size-5 text-muted" aria-label="Sem horário" />}
        </span>
        {showDate && (
          <span className="block text-[11px] text-muted tabular-nums">{formatDateString(f.date).slice(0, 5)}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {f.customer ? (
            <Link href={`/clientes/${f.customer.id}?aba=contatos`} className="font-medium text-ink hover:underline">
              {f.businessName}
            </Link>
          ) : (
            <span className="font-medium text-ink">{f.businessName}</span>
          )}
          <FollowUpStatusBadge status={f.status} overdue={f.overdue} />
        </div>
        <p className="text-[13px] text-ink-2">
          {[f.contactName, f.phone ? formatPhone(f.phone) : null, FOLLOW_UP_TYPE_LABELS[f.type]]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="text-[13px] text-muted">{f.reason}</p>
        {f.notes && <p className="text-[13px] whitespace-pre-line text-ink-2">{f.notes}</p>}
        {f.outcome && <p className="text-[13px] whitespace-pre-line text-ink-2">Resultado: {f.outcome}</p>}
        <div className="mt-1">
          <FollowUpActions followUp={f} canWrite={canWrite} today={today} tz={tz} layout="card" />
        </div>
      </div>
    </li>
  );
}
