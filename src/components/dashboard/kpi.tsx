import { cn } from "@/lib/cn";

/** Indicador: rótulo, valor em destaque e detalhes. */
export function Kpi({
  label,
  value,
  unit,
  detail,
  footer,
  tone = "neutral",
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  detail?: React.ReactNode;
  footer?: React.ReactNode;
  tone?: "neutral" | "positive" | "negative" | "warning";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <p className="text-[13px] font-medium text-ink-2">{label}</p>
      <p
        className={cn(
          "figure mt-2 font-display text-[28px] leading-none font-semibold tracking-tight",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-negative",
          tone === "warning" && "text-warning",
          tone === "neutral" && "text-ink",
        )}
      >
        {value}
        {unit && <span className="ml-1.5 font-sans text-sm font-normal tracking-normal text-muted">{unit}</span>}
      </p>
      {detail && <div className="mt-2 text-[13px] text-muted">{detail}</div>}
      {footer && <div className="mt-auto pt-3">{footer}</div>}
    </div>
  );
}

/** Valor monetário com o símbolo em tamanho menor (destaque no número). */
export function Money({ value, className }: { value: number; className?: string }) {
  const negative = value < 0;
  const formatted = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Math.abs(value),
  );
  const [int, cents] = formatted.split(",");
  return (
    <span className={cn("whitespace-nowrap", className)}>
      {negative && "−"}
      <span className="mr-0.5 align-[0.35em] text-[0.55em] font-medium text-current/60">R$</span>
      {int}
      <span className="text-[0.6em]">,{cents}</span>
    </span>
  );
}
