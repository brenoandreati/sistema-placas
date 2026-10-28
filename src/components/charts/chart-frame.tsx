"use client";

import { ChartColumn, Table2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

export interface LegendItem {
  label: string;
  color: string;
  shape?: "line" | "rect";
}

/** Moldura dos gráficos: título, legenda e alternância para a visualização em tabela. */
export function ChartFrame({
  title,
  description,
  legend,
  table,
  children,
  className,
}: {
  title: string;
  description?: string;
  legend?: LegendItem[];
  table: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section
      className={cn(
        "rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
        <div
          className="flex rounded-lg border border-line p-0.5"
          role="tablist"
          aria-label={`Visualização de ${title}`}
        >
          {(["chart", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium",
                view === v ? "bg-ink/[0.06] text-ink" : "text-muted hover:text-ink",
              )}
            >
              {v === "chart" ? <ChartColumn className="size-3.5" /> : <Table2 className="size-3.5" />}
              {v === "chart" ? "Gráfico" : "Tabela"}
            </button>
          ))}
        </div>
      </div>
      {legend && legend.length > 1 && view === "chart" && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 px-5 pt-3">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5 text-xs text-ink-2">
              <span
                aria-hidden
                className={cn(item.shape === "line" ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-[3px]")}
                style={{ background: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      )}
      <div className="px-2 pt-2 pb-3 sm:px-3">
        {view === "chart" ? children : <div className="max-h-80 overflow-auto px-2">{table}</div>}
      </div>
    </section>
  );
}

export function ChartTooltip({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string; color: string }[];
}) {
  return (
    <div className="min-w-40 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-[var(--shadow-pop)]">
      <p className="mb-1.5 text-xs text-muted">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-xs text-ink-2">
              <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: row.color }} />
              {row.label}
            </span>
            <span className="tabular text-[13px] font-semibold text-ink">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
export function compactNumber(value: number): string {
  return compact.format(value);
}

export function ChartTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-line">
          {headers.map((h, i) => (
            <th key={h} scope="col" className={cn("py-2 font-medium text-muted", i === 0 ? "text-left" : "text-right")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, i) => (
              <td key={i} className={cn("tabular py-1.5", i === 0 ? "text-left text-ink-2" : "text-right text-ink")}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
