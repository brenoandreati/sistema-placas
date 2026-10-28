"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import { formatAmount } from "@/lib/format";

interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  /** Valor em centavos (null = vazio). */
  value: number | null;
  onValueChange: (cents: number | null) => void;
  allowNegative?: boolean;
}

/**
 * Campo monetário estilo caixa de banco: os dígitos digitados preenchem da direita
 * para a esquerda (digitar 1500 resulta em R$ 15,00). Mantém o valor em centavos inteiros.
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onValueChange, allowNegative, className, ...props },
  ref,
) {
  const negative = value !== null && value < 0;
  const display = value === null ? "" : formatAmount(Math.abs(value) / 100);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    const digits = raw.replace(/\D/g, "").replace(/^0+/, "").slice(0, 13);
    if (!digits) {
      onValueChange(raw.includes("-") && allowNegative ? 0 : null);
      return;
    }
    const cents = Number(digits);
    const isNegative = allowNegative && (raw.trim().startsWith("-") || (negative && !raw.includes("+")));
    onValueChange(isNegative ? -cents : cents);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (allowNegative && event.key === "-") {
      event.preventDefault();
      onValueChange(value === null ? 0 : -value);
    }
    props.onKeyDown?.(event);
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">
        {negative ? "−R$" : "R$"}
      </span>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={cn(
          "tabular h-10 w-full rounded-[10px] border border-line-strong bg-surface pr-3 text-right text-sm text-ink",
          "transition-colors hover:border-ink-2/40 focus:border-primary focus:ring-3 focus:ring-primary/15 focus:outline-none",
          "disabled:bg-surface-2 disabled:text-muted aria-[invalid=true]:border-negative",
          negative ? "pl-12" : "pl-10",
          className,
        )}
        value={display}
        placeholder="0,00"
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        {...props}
      />
    </div>
  );
});
