"use client";

import { Calendar } from "lucide-react";
import { useState } from "react";
import { useUrlParams } from "@/components/ui/filters";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { PERIOD_LABELS, type PeriodPreset } from "@/lib/dates";

const PRESETS: PeriodPreset[] = ["today", "7d", "30d", "month", "year"];
const SHORT: Record<PeriodPreset, string> = {
  today: "Hoje",
  "7d": "7 dias",
  "30d": "30 dias",
  month: "Mês",
  year: "Ano",
  custom: "Personalizado",
};

/** Seletor de período: presets em uma linha + intervalo personalizado. */
export function PeriodSelector({ preset, from, to }: { preset: PeriodPreset; from: string; to: string }) {
  const { setParams, pending } = useUrlParams();
  const [customOpen, setCustomOpen] = useState(preset === "custom");
  const [range, setRange] = useState({ from, to });

  return (
    <div className={cn("flex flex-col items-stretch gap-2 sm:items-end", pending && "opacity-70")}>
      <div
        className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1"
        role="radiogroup"
        aria-label="Período"
      >
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={preset === p}
            title={PERIOD_LABELS[p]}
            onClick={() => {
              setCustomOpen(false);
              setParams({ periodo: p, de: null, ate: null });
            }}
            className={cn(
              "h-8 rounded-lg px-3 text-[13px] font-medium transition-colors",
              preset === p ? "bg-ink text-white" : "text-ink-2 hover:bg-ink/[0.05]",
            )}
          >
            {SHORT[p]}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={preset === "custom"}
          onClick={() => setCustomOpen((o) => !o)}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors",
            preset === "custom" ? "bg-ink text-white" : "text-ink-2 hover:bg-ink/[0.05]",
          )}
        >
          <Calendar className="size-3.5" /> Personalizado
        </button>
      </div>
      {customOpen && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ periodo: "custom", de: range.from, ate: range.to });
          }}
        >
          <Input
            type="date"
            aria-label="De"
            value={range.from}
            onChange={(e) => setRange({ ...range, from: e.target.value })}
            className="h-9 w-auto"
          />
          <span className="text-xs text-muted">até</span>
          <Input
            type="date"
            aria-label="Até"
            value={range.to}
            onChange={(e) => setRange({ ...range, to: e.target.value })}
            className="h-9 w-auto"
          />
          <button
            type="submit"
            className="h-9 rounded-lg bg-primary px-3 text-[13px] font-medium text-white hover:bg-primary-hover"
          >
            Aplicar
          </button>
        </form>
      )}
    </div>
  );
}
