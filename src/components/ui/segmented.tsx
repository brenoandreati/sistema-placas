"use client";

import { cn } from "@/lib/cn";

/** Grupo de opções exclusivas (radio) em formato de botões — rápido de tocar no celular. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  name,
  className,
  size = "md",
  ariaLabel,
}: {
  value: T | null;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; tone?: "positive" | "warning" | "neutral" }[];
  name: string;
  className?: string;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "relative inline-flex cursor-pointer items-center justify-center rounded-[10px] border font-medium transition-colors select-none",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary has-[:focus-visible]:ring-offset-1",
              size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-3.5 text-sm",
              checked
                ? option.tone === "positive"
                  ? "border-positive/40 bg-positive-soft text-positive"
                  : option.tone === "warning"
                    ? "border-warning/40 bg-warning-soft text-warning"
                    : "border-primary/40 bg-primary-soft text-primary-ink"
                : "border-line-strong bg-surface text-ink-2 hover:border-ink-2/40 hover:text-ink",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
