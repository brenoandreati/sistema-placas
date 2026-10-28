import { cn } from "@/lib/cn";

/**
 * Medidor de estoque: cada traço é uma fatia do estoque de referência, como placas
 * enfileiradas vistas de lado. O marcador indica o estoque mínimo.
 */
export function StockMeter({
  current,
  minimum,
  segments = 40,
  className,
}: {
  current: number;
  minimum: number;
  segments?: number;
  className?: string;
}) {
  const capacity = Math.max(current, minimum * 3, 10);
  const filled = current <= 0 ? 0 : Math.max(1, Math.round((current / capacity) * segments));
  const minIndex = minimum > 0 ? Math.min(segments - 1, Math.round((minimum / capacity) * segments)) : -1;
  const state = current <= 0 ? "out" : current <= minimum ? "low" : "ok";
  const fill = state === "ok" ? "bg-ink/80" : state === "low" ? "bg-warning" : "bg-negative";

  return (
    <div className={cn("relative", className)} role="img" aria-label={`${current} unidades; mínimo ${minimum}`}>
      <div className="flex h-7 items-end gap-[3px]">
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-full flex-1 rounded-[2px]",
              i < filled ? fill : "bg-ink/[0.07]",
              i < filled && i === filled - 1 && "opacity-90",
            )}
          />
        ))}
      </div>
      {minIndex >= 0 && (
        <div
          className="absolute -top-1.5 -bottom-1.5 w-px bg-negative/70"
          style={{ left: `calc(${((minIndex + 0.5) / segments) * 100}% )` }}
          aria-hidden
        >
          <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap text-muted">
            mín.
          </span>
        </div>
      )}
    </div>
  );
}
