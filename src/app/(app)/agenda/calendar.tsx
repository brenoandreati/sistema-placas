import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { addDaysToDate, formatDateString } from "@/lib/dates";
import { FOLLOW_UP_TYPE_LABELS } from "@/lib/follow-ups";
import type { FollowUpView } from "@/server/services/follow-ups";

export type CalendarMode = "mes" | "semana";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Dia da semana (0 = domingo) de uma data yyyy-MM-dd. */
function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function shiftMonth(date: string, months: number): string {
  const d = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Primeiro e último dia (exclusivo) exibidos: semanas inteiras de domingo a sábado. */
export function calendarRange(mode: CalendarMode, ref: string): { first: string; end: string; days: string[] } {
  let first: string;
  let count: number;
  if (mode === "semana") {
    first = addDaysToDate(ref, -weekday(ref));
    count = 7;
  } else {
    const monthStart = `${ref.slice(0, 7)}-01`;
    first = addDaysToDate(monthStart, -weekday(monthStart));
    const nextMonth = shiftMonth(ref, 1);
    const lastDay = addDaysToDate(nextMonth, -1);
    const lastCell = addDaysToDate(lastDay, 6 - weekday(lastDay));
    count = Math.round((Date.parse(`${lastCell}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / 86_400_000) + 1;
  }
  const days = Array.from({ length: count }, (_, i) => addDaysToDate(first, i));
  return { first, end: addDaysToDate(first, count), days };
}

const DOT: Record<string, string> = {
  SCHEDULED: "bg-primary",
  DONE: "bg-positive",
  SOLD: "bg-positive",
  NO_CONTACT: "bg-warning",
  NOT_INTERESTED: "bg-muted",
  RESCHEDULED: "bg-muted",
  CANCELLED: "bg-line-strong",
};

function dotClass(f: FollowUpView) {
  return f.overdue ? "bg-negative" : (DOT[f.status] ?? "bg-muted");
}

export function AgendaCalendar({
  mode,
  refDate,
  selected,
  today,
  items,
  href,
}: {
  mode: CalendarMode;
  refDate: string;
  selected: string | null;
  today: string;
  items: FollowUpView[];
  href: (params: Record<string, string | null>) => string;
}) {
  const { days } = calendarRange(mode, refDate);
  const byDay = new Map<string, FollowUpView[]>();
  for (const item of items) byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);
  const month = refDate.slice(0, 7);
  const title =
    mode === "mes"
      ? format(new Date(`${refDate.slice(0, 7)}-01T12:00:00Z`), "MMMM 'de' yyyy", { locale: ptBR })
      : `${formatDateString(days[0]).slice(0, 5)} a ${formatDateString(days[6])}`;
  const prev = mode === "mes" ? shiftMonth(refDate, -1) : addDaysToDate(refDate, -7);
  const next = mode === "mes" ? shiftMonth(refDate, 1) : addDaysToDate(refDate, 7);
  const navLink =
    "inline-flex h-8 items-center gap-1 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] font-medium text-ink-2 hover:bg-surface-2";
  const modeLink = (active: boolean) =>
    cn(
      "h-8 rounded-lg px-3 text-[13px] leading-8 font-medium",
      active ? "bg-ink text-white" : "text-ink-2 hover:bg-ink/[0.05]",
    );

  return (
    <div className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href={href({ data: prev, dia: null })} className={navLink} aria-label="Anterior" scroll={false}>
            <ChevronLeft className="size-4" />
          </Link>
          <Link href={href({ data: next, dia: null })} className={navLink} aria-label="Próximo" scroll={false}>
            <ChevronRight className="size-4" />
          </Link>
          <h2 className="ml-1 font-display text-base font-semibold text-ink first-letter:uppercase">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Link href={href({ data: today, dia: today })} className={navLink} scroll={false}>
            Hoje
          </Link>
          <div className="flex gap-1 rounded-xl border border-line bg-surface p-1">
            <Link href={href({ modo: "mes", dia: null })} className={modeLink(mode === "mes")} scroll={false}>
              Mês
            </Link>
            <Link href={href({ modo: "semana", dia: null })} className={modeLink(mode === "semana")} scroll={false}>
              Semana
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-7 [gap:1px] overflow-hidden rounded-xl border border-line bg-line">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-surface-2 px-1 py-1.5 text-center text-[11px] font-medium text-muted sm:px-2">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const list = byDay.get(day) ?? [];
          const outside = mode === "mes" && day.slice(0, 7) !== month;
          const isSelected = day === selected;
          return (
            <Link
              key={day}
              href={href({ dia: day })}
              scroll={false}
              aria-label={`${formatDateString(day)}: ${list.length} retorno(s)`}
              aria-current={isSelected ? "date" : undefined}
              className={cn(
                "flex flex-col gap-1 bg-surface p-1 transition-colors hover:bg-surface-2 sm:p-1.5",
                mode === "mes" ? "min-h-16 sm:min-h-24" : "min-h-28 sm:min-h-40",
                outside && "bg-surface-2/60",
                isSelected && "bg-primary-soft hover:bg-primary-soft",
              )}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                  day === today ? "bg-primary font-semibold text-white" : outside ? "text-muted/70" : "text-ink-2",
                )}
              >
                {Number(day.slice(8))}
              </span>
              {/* Celular: só os pontos; telas maiores: horário e cliente. */}
              <span className="flex flex-wrap gap-0.5 sm:hidden">
                {list.slice(0, 6).map((f) => (
                  <span key={f.id} className={cn("size-1.5 rounded-full", dotClass(f))} />
                ))}
              </span>
              <span className="hidden flex-col gap-0.5 sm:flex">
                {list.slice(0, mode === "mes" ? 3 : 8).map((f) => (
                  <span
                    key={f.id}
                    title={`${f.time ?? "Sem horário"} · ${f.businessName} · ${FOLLOW_UP_TYPE_LABELS[f.type]}`}
                    className={cn(
                      "flex items-center gap-1 truncate rounded px-1 text-[11px] leading-5",
                      f.status === "SCHEDULED"
                        ? "bg-ink/[0.04] text-ink"
                        : f.status === "CANCELLED" || f.status === "RESCHEDULED"
                          ? "text-muted line-through decoration-muted/50"
                          : "text-muted",
                    )}
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", dotClass(f))} />
                    <span className="truncate">
                      {f.time ? `${f.time} ` : ""}
                      {f.businessName}
                    </span>
                  </span>
                ))}
                {list.length > (mode === "mes" ? 3 : 8) && (
                  <span className="px-1 text-[11px] text-muted">+{list.length - (mode === "mes" ? 3 : 8)} mais</span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-primary" /> Agendado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-negative" /> Atrasado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-positive" /> Realizado / venda
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-warning" /> Sem contato
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-muted" /> Reagendado / sem interesse
        </span>
      </div>
    </div>
  );
}
