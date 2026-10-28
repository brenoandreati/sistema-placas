import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import type { Alert } from "@/server/services/alerts";

const ICONS = { critical: CircleAlert, warning: TriangleAlert, info: Info };
const LABELS = { critical: "Crítico", warning: "Atenção", info: "Informativo" };

export function AlertsList({ alerts, limit = 6 }: { alerts: Alert[]; limit?: number }) {
  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-3 px-5 py-6 text-sm text-ink-2">
        <CircleCheck className="size-5 text-positive" aria-hidden />
        Nenhum alerta no momento. Estoque, pagamentos e caixa estão em dia.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {alerts.slice(0, limit).map((alert) => {
        const Icon = ICONS[alert.severity];
        return (
          <li key={alert.id}>
            <Link href={alert.href} className="group flex gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  alert.severity === "critical" && "text-negative",
                  alert.severity === "warning" && "text-warning",
                  alert.severity === "info" && "text-primary",
                )}
                aria-label={LABELS[alert.severity]}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{alert.title}</span>
                <span className="block text-[13px] text-muted">{alert.description}</span>
              </span>
              <span className="hidden shrink-0 self-center text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 sm:block">
                {alert.actionLabel} →
              </span>
            </Link>
          </li>
        );
      })}
      {alerts.length > limit && <li className="px-5 py-2.5 text-xs text-muted">+ {alerts.length - limit} alerta(s)</li>}
    </ul>
  );
}
