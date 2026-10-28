import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatPercent, percentChange } from "@/lib/format";

/** Variação contra o período anterior. `upIsGood` define a cor da direção. */
export function Delta({
  current,
  previous,
  upIsGood = true,
}: {
  current: number;
  previous: number;
  upIsGood?: boolean;
}) {
  const change = percentChange(current, previous);
  if (change === null) return <span className="text-xs text-muted">sem base de comparação</span>;
  if (change === 0) return <span className="text-xs text-muted">igual ao período anterior</span>;
  const up = change > 0;
  const good = up === upIsGood;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs font-medium", good ? "text-positive" : "text-negative")}
    >
      <Icon className="size-3.5" aria-hidden />
      {up ? "+" : "−"}
      {formatPercent(Math.abs(change))}
      <span className="font-normal text-muted">vs. anterior</span>
    </span>
  );
}
